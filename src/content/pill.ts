// The floating pill: a small caption at the bottom of the page showing what Navi hears, what it's doing,
// and its latest reply, so Navi can be used with the side panel closed. It never takes clicks, and hides
// while Navi is asleep or off (the toolbar badge shows that).

import type { PillUpdate } from "../lib/messages";

let host: HTMLElement | null = null;
let pill: HTMLDivElement | null = null;
let icon: HTMLSpanElement | null = null;
let text: HTMLSpanElement | null = null;
let last: PillUpdate | null = null;

const STYLE = `
  :host { all: initial; }
  .pill {
    position: fixed; left: 50%; bottom: 20px; transform: translate(-50%, 8px);
    z-index: 2147483647; pointer-events: none;
    display: flex; align-items: center; gap: 10px;
    max-width: min(560px, calc(100vw - 32px)); box-sizing: border-box;
    padding: 8px 16px 8px 12px; border-radius: 20px;
    font: 500 14px/1.4 "Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    letter-spacing: -.005em; color: #f4f4f5; background: rgba(24, 24, 27, .62);
    text-shadow: 0 1px 2px rgba(0, 0, 0, .35);
    -webkit-backdrop-filter: blur(12px) saturate(1.4); backdrop-filter: blur(12px) saturate(1.4);
    box-shadow: 0 8px 28px rgba(0, 0, 0, .28), 0 0 0 1px rgba(255, 255, 255, .08) inset;
    opacity: 0; transition: opacity .18s ease, transform .18s ease;
  }
  .pill[data-shown="true"] { opacity: 1; transform: translate(-50%, 0); }
  /* Just the listening bars: see-through, so it never hides what's under it. */
  .pill[data-compact="true"] { padding: 9px 12px; background: rgba(24, 24, 27, .45); }
  .text {
    overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
    overflow-wrap: anywhere;
  }
  .text:empty { display: none; }
  /* Replies and errors get room to be read (what Navi hears or is doing stays to two lines). */
  .pill:is([data-kind="reply"], [data-kind="error"]) { border-radius: 16px; }
  .pill:is([data-kind="reply"], [data-kind="error"]) .text { -webkit-line-clamp: 6; }
  .pill[data-kind="hint"] .text { color: #a1a1aa; }
  .pill[data-kind="error"] .text { color: #fca5a5; }
  .icon { flex: none; display: flex; align-items: center; justify-content: center; width: 18px; height: 18px; }
  .bars { display: flex; align-items: center; gap: 3px; height: 16px; }
  .bars i { width: 3px; height: 6px; border-radius: 2px; background: #8b8bff; animation: bar 1s ease-in-out infinite; }
  .bars i:nth-child(2) { animation-delay: .15s; }
  .bars i:nth-child(3) { animation-delay: .3s; }
  @keyframes bar { 0%, 100% { height: 5px; } 50% { height: 15px; } }
  .spin {
    width: 14px; height: 14px; border-radius: 50%;
    border: 1.5px solid rgba(139, 139, 255, .3); border-top-color: #8b8bff; animation: spin .8s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  .dot { width: 6px; height: 6px; border-radius: 50%; background: #8b8bff; }
  .pill[data-kind="error"] .dot { background: #f87171; }
  @media (prefers-reduced-motion: reduce) {
    .pill { transition: opacity .18s ease; transform: translate(-50%, 0); }
    .bars i, .spin { animation: none; }
    .bars i:nth-child(2) { height: 12px; }
  }
  @media print { .pill { display: none; } }
`;

type Look = { kind: "hear" | "work" | "reply" | "error" | "hint"; icon: "bars" | "spin" | "dot"; text: string };

/** What the pill should show, or null to hide it. */
export function pillLook(u: PillUpdate): Look | null {
  const handsFree = u.mode === "handsfree";
  if (u.interim && u.ears.listening) return { kind: "hear", icon: "bars", text: u.interim };
  if (u.worker.working) return { kind: "work", icon: "spin", text: u.worker.detail ?? "Working…" };
  // The grid shows its own instructions at the top; don't repeat them at the bottom.
  if (u.reply && !(u.worker.grid && u.reply.kind === "navi")) {
    return { kind: u.reply.kind === "error" ? "error" : "reply", icon: "dot", text: u.reply.text };
  }
  if (u.ears.micError && u.worker.listening) return { kind: "error", icon: "dot", text: u.ears.micError };
  // Awake after "Hey Navi": show that it's listening. Open mic: a small listening mark only.
  if (u.ears.awake) return { kind: "hint", icon: "bars", text: handsFree ? "Listening…" : "" };
  return null;
}

function ensurePill(): HTMLDivElement {
  if (pill && host?.isConnected) return pill;
  host = document.createElement("navi-pill");
  const root = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = STYLE;
  pill = document.createElement("div");
  pill.className = "pill";
  // Navi speaks its replies aloud, so the pill isn't a live region (screen readers would say them twice).
  pill.setAttribute("aria-label", "Navi");
  icon = document.createElement("span");
  icon.className = "icon";
  icon.setAttribute("aria-hidden", "true");
  text = document.createElement("span");
  text.className = "text";
  pill.append(icon, text);
  root.append(style, pill);
  document.documentElement.append(host);
  return pill;
}

function render() {
  const look = last && document.visibilityState === "visible" ? pillLook(last) : null;
  if (!look) {
    if (pill) pill.dataset.shown = "false";
    return;
  }
  const el = ensurePill();
  el.dataset.kind = look.kind;
  el.dataset.compact = String(!look.text);
  if (icon!.dataset.icon !== look.icon) {
    icon!.dataset.icon = look.icon;
    icon!.innerHTML = look.icon === "bars" ? '<span class="bars"><i></i><i></i><i></i></span>' : `<span class="${look.icon}"></span>`;
  }
  // A long caption keeps its newest words in view.
  const shown = look.kind === "hear" && look.text.length > 140 ? `…${look.text.slice(-140)}` : look.text;
  if (text!.textContent !== shown) text!.textContent = shown;
  // Next frame, so a newly added pill fades in.
  requestAnimationFrame(() => (el.dataset.shown = "true"));
}

export function updatePill(update: PillUpdate) {
  last = update;
  render();
}

const onVisibility = () => render();

/** Shows the pill in this page (top frame only) and asks for Navi's current state. */
export function startPill() {
  if (window !== window.top) return;
  document.addEventListener("visibilitychange", onVisibility);
  if (document.visibilityState === "visible") {
    void chrome.runtime
      .sendMessage({ type: "pill:hello" })
      .then((update: PillUpdate | undefined) => update && updatePill(update))
      .catch(() => undefined);
  }
}

export function destroyPill() {
  document.removeEventListener("visibilitychange", onVisibility);
  host?.remove();
  host = pill = icon = text = null;
  last = null;
}
