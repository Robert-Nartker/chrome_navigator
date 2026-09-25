// Mouse grid: a 3×3 keypad of numbered blocks over the page (1 2 3 / 4 5 6 / 7 8 9).
// Each block also shows a faint preview of the next level, so the user can see where
// the next number leads. Saying numbers zooms in ("5", then "3", or "5 3" at once), up
// to four levels deep (9 → 81 → 729 → 6561 regions), dimming the rest of the page, and
// "click" presses the mouse at the center of the chosen spot. Blocks too small to read
// are shown magnified beside the spot. Reaches anything on screen, including icons,
// maps and canvas apps that have no clickable elements.

import type { GridAction, GridClick } from "../lib/protocol";
import { flash } from "./overlay";
import { describeTarget, elementAt, pressAt } from "./pointer";

interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
}
type Side = "right" | "left" | "below" | "above";

/** Levels the user can see: 9 → 81 → 729 → 6561 regions. */
const MAX_LEVELS = 4;
/** Blocks smaller than this (CSS px) are shown magnified, when there's a picture of the page. */
const MAGNIFY_BELOW = 48;
const KEYPAD = [1, 2, 3, 4, 5, 6, 7, 8, 9];
// Grid lines in a 9×9 box: MAJOR splits it into the 9 blocks, MINOR previews the next level.
const MAJOR = "M3 0V9M6 0V9M0 3H9M0 6H9";
const MINOR = "M1 0V9M2 0V9M4 0V9M5 0V9M7 0V9M8 0V9M0 1H9M0 2H9M0 4H9M0 5H9M0 7H9M0 8H9";

const STYLE = `
  :host { all: initial; pointer-events: none; --accent: #5c7cfa; --ink: rgba(8, 12, 28, .9); --t: .24s cubic-bezier(.2, .8, .2, 1); }
  [hidden] { display: none !important; }
  .frame, .loupe, .link, .hint, .ripple, .dot { position: fixed; z-index: 2147483647; pointer-events: none; box-sizing: border-box; }

  /* The current region. Its outer shadow is the scrim that dims the rest of the page. */
  .frame {
    background: rgba(10, 14, 30, .05);
    box-shadow: inset 0 0 0 2px var(--accent), inset 0 0 0 3px rgba(8, 12, 28, .35), 0 0 0 200vmax rgba(6, 9, 20, 0);
    transition: left var(--t), top var(--t), width var(--t), height var(--t), box-shadow var(--t);
    animation: appear .2s ease-out;
  }
  .frame.zoomed { box-shadow: inset 0 0 0 2px var(--accent), inset 0 0 0 3px rgba(8, 12, 28, .35), 0 0 0 200vmax rgba(6, 9, 20, .5); }

  /* Light lines on a dark halo stay visible on any background. */
  .lines { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; transition: opacity var(--t); }
  .lines path { fill: none; vector-effect: non-scaling-stroke; shape-rendering: crispEdges; transition: opacity var(--t); }
  .major { stroke: rgba(255, 255, 255, .92); stroke-width: 2px; }
  .major.halo { stroke: rgba(8, 12, 28, .42); stroke-width: 4px; }
  .minor { stroke: rgba(255, 255, 255, .4); stroke-width: 1px; }
  .minor.halo { stroke: rgba(8, 12, 28, .14); stroke-width: 3px; }

  .tiles, .preview { position: absolute; inset: 0; display: grid; grid-template: repeat(3, 1fr) / repeat(3, 1fr); place-items: center; }
  .tile { position: relative; display: grid; place-items: center; width: 100%; height: 100%; min-width: 0; min-height: 0; }
  .tile b, .preview i {
    position: relative; color: #fff; font-style: normal; line-height: 1; font-variant-numeric: tabular-nums;
    font-family: ui-rounded, "SF Pro Rounded", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    paint-order: stroke fill; -webkit-text-stroke-color: var(--ink); text-box: trim-both cap alphabetic;
    transition: font-size var(--t), opacity var(--t);
  }
  .tile b { font-size: var(--big); font-weight: 800; -webkit-text-stroke-width: max(.12em, 3px); text-shadow: 0 .03em .18em rgba(0, 0, 0, .35); }
  .preview i { font-size: var(--small); font-weight: 600; opacity: .62; -webkit-text-stroke-width: max(.16em, 2px); }
  [data-labels="off"] .tile b, [data-preview]:not([data-preview="labels"]) .preview i { opacity: 0; }
  [data-preview="none"] .minor, [data-lines="off"] .lines { opacity: 0; }
  .instant, .instant * { transition: none !important; }

  /* The magnified view of a small region, joined to it by a faint beam. */
  .loupe { border-radius: 12px; overflow: hidden; background: #0b0e1a; box-shadow: 0 18px 50px rgba(0, 0, 0, .5); animation: pop .22s cubic-bezier(.2, .8, .2, 1); }
  .loupe::after { content: ""; position: absolute; inset: 0; border-radius: inherit;
    box-shadow: inset 0 0 0 2px var(--accent), inset 0 0 0 3px rgba(8, 12, 28, .35); }
  .loupe canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
  .link { inset: 0; width: 100%; height: 100%; overflow: visible; }
  .link path { fill: rgba(92, 124, 250, .14); stroke: rgba(150, 170, 255, .6); stroke-width: 1px; stroke-linejoin: round; }

  .hint {
    left: 50%; top: 14px; transform: translateX(-50%); max-width: calc(100vw - 32px); overflow: hidden;
    display: flex; align-items: center; gap: 10px; padding: 7px 14px 7px 12px; border-radius: 999px;
    background: rgba(17, 20, 34, .88); color: #e6e9f5; white-space: nowrap;
    font: 500 13px/1.3 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; letter-spacing: .01em;
    -webkit-backdrop-filter: blur(12px) saturate(1.4); backdrop-filter: blur(12px) saturate(1.4);
    box-shadow: 0 8px 28px rgba(0, 0, 0, .3), inset 0 0 0 1px rgba(255, 255, 255, .1);
    animation: hint-in .22s ease-out;
  }
  .hint.bottom { top: auto; bottom: 14px; }
  .hint em { font-style: normal; font-weight: 650; color: #fff; }
  .dots { display: flex; gap: 4px; }
  .dots span { width: 6px; height: 6px; border-radius: 50%; background: rgba(255, 255, 255, .22); }
  .dots .on { background: var(--accent); box-shadow: 0 0 0 2px rgba(92, 124, 250, .3); }
  .path { padding: 2px 8px; border-radius: 6px; background: var(--accent); color: #fff; font-weight: 700; font-variant-numeric: tabular-nums; }

  /* Where a click landed: rings (two for a double click) and a dot; amber for a right click. */
  .ripple { width: 44px; height: 44px; margin: -22px 0 0 -22px; border-radius: 50%; border: 3px solid var(--accent);
    box-shadow: 0 0 0 1.5px rgba(255, 255, 255, .85), inset 0 0 0 1.5px rgba(255, 255, 255, .85);
    opacity: 0; animation: ripple .6s cubic-bezier(.2, .8, .2, 1); }
  .ripple.second { animation-delay: .15s; }
  .dot { width: 10px; height: 10px; margin: -5px 0 0 -5px; border-radius: 50%; background: var(--accent);
    box-shadow: 0 0 0 2px #fff, 0 1px 6px rgba(0, 0, 0, .45); animation: fade .9s ease-in forwards; }
  .right { --accent: #f59f00; }

  @keyframes appear { from { opacity: 0; transform: scale(1.012); } }
  @keyframes pop { from { opacity: 0; transform: scale(.94); } }
  @keyframes hint-in { from { opacity: 0; transform: translate(-50%, -4px); } }
  @keyframes ripple { from { opacity: 1; transform: scale(.2); } to { opacity: 0; transform: scale(1.3); } }
  @keyframes fade { 0%, 55% { opacity: 1; } to { opacity: 0; } }
  @media (prefers-reduced-motion: reduce) {
    .frame, .frame *, .loupe, .loupe *, .hint { transition: none !important; animation: none !important; }
    .ripple { display: none; }
    .dot { animation: none; }
  }
`;

let host: HTMLElement | null = null;
let root: ShadowRoot | null = null;
let frame: HTMLElement | null = null;
let loupe: HTMLElement | null = null;
let link: SVGSVGElement | null = null;
let hint: HTMLElement | null = null;
/** Blocks chosen so far, one per level below the whole screen. */
let path: number[] = [];
/** Picture of the page from just before the grid appeared, for magnifying small blocks. */
let shot: { bitmap: ImageBitmap; scale: number } | null = null;

/** The visible page area, without scrollbars. */
function viewport(): Region {
  const el = document.compatMode === "BackCompat" ? document.body : document.documentElement;
  return { x: 0, y: 0, w: el?.clientWidth || innerWidth, h: el?.clientHeight || innerHeight };
}

function cellOf(region: Region, n: number): Region {
  const col = (n - 1) % 3;
  const row = Math.floor((n - 1) / 3);
  const w = region.w / 3;
  const h = region.h / 3;
  return { x: region.x + col * w, y: region.y + row * h, w, h };
}

function regionOf(cells: number[]): Region {
  return cells.reduce(cellOf, viewport());
}

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

function ensureRoot(): ShadowRoot {
  if (host?.isConnected && root) return root;
  host = document.createElement("navi-grid");
  root = host.attachShadow({ mode: "open" });
  root.innerHTML = `<style>${STYLE}</style>`;
  host.setAttribute("popover", "manual");
  document.documentElement.append(host);
  raise();
  return root;
}

/** Puts the grid in the top layer, above the page's own dialogs and full-screen elements. */
function raise() {
  try {
    if (host?.matches(":popover-open")) host.hidePopover();
    host?.showPopover();
  } catch {
    // No top layer: the max z-index still covers nearly everything.
  }
}

/** Removes the host once no grid or click marks are left in it. */
function cleanup() {
  if (root?.querySelector(".frame, .ripple, .dot")) return;
  host?.remove();
  host = root = null;
}

/** Lines, big numbers, and the faint next-level preview inside each block. */
function gridMarkup(): string {
  const tiles = KEYPAD.map((n) => {
    // The big number sits in the middle of its block, where the preview's 5 would be.
    const preview = KEYPAD.map((p) => `<i>${p === 5 ? "" : p}</i>`).join("");
    return `<div class="tile"><div class="preview">${preview}</div><b>${n}</b></div>`;
  }).join("");
  return `
    <svg class="lines" viewBox="0 0 9 9" preserveAspectRatio="none" aria-hidden="true">
      <path class="minor halo" d="${MINOR}"/><path class="minor" d="${MINOR}"/>
      <path class="major halo" d="${MAJOR}"/><path class="major" d="${MAJOR}"/>
    </svg>
    <div class="tiles">${tiles}</div>`;
}

function build(into: ShadowRoot) {
  const box = document.createElement("div");
  box.innerHTML = `
    <div class="frame">${gridMarkup()}</div>
    <svg class="link" hidden aria-hidden="true"><path/></svg>
    <div class="loupe" hidden><canvas></canvas>${gridMarkup()}</div>
    <div class="hint" role="status"></div>`;
  const [f, l, m, h] = Array.from(box.children);
  frame = f as HTMLElement;
  link = l as SVGSVGElement;
  loupe = m as HTMLElement;
  hint = h as HTMLElement;
  into.append(frame, link, loupe, hint);
}

function render(animate = true) {
  if (!frame || !loupe || !link || !hint) return;
  const region = regionOf(path);
  const last = path.length >= MAX_LEVELS - 1;
  const magnify = !!shot && Math.min(region.w, region.h) / 3 < MAGNIFY_BELOW;
  for (const el of [frame, loupe, hint]) el.classList.toggle("instant", !animate);
  frame.classList.toggle("zoomed", path.length > 0);
  // When magnified, the spot itself keeps its outline (and lines, if they fit) and the view beside it has the numbers.
  layout(frame, region, last, !magnify);
  loupe.toggleAttribute("hidden", !magnify);
  link.toggleAttribute("hidden", !magnify);
  if (magnify) {
    const { view, side } = loupeView(region);
    layout(loupe, view, last, true);
    paint(loupe.querySelector("canvas")!, region, view);
    link.querySelector("path")!.setAttribute("d", beam(region, view, side));
  }

  // The hint moves to the bottom when the region is up top.
  hint.classList.toggle("bottom", path.length > 0 && region.y + region.h / 2 < viewport().h / 2);
  const dots = Array.from({ length: MAX_LEVELS }, (_, i) => `<span${i <= path.length ? ' class="on"' : ""}></span>`).join("");
  const where = path.length ? `<span class="path">${path.join(" › ")}</span>` : "";
  const say = !path.length
    ? "Say a number to zoom in, then <em>“click”</em>"
    : last
      ? "Say <em>“click”</em>, or <em>“click”</em> and a number"
      : "Say a number, <em>“click”</em> or <em>“back”</em>";
  hint.innerHTML = `<span class="dots">${dots}</span>${where}<span>${say}</span>`;
}

/** Positions a grid (on the spot, or magnified) and sizes its numbers to fit its blocks. */
function layout(el: HTMLElement, r: Region, last: boolean, labels: boolean) {
  const tile = Math.min(r.w, r.h) / 3;
  el.dataset.labels = labels ? "on" : "off";
  el.dataset.lines = labels || tile >= 20 ? "on" : "off";
  // Preview numbers need room: small previews keep just their lines, and the last level has none.
  el.dataset.preview = !labels || last || tile < 18 ? "none" : tile < 96 ? "lines" : "labels";
  Object.assign(el.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });
  el.style.setProperty("--big", `${clamp(tile * 0.42, Math.min(12, tile), 120)}px`);
  el.style.setProperty("--small", `${clamp(tile * 0.075, 10, 20)}px`);
}

/** Where the magnified view goes: beside the region, on the first side with room. */
function loupeView(region: Region): { view: Region; side: Side } {
  const vp = viewport();
  const pad = 12;
  const gap = 16;
  const zoom = Math.min(clamp(vp.h * 0.45, 240, 440) / Math.min(region.w, region.h), (vp.w * 0.42) / region.w, (vp.h * 0.48) / region.h);
  const w = region.w * zoom;
  const h = region.h * zoom;
  const x = clamp(region.x + region.w / 2 - w / 2, pad, vp.w - pad - w);
  const y = clamp(region.y + region.h / 2 - h / 2, pad, vp.h - pad - h);
  const right = region.x + region.w + gap;
  const below = region.y + region.h + gap;
  const options: [Side, number, number, boolean][] = [
    ["right", right, y, right + w <= vp.w - pad],
    ["left", region.x - gap - w, y, region.x - gap - w >= pad],
    ["below", x, below, below + h <= vp.h - pad],
    ["above", x, region.y - gap - h, region.y - gap - h >= pad],
  ];
  const [side, vx, vy] = options.find((o) => o[3]) ?? options[0];
  return { side, view: { x: vx, y: vy, w, h } };
}

/** Draws the region from the page picture, magnified, into the view's canvas. */
function paint(canvas: HTMLCanvasElement, region: Region, view: Region) {
  const ctx = shot && canvas.getContext("2d");
  if (!shot || !ctx) return;
  const dpr = devicePixelRatio || 1;
  canvas.width = Math.round(view.w * dpr);
  canvas.height = Math.round(view.h * dpr);
  ctx.imageSmoothingQuality = "high";
  const s = shot.scale;
  ctx.drawImage(shot.bitmap, region.x * s, region.y * s, region.w * s, region.h * s, 0, 0, canvas.width, canvas.height);
}

/** The faint beam joining the region to its magnified view. */
function beam(r: Region, v: Region, side: Side): string {
  const corners: Record<Side, number[][]> = {
    right: [[r.x + r.w, r.y], [v.x, v.y], [v.x, v.y + v.h], [r.x + r.w, r.y + r.h]],
    left: [[r.x, r.y], [v.x + v.w, v.y], [v.x + v.w, v.y + v.h], [r.x, r.y + r.h]],
    below: [[r.x, r.y + r.h], [v.x, v.y], [v.x + v.w, v.y], [r.x + r.w, r.y + r.h]],
    above: [[r.x, r.y], [v.x, v.y + v.h], [v.x + v.w, v.y + v.h], [r.x + r.w, r.y]],
  };
  return `M${corners[side].map(([x, y]) => `${x} ${y}`).join("L")}Z`;
}

async function loadShot(image: string): Promise<{ bitmap: ImageBitmap; scale: number }> {
  const type = image.slice(5, image.indexOf(";"));
  const bytes = Uint8Array.from(atob(image.slice(image.indexOf(",") + 1)), (c) => c.charCodeAt(0));
  const bitmap = await createImageBitmap(new Blob([bytes], { type }));
  return { bitmap, scale: bitmap.width / innerWidth };
}

function dropShot() {
  shot?.bitmap.close();
  shot = null;
}

function checkCells(cells: number[]) {
  if (!cells.length || cells.some((n) => !Number.isInteger(n) || n < 1 || n > 9)) throw new Error("Say a number from 1 to 9.");
}

function requireGrid() {
  if (!gridActive()) throw new Error("The grid isn't showing anymore. Say show grid.");
}

export function gridActive(): boolean {
  return !!frame?.isConnected;
}

/** Shows the grid over the whole screen (or goes back to it). `image` is a fresh picture of the page. */
export async function showGrid(image?: string): Promise<string> {
  path = [];
  if (image) {
    dropShot();
    shot = await loadShot(image).catch(() => null);
  }
  const into = ensureRoot();
  if (gridActive()) raise();
  else build(into);
  render();
  return "Grid on. Say a number to zoom in, then say click.";
}

/** Zooms into one block per cell ("5 3": block 5, then block 3 inside it). */
export function zoomGrid(cells: number[]): string {
  requireGrid();
  checkCells(cells);
  const room = MAX_LEVELS - 1 - path.length;
  if (room <= 0) return "That's as close as the grid goes. Say click, or click and a number.";
  path.push(...cells.slice(0, room));
  render();
  const at = `Zoomed into ${path.join(", ")}.`;
  return path.length >= MAX_LEVELS - 1 ? `${at} Say click, or click and a number.` : `${at} Say another number, or click.`;
}

export function backGrid(): string {
  requireGrid();
  if (!path.length) return "This is the whole screen. Say a number, or hide grid.";
  path.pop();
  render();
  return path.length ? `Back to ${path.join(", ")}.` : "Back to the whole screen.";
}

export function hideGrid() {
  path = [];
  dropShot();
  for (const el of [frame, link, loupe, hint]) el?.remove();
  frame = link = loupe = hint = null;
  cleanup();
}

/** Clicks the center of the current block, or of the block the cells lead to, then hides the grid. */
export function clickGrid(how: GridClick, cells: number[] = []): string {
  requireGrid();
  if (cells.length) checkCells(cells);
  const region = regionOf([...path, ...cells]);
  hideGrid();
  return clickAtPoint(region.x + region.w / 2, region.y + region.h / 2, how);
}

/** Runs a grid request from the side panel and returns what to tell the user. */
export async function runGrid(action: GridAction, cells: number[] = [], image?: string): Promise<string> {
  switch (action) {
    case "show":
      return showGrid(image);
    case "zoom":
      return zoomGrid(cells);
    case "back":
      return backGrid();
    case "hide":
      hideGrid();
      return "Grid hidden.";
    default:
      return clickGrid(action, cells);
  }
}

/** Clicks exactly at a viewport point, like a real mouse would. */
export function clickAtPoint(x: number, y: number, how: GridClick = "click"): string {
  const el = elementAt(x, y);
  if (!el) throw new Error("There's nothing to click there.");
  const name = describeTarget(el);
  // Outline what was clicked, unless it's a big container like the page itself.
  const rect = el.getBoundingClientRect();
  if (rect.width * rect.height < innerWidth * innerHeight * 0.25) flash(el);
  showClick(x, y, how);
  pressAt(el, x, y, how);
  const verb = how === "doubleClick" ? "Double-clicked" : how === "rightClick" ? "Right-clicked" : "Clicked";
  return name ? `${verb} ${name}` : verb;
}

function showClick(x: number, y: number, how: GridClick) {
  const into = ensureRoot();
  const classes = [...(how === "doubleClick" ? ["ripple", "ripple second"] : ["ripple"]), "dot"];
  const marks = classes.map((cls) => {
    const mark = document.createElement("div");
    mark.className = how === "rightClick" ? `${cls} right` : cls;
    Object.assign(mark.style, { left: `${x}px`, top: `${y}px` });
    return mark;
  });
  into.append(...marks);
  window.setTimeout(() => {
    marks.forEach((m) => m.remove());
    cleanup();
  }, 900);
}

// When the page scrolls or the window resizes, keep the same blocks (without animating),
// but drop the picture: it no longer matches what's on screen.
function onViewportChange() {
  if (!gridActive()) return;
  dropShot();
  render(false);
}
addEventListener("resize", onViewportChange, { passive: true });
addEventListener("scroll", () => shot && onViewportChange(), { passive: true, capture: true });
