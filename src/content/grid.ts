// Mouse grid: splits the screen into 9 numbered blocks (phone-keypad layout).
// Say a number to zoom into that block, repeat, then "click". Reaches anything
// on screen, including icons, maps and canvas apps that have no clickable elements.

import { flash } from "./overlay";

interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
}

const MAX_LEVELS = 5;
const STYLE = `
  :host { all: initial; }
  .grid { position: fixed; pointer-events: none; z-index: 2147483647; display: grid;
    grid-template-columns: repeat(3, 1fr); grid-template-rows: repeat(3, 1fr);
    outline: 2px solid rgba(76,110,245,.9); background: rgba(76,110,245,.06); }
  .cell { border: 1px solid rgba(76,110,245,.55); display: grid; place-items: center;
    font: 800 var(--size, 28px)/1 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    color: #fff; text-shadow: 0 0 3px #1c2a7a, 0 0 6px #1c2a7a; }
  .shade { position: fixed; inset: 0; pointer-events: none; z-index: 2147483646; background: rgba(0,0,0,.18); }
  .dot { position: fixed; width: 10px; height: 10px; margin: -5px 0 0 -5px; border-radius: 50%;
    background: #ff4d4f; box-shadow: 0 0 0 2px #fff; pointer-events: none; z-index: 2147483647; }
`;

let host: HTMLElement | null = null;
let root: ShadowRoot | null = null;
let stack: Region[] = [];

function viewport(): Region {
  return { x: 0, y: 0, w: innerWidth, h: innerHeight };
}

function render() {
  if (!host?.isConnected) {
    host = document.createElement("navi-grid");
    root = host.attachShadow({ mode: "open" });
    document.documentElement.append(host);
  }
  const region = stack[stack.length - 1];
  const size = Math.max(11, Math.min(36, Math.min(region.w, region.h) / 7));
  root!.innerHTML = `<style>${STYLE}</style>${stack.length > 1 ? '<div class="shade"></div>' : ""}
    <div class="grid" style="left:${region.x}px;top:${region.y}px;width:${region.w}px;height:${region.h}px;--size:${size}px">
      ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<div class="cell">${n}</div>`).join("")}
    </div>
    <div class="dot" style="left:${region.x + region.w / 2}px;top:${region.y + region.h / 2}px"></div>`;
}

function cell(region: Region, n: number): Region {
  const col = (n - 1) % 3;
  const row = Math.floor((n - 1) / 3);
  const w = region.w / 3;
  const h = region.h / 3;
  return { x: region.x + col * w, y: region.y + row * h, w, h };
}

export function gridActive(): boolean {
  return stack.length > 0 && !!host?.isConnected;
}

export function showGrid(): string {
  stack = [viewport()];
  render();
  return "Grid shown. Say a number to zoom in, then click.";
}

export function zoomGrid(n: number): string {
  if (!gridActive()) showGrid();
  if (n < 1 || n > 9) throw new Error("Say a number from 1 to 9.");
  if (stack.length >= MAX_LEVELS) return clickGrid(n);
  stack.push(cell(stack[stack.length - 1], n));
  render();
  return `Zoomed into ${n}. Say another number, or click.`;
}

export function backGrid(): string {
  if (stack.length > 1) stack.pop();
  render();
  return "Zoomed out.";
}

export function hideGrid() {
  stack = [];
  host?.remove();
  host = null;
  root = null;
}

/** Clicks the center of the current block, or of block n inside it. */
export function clickGrid(n?: number): string {
  if (!gridActive()) throw new Error("The grid isn't showing. Say show grid first.");
  let region = stack[stack.length - 1];
  if (n !== undefined) region = cell(region, n);
  const x = region.x + region.w / 2;
  const y = region.y + region.h / 2;
  hideGrid();
  return clickAtPoint(x, y);
}

/** Finds the innermost element at a point, looking inside open shadow roots. */
function elementAt(x: number, y: number): Element | null {
  let el = document.elementFromPoint(x, y);
  while (el?.shadowRoot) {
    const inner = el.shadowRoot.elementFromPoint(x, y);
    if (!inner || inner === el) break;
    el = inner;
  }
  return el;
}

/** Clicks exactly at a viewport point, like a real mouse would. */
export function clickAtPoint(x: number, y: number): string {
  const el = elementAt(x, y);
  if (!el) throw new Error("There's nothing to click there.");
  flash(el);
  const base = { bubbles: true, cancelable: true, composed: true, view: window, clientX: x, clientY: y, button: 0 };
  el.dispatchEvent(new PointerEvent("pointerover", { ...base, pointerType: "mouse", isPrimary: true }));
  el.dispatchEvent(new PointerEvent("pointerdown", { ...base, pointerType: "mouse", isPrimary: true, buttons: 1 }));
  el.dispatchEvent(new MouseEvent("mousedown", { ...base, buttons: 1 }));
  const focusable = (el as HTMLElement).closest?.("a, button, input, select, textarea, [tabindex]") as HTMLElement | null;
  focusable?.focus({ preventScroll: true });
  el.dispatchEvent(new PointerEvent("pointerup", { ...base, pointerType: "mouse", isPrimary: true }));
  el.dispatchEvent(new MouseEvent("mouseup", base));
  el.dispatchEvent(new MouseEvent("click", base));
  const dot = document.createElement("div");
  Object.assign(dot.style, {
    position: "fixed", left: `${x - 6}px`, top: `${y - 6}px`, width: "12px", height: "12px", borderRadius: "50%",
    background: "#ff4d4f", boxShadow: "0 0 0 2px #fff", zIndex: "2147483647", pointerEvents: "none",
    transition: "opacity .6s", opacity: "1",
  });
  document.documentElement.append(dot);
  window.setTimeout(() => (dot.style.opacity = "0"), 400);
  window.setTimeout(() => dot.remove(), 1100);
  const label = (el.getAttribute("aria-label") ?? (el as HTMLElement).innerText ?? "").trim().replace(/\s+/g, " ");
  return label ? `Clicked ${label.slice(0, 60)}` : "Clicked";
}

addEventListener("resize", () => gridActive() && showGrid(), { passive: true });
