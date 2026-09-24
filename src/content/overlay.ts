// Numbered badges over clickable elements ("click 12"), plus a brief highlight
// flash on whatever Navi is about to act on.

import { resolveElement, takeSnapshot } from "./snapshot";
import type { PageSnapshot } from "../lib/protocol";

let host: HTMLElement | null = null;
let layer: HTMLDivElement | null = null;
let visible = false;
let shownGen = 0;
let refreshTimer: number | undefined;

const STYLE = `
  :host { all: initial; }
  .layer { position: fixed; inset: 0; pointer-events: none; z-index: 2147483647; }
  .badge {
    position: fixed; transform: translate(-30%, -40%);
    font: 700 12px/1 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    color: #1a1400; background: #ffd43b; border: 1px solid #a07c00;
    border-radius: 4px; padding: 2px 4px; min-width: 12px; text-align: center;
    box-shadow: 0 1px 3px rgba(0,0,0,.35);
  }
  .flash {
    position: fixed; border: 3px solid #4c6ef5; border-radius: 6px;
    background: rgba(76,110,245,.15); transition: opacity .5s ease; pointer-events: none;
  }
`;

function ensureLayer(): HTMLDivElement {
  if (layer && host?.isConnected) return layer;
  host = document.createElement("navi-overlay");
  const root = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = STYLE;
  layer = document.createElement("div");
  layer.className = "layer";
  root.append(style, layer);
  document.documentElement.append(host);
  return layer;
}

function render(snapshot: PageSnapshot) {
  const target = ensureLayer();
  target.querySelectorAll(".badge").forEach((b) => b.remove());
  shownGen = snapshot.gen;
  const frag = document.createDocumentFragment();
  for (const info of snapshot.elements) {
    if (!info.inViewport) continue;
    const el = resolveElement(info.id, snapshot.gen);
    if (!el) continue;
    const rect = el.getBoundingClientRect();
    const badge = document.createElement("div");
    badge.className = "badge";
    badge.textContent = String(info.id);
    badge.style.left = `${Math.max(rect.left, 2)}px`;
    badge.style.top = `${Math.max(rect.top, 2)}px`;
    frag.append(badge);
  }
  target.append(frag);
}

function scheduleRefresh() {
  if (!visible) return;
  window.clearTimeout(refreshTimer);
  layer?.querySelectorAll<HTMLElement>(".badge").forEach((b) => (b.style.opacity = "0.25"));
  refreshTimer = window.setTimeout(() => {
    if (visible) render(takeSnapshot());
  }, 250);
}

export function showBadges(snapshot?: PageSnapshot): PageSnapshot {
  const snap = snapshot ?? takeSnapshot();
  visible = true;
  render(snap);
  return snap;
}

export function hideBadges() {
  visible = false;
  layer?.querySelectorAll(".badge").forEach((b) => b.remove());
}

export function badgesVisible(): boolean {
  return visible;
}

/** The generation whose numbers are on screen, so "click 12" matches what the user sees. */
export function displayedGeneration(): number | undefined {
  return visible ? shownGen : undefined;
}

/** Re-renders badges after the page changes (called with fresh snapshots). */
export function refreshBadges(snapshot: PageSnapshot) {
  if (visible) render(snapshot);
}

export function flash(el: Element) {
  const rect = el.getBoundingClientRect();
  const box = document.createElement("div");
  box.className = "flash";
  Object.assign(box.style, {
    left: `${rect.left - 3}px`,
    top: `${rect.top - 3}px`,
    width: `${rect.width + 6}px`,
    height: `${rect.height + 6}px`,
  });
  ensureLayer().append(box);
  window.setTimeout(() => (box.style.opacity = "0"), 350);
  window.setTimeout(() => box.remove(), 900);
}

addEventListener("scroll", scheduleRefresh, { passive: true, capture: true });
addEventListener("resize", scheduleRefresh, { passive: true });
