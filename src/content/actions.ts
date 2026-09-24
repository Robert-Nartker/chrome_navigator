// Performs actions on page elements the way a user's mouse and keyboard would.

import type { Key, MediaAction, ScrollAmount, ScrollDirection } from "../lib/protocol";
import { deepActiveElement } from "./snapshot";
import { flash } from "./overlay";

function center(el: Element) {
  const r = el.getBoundingClientRect();
  return { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
}

function ensureInView(el: Element) {
  const r = el.getBoundingClientRect();
  if (r.top < 0 || r.bottom > innerHeight || r.left < 0 || r.right > innerWidth) {
    el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
  }
}

export function click(el: Element): string {
  ensureInView(el);
  flash(el);
  const point = center(el);
  const base = { bubbles: true, cancelable: true, composed: true, view: window, ...point };
  el.dispatchEvent(new PointerEvent("pointerover", base));
  el.dispatchEvent(new MouseEvent("mouseover", base));
  el.dispatchEvent(new PointerEvent("pointerdown", { ...base, pointerType: "mouse", isPrimary: true }));
  el.dispatchEvent(new MouseEvent("mousedown", { ...base, button: 0, buttons: 1 }));
  if (el instanceof HTMLElement) el.focus({ preventScroll: true });
  el.dispatchEvent(new PointerEvent("pointerup", { ...base, pointerType: "mouse", isPrimary: true }));
  el.dispatchEvent(new MouseEvent("mouseup", { ...base, button: 0 }));
  if (el instanceof HTMLElement) {
    el.click();
  } else {
    el.dispatchEvent(new MouseEvent("click", { ...base, button: 0 }));
  }
  return "clicked";
}

function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  // Frameworks like React track the value setter, so call the prototype's setter directly.
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
}

function isTextField(el: Element | null): el is HTMLInputElement | HTMLTextAreaElement {
  if (el instanceof HTMLTextAreaElement) return true;
  return (
    el instanceof HTMLInputElement &&
    !["checkbox", "radio", "button", "submit", "reset", "file", "image", "range", "color"].includes(el.type)
  );
}

function findEditableWithin(el: Element): Element | null {
  if (isTextField(el) || (el as HTMLElement).isContentEditable) return el;
  return el.querySelector("input:not([type=hidden]), textarea, [contenteditable=''], [contenteditable='true']");
}

export function typeText(target: Element | null, text: string, submit: boolean, clear: boolean): string {
  let el = target ? findEditableWithin(target) : deepActiveElement();
  if (!el) {
    if (target) {
      // Some search boxes only appear after clicking a button.
      click(target);
      el = deepActiveElement();
    }
    if (!el) throw new Error("There's no text field selected. Say which box to type in.");
  }
  ensureInView(el);
  flash(el);
  (el as HTMLElement).focus();

  if (isTextField(el)) {
    const next = clear ? text : el.value + text;
    setNativeValue(el, next);
    el.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, inputType: "insertText", data: text }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  } else if ((el as HTMLElement).isContentEditable) {
    if (clear) document.execCommand("selectAll", false);
    const inserted = document.execCommand("insertText", false, text);
    if (!inserted) (el as HTMLElement).textContent = clear ? text : (el.textContent ?? "") + text;
  } else {
    throw new Error("That element isn't a text field.");
  }

  if (submit) pressEnter(el);
  return submit ? "typed and submitted" : "typed";
}

function keyEventInit(key: Key) {
  const map: Record<Key, { key: string; code: string; keyCode: number }> = {
    Enter: { key: "Enter", code: "Enter", keyCode: 13 },
    Escape: { key: "Escape", code: "Escape", keyCode: 27 },
    Tab: { key: "Tab", code: "Tab", keyCode: 9 },
    Space: { key: " ", code: "Space", keyCode: 32 },
    Backspace: { key: "Backspace", code: "Backspace", keyCode: 8 },
    ArrowUp: { key: "ArrowUp", code: "ArrowUp", keyCode: 38 },
    ArrowDown: { key: "ArrowDown", code: "ArrowDown", keyCode: 40 },
    ArrowLeft: { key: "ArrowLeft", code: "ArrowLeft", keyCode: 37 },
    ArrowRight: { key: "ArrowRight", code: "ArrowRight", keyCode: 39 },
    PageUp: { key: "PageUp", code: "PageUp", keyCode: 33 },
    PageDown: { key: "PageDown", code: "PageDown", keyCode: 34 },
  };
  const k = map[key];
  return { ...k, which: k.keyCode, bubbles: true, cancelable: true, composed: true };
}

function dispatchKey(el: Element, key: Key): boolean {
  const init = keyEventInit(key);
  const notCancelled = el.dispatchEvent(new KeyboardEvent("keydown", init));
  if (key === "Enter") el.dispatchEvent(new KeyboardEvent("keypress", init));
  el.dispatchEvent(new KeyboardEvent("keyup", init));
  return notCancelled;
}

function pressEnter(el: Element) {
  const notCancelled = dispatchKey(el, "Enter");
  const form = (el as HTMLInputElement).form;
  if (notCancelled && form) {
    if (typeof form.requestSubmit === "function") form.requestSubmit();
    else form.submit();
  }
}

const FOCUSABLE =
  "a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1']), [contenteditable='true']";

export function pressKey(key: Key): string {
  const el = deepActiveElement() ?? document.body;
  if (key === "Enter") {
    if (el instanceof HTMLAnchorElement || el instanceof HTMLButtonElement) click(el);
    else pressEnter(el);
    return "pressed Enter";
  }
  if (key === "Tab") {
    // Synthetic Tab events don't move focus, so move it ourselves.
    const all = Array.from(document.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
      (e) => e.offsetParent !== null,
    );
    const next = all[(all.indexOf(el as HTMLElement) + 1) % Math.max(all.length, 1)];
    next?.focus();
    if (next) flash(next);
    return "moved focus";
  }
  if (key === "PageDown" || key === "PageUp") {
    scroll(key === "PageDown" ? "down" : "up", "page");
    return "scrolled";
  }
  dispatchKey(el, key);
  if (key === "Escape") dispatchKey(document.body, key);
  return `pressed ${key}`;
}

function isScrollable(el: Element): boolean {
  const style = getComputedStyle(el);
  return /(auto|scroll|overlay)/.test(style.overflowY) && el.scrollHeight > el.clientHeight + 20;
}

/** Scrolls whatever the user is looking at: the page, or an inner panel (Gmail, Slack). */
function scrollTarget(): Element {
  const doc = document.scrollingElement ?? document.documentElement;
  const docScrollable = doc.scrollHeight > innerHeight + 20 && getComputedStyle(document.body).overflowY !== "hidden";
  let el = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
  while (el && el !== document.body && el !== document.documentElement) {
    if (isScrollable(el)) return el;
    el = el.parentElement;
  }
  if (docScrollable) return doc;
  // Fall back to the largest scrollable element on the page.
  let best: Element = doc;
  let bestArea = 0;
  document.querySelectorAll("div, main, section, ul").forEach((candidate) => {
    if (!isScrollable(candidate)) return;
    const r = candidate.getBoundingClientRect();
    const area = r.width * r.height;
    if (area > bestArea) {
      best = candidate;
      bestArea = area;
    }
  });
  return best;
}

export function scroll(direction: ScrollDirection, amount: ScrollAmount): string {
  const target = scrollTarget();
  const isDoc = target === document.scrollingElement || target === document.documentElement;
  const viewport = isDoc ? innerHeight : target.clientHeight;
  const factor = amount === "small" ? 0.4 : amount === "large" ? 2 : 0.85;
  const delta = Math.round(viewport * factor);
  const scroller: Element | Window = isDoc ? window : target;
  switch (direction) {
    case "top":
      scroller.scrollTo({ top: 0, behavior: "smooth" });
      break;
    case "bottom":
      scroller.scrollTo({ top: target.scrollHeight, behavior: "smooth" });
      break;
    case "up":
      scroller.scrollBy({ top: -delta, behavior: "smooth" });
      break;
    case "down":
      scroller.scrollBy({ top: delta, behavior: "smooth" });
      break;
    case "left":
      scroller.scrollBy({ left: -Math.round(innerWidth * factor), behavior: "smooth" });
      break;
    case "right":
      scroller.scrollBy({ left: Math.round(innerWidth * factor), behavior: "smooth" });
      break;
  }
  return `scrolled ${direction}`;
}

export function selectOption(el: Element, option: string): string {
  if (!(el instanceof HTMLSelectElement)) {
    click(el);
    return "opened the menu";
  }
  const wanted = option.trim().toLowerCase();
  const match =
    Array.from(el.options).find((o) => o.text.trim().toLowerCase() === wanted) ??
    Array.from(el.options).find((o) => o.text.toLowerCase().includes(wanted));
  if (!match) throw new Error(`No option called "${option}".`);
  el.value = match.value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  flash(el);
  return `selected ${match.text.trim()}`;
}

export function readPage(maxChars: number): string {
  const selection = window.getSelection()?.toString().trim();
  if (selection) return selection.slice(0, maxChars);
  const main =
    document.querySelector("article") ??
    document.querySelector("main, [role=main]") ??
    document.body;
  const text = ((main as HTMLElement).innerText ?? "").replace(/\n{3,}/g, "\n\n").trim();
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n[truncated]` : text;
}

function mainVideo(): HTMLVideoElement | null {
  const videos = Array.from(document.querySelectorAll("video"));
  let best: HTMLVideoElement | null = null;
  let bestArea = 0;
  for (const v of videos) {
    const r = v.getBoundingClientRect();
    const area = r.width * r.height;
    if (area > bestArea) {
      best = v;
      bestArea = area;
    }
  }
  return best;
}

export async function media(action: MediaAction, seconds = 10): Promise<string> {
  const video = mainVideo();
  if (!video) throw new Error("There's no video on this page.");
  switch (action) {
    case "play":
      await video.play();
      return "playing";
    case "pause":
      video.pause();
      return "paused";
    case "toggle":
      if (video.paused) await video.play();
      else video.pause();
      return video.paused ? "paused" : "playing";
    case "mute":
      video.muted = true;
      return "muted";
    case "unmute":
      video.muted = false;
      return "unmuted";
    case "forward":
      video.currentTime = Math.min(video.duration || Infinity, video.currentTime + seconds);
      return `skipped ahead ${seconds} seconds`;
    case "rewind":
      video.currentTime = Math.max(0, video.currentTime - seconds);
      return `went back ${seconds} seconds`;
    case "fullscreen":
      await video.requestFullscreen();
      return "full screen";
  }
}
