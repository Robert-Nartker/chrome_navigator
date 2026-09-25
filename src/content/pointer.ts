// Presses the mouse at an exact point on the page, the way a real mouse would:
// used by the mouse grid and by the AI's clicks at screenshot coordinates.

import type { GridClick } from "../lib/protocol";
import { accessibleName } from "./snapshot";

const FOCUSABLE = "a[href], button, input, select, textarea, summary, [tabindex], [contenteditable=''], [contenteditable='true']";
const NAMED =
  "a[href], button, input, select, textarea, summary, label, [onclick], [tabindex], " +
  ["button", "link", "tab", "menuitem", "checkbox", "radio", "option", "switch", "treeitem"].map((r) => `[role='${r}']`).join(", ");

/** The innermost element at a point, looking inside open shadow roots. */
export function elementAt(x: number, y: number): Element | null {
  let el = document.elementFromPoint(x, y);
  while (el?.shadowRoot) {
    const inner = el.shadowRoot.elementFromPoint(x, y);
    if (!inner || inner === el) break;
    el = inner;
  }
  return el;
}

/** Sends the pointer and mouse events of a click, double-click or right-click at (x, y). */
export function pressAt(el: Element, x: number, y: number, how: GridClick = "click") {
  const button = how === "rightClick" ? 2 : 0;
  const buttons = how === "rightClick" ? 2 : 1;
  const base = { bubbles: true, cancelable: true, composed: true, view: window, clientX: x, clientY: y, screenX: screenX + x, screenY: screenY + y };
  const pointer = { ...base, pointerId: 1, pointerType: "mouse", isPrimary: true };
  el.dispatchEvent(new PointerEvent("pointerover", pointer));
  el.dispatchEvent(new MouseEvent("mouseover", base));
  el.dispatchEvent(new PointerEvent("pointermove", pointer));
  el.dispatchEvent(new MouseEvent("mousemove", base));
  for (let detail = 1; detail <= (how === "doubleClick" ? 2 : 1); detail++) {
    // Like a browser: a cancelled pointerdown suppresses the mouse events (but not the click),
    // and a cancelled mousedown keeps focus where it was.
    const mouse = el.dispatchEvent(new PointerEvent("pointerdown", { ...pointer, button, buttons }));
    const focus = mouse ? el.dispatchEvent(new MouseEvent("mousedown", { ...base, button, buttons, detail })) : true;
    if (focus && detail === 1) {
      const target = el.closest(FOCUSABLE) as HTMLElement | null;
      if (target) target.focus({ preventScroll: true });
      else (document.activeElement as HTMLElement | null)?.blur?.();
    }
    if (how === "rightClick") el.dispatchEvent(new MouseEvent("contextmenu", { ...base, button, buttons, detail }));
    el.dispatchEvent(new PointerEvent("pointerup", { ...pointer, button }));
    if (mouse) el.dispatchEvent(new MouseEvent("mouseup", { ...base, button, detail }));
    if (how !== "rightClick") el.dispatchEvent(new MouseEvent("click", { ...base, button, detail }));
  }
  if (how === "doubleClick") el.dispatchEvent(new MouseEvent("dblclick", { ...base, detail: 2 }));
}

/** A short name for what was clicked: the button or link around the point, else the element's own short text. */
export function describeTarget(el: Element): string {
  const named = el.closest(NAMED);
  // A big container's text isn't a name (and is slow to read).
  if (!named && (el.textContent?.length ?? 0) > 120) return "";
  const name = accessibleName(named ?? el);
  return name.length > 60 ? `${name.slice(0, 59)}…` : name;
}
