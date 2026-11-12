// Moving through a page by its structure, the way screen reader users do: headings, links, form fields,
// buttons and regions. "Next heading" moves to the next one after where the user is, scrolls it into
// view, briefly outlines it, focuses it when it can take focus (so "type …" goes into a field), and
// says what it is.

import type { StructureAction, StructureKind } from "../lib/protocol";
import { accessibleName } from "./snapshot";

const SELECTORS: Record<StructureKind, string> = {
  heading: "h1, h2, h3, h4, h5, h6, [role=heading]",
  link: "a[href], [role=link]",
  field:
    "input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=reset]):not([type=image]), textarea, select, " +
    "[contenteditable=''], [contenteditable=true], [role=textbox], [role=searchbox], [role=combobox], [role=checkbox], [role=radio], [role=switch], [role=slider], [role=spinbutton]",
  button: "button, [role=button], input[type=submit], input[type=button], input[type=reset], input[type=image], summary",
  landmark:
    "main, nav, aside, header, footer, form[aria-label], form[aria-labelledby], section[aria-label], section[aria-labelledby], search, " +
    "[role=main], [role=navigation], [role=banner], [role=contentinfo], [role=complementary], [role=search], [role=region], [role=form]",
};

const PLURAL: Record<StructureKind, string> = { heading: "headings", link: "links", field: "form fields", button: "buttons", landmark: "regions" };
const SINGULAR: Record<StructureKind, string> = { heading: "heading", link: "link", field: "form field", button: "button", landmark: "region" };

/** Where the user is: the last thing moved to, else what has focus, else the top of what's on screen. */
let cursor: Element | null = null;

function shown(el: Element): boolean {
  if (el.closest("[aria-hidden=true], [hidden], #navi-overlay, #navi-pill")) return false;
  const style = getComputedStyle(el);
  if (style.display === "none" || style.visibility === "hidden") return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 || rect.height > 0;
}

function collect(kind: StructureKind): Element[] {
  const all = Array.from(document.querySelectorAll(SELECTORS[kind])).filter(shown);
  // Landmarks: a header or footer counts only at the top level (not inside an article).
  if (kind === "landmark") return all.filter((el) => !/^(header|footer)$/i.test(el.tagName) || !el.closest("article, aside, main, nav, section"));
  return all;
}

function headingLevel(el: Element): number {
  const m = /^H([1-6])$/.exec(el.tagName);
  return m ? Number(m[1]) : Number(el.getAttribute("aria-level")) || 2;
}

/** Where the user is now, in document order. */
function here(): Element | null {
  if (cursor?.isConnected) return cursor;
  const focused = document.activeElement;
  if (focused && focused !== document.body && focused !== document.documentElement) return focused;
  return null;
}

const before = (a: Element, b: Element) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

/** The first element at or below the top of the screen: where "next" starts when nothing was visited yet. */
function firstOnScreen(items: Element[]): number {
  const i = items.findIndex((el) => el.getBoundingClientRect().bottom > 0);
  return i < 0 ? items.length : i;
}

function landmarkName(el: Element): string {
  const role = el.getAttribute("role") ?? "";
  const tag = el.tagName.toLowerCase();
  const kind =
    role === "main" || tag === "main"
      ? "Main content"
      : role === "navigation" || tag === "nav"
        ? "Navigation"
        : role === "banner" || tag === "header"
          ? "Page header"
          : role === "contentinfo" || tag === "footer"
            ? "Page footer"
            : role === "complementary" || tag === "aside"
              ? "Side panel"
              : role === "search" || tag === "search"
                ? "Search"
                : role === "form" || tag === "form"
                  ? "Form"
                  : "Region";
  const label = (el.getAttribute("aria-label") ?? "").trim() || (el.getAttribute("aria-labelledby") ? accessibleName(el) : "");
  return label ? `${kind}: ${label}` : kind;
}

function fieldState(el: Element): string {
  const role = el.getAttribute("role");
  if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) {
    return `${el.type === "radio" ? "radio button" : "checkbox"}, ${el.checked ? "checked" : "not checked"}`;
  }
  if (role === "checkbox" || role === "radio" || role === "switch") {
    return `${role}, ${el.getAttribute("aria-checked") === "true" ? "checked" : "not checked"}`;
  }
  if (el instanceof HTMLSelectElement) return `menu, ${el.selectedOptions[0]?.textContent?.trim() || "nothing chosen"}`;
  const value =
    el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ? el.value : (el as HTMLElement).isContentEditable ? (el.textContent ?? "") : "";
  const kind = el instanceof HTMLInputElement && el.type === "password" ? "password field" : "text field";
  // A password is never read out.
  if (kind === "password field") return `${kind}, ${value ? "filled in" : "empty"}`;
  return `${kind}, ${value.trim() ? `says “${value.trim().slice(0, 80)}”` : "empty"}`;
}

/** What the user hears about an element: what it is, what it says, and where it is in the list. */
function describe(el: Element, kind: StructureKind, index: number, total: number): string {
  const name = kind === "landmark" ? landmarkName(el) : accessibleName(el) || "no label";
  const where = `${index + 1} of ${total}`;
  switch (kind) {
    case "heading":
      return `${name}, heading level ${headingLevel(el)} (${where})`;
    case "link":
      return `${name}, link (${where})`;
    case "button":
      return `${name}, button (${where})`;
    case "field":
      return `${name}, ${fieldState(el)} (${where})`;
    case "landmark":
      return `${name} (${where})`;
  }
}

let outline: HTMLDivElement | null = null;
let outlineTimer: number | undefined;

/** A brief outline around the element, for anyone watching. */
function highlight(el: Element) {
  const rect = el.getBoundingClientRect();
  outline ??= Object.assign(document.createElement("div"), { id: "navi-structure-outline" });
  Object.assign(outline.style, {
    position: "fixed",
    left: `${rect.left - 4}px`,
    top: `${rect.top - 4}px`,
    width: `${rect.width + 8}px`,
    height: `${rect.height + 8}px`,
    border: "3px solid #4f46e5",
    borderRadius: "6px",
    pointerEvents: "none",
    zIndex: "2147483646",
    boxShadow: "0 0 0 3px rgba(255,255,255,.8)",
  });
  document.documentElement.append(outline);
  window.clearTimeout(outlineTimer);
  outlineTimer = window.setTimeout(() => outline?.remove(), 1800);
}

function moveTo(el: Element, kind: StructureKind, items: Element[]): string {
  cursor = el;
  el.scrollIntoView({ block: "center", behavior: "instant" as ScrollBehavior });
  // Links, fields and buttons take focus, so the next "type …" or "press enter" goes there.
  if (kind !== "heading" && kind !== "landmark") (el as HTMLElement).focus?.({ preventScroll: true });
  highlight(el);
  return describe(el, kind, items.indexOf(el), items.length);
}

/** Words a name has in common with what was asked for, as a share of the asked words. */
function overlap(name: string, asked: string): number {
  const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w.length > 1);
  const want = words(asked);
  if (!want.length) return 0;
  const have = new Set(words(name));
  return want.filter((w) => have.has(w) || [...have].some((h) => h.startsWith(w) || w.startsWith(h))).length / want.length;
}

/** The text of the section the user is in: from its heading to the next heading of the same or a higher level. */
function sectionText(maxChars: number): string {
  const headings = collect("heading");
  const at = here();
  let start = at ? [...headings].reverse().find((h) => h === at || before(h, at)) : undefined;
  start ??= headings[Math.max(0, firstOnScreen(headings) - 1)] ?? headings[0];
  if (!start) throw new Error("This page has no headings, so it has no sections to read. Say “read this page” instead.");
  const level = headingLevel(start);
  const end = headings.slice(headings.indexOf(start) + 1).find((h) => headingLevel(h) <= level);
  const range = document.createRange();
  range.setStartBefore(start);
  if (end) range.setEndBefore(end);
  else range.setEndAfter(document.body.lastChild ?? document.body);
  const text = range.toString().replace(/\s+\n/g, "\n").replace(/\n{3,}/g, "\n\n").replace(/[ \t]+/g, " ").trim();
  cursor = start;
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n[truncated]` : text;
}

export function structure(kind: StructureKind, action: StructureAction, name?: string): { detail?: string; text?: string } {
  if (action === "readSection") return { text: sectionText(6000) };
  const items = collect(kind);
  if (!items.length) throw new Error(`There are no ${PLURAL[kind]} on this page.`);
  switch (action) {
    case "list": {
      const shownItems = items.slice(0, 12).map((el, i) => `${i + 1}, ${kind === "landmark" ? landmarkName(el) : accessibleName(el) || "no label"}`);
      const more = items.length > 12 ? ` The first 12: ` : ": ";
      return { detail: `${items.length} ${items.length === 1 ? SINGULAR[kind] : PLURAL[kind]}${more}${shownItems.join(". ")}.` };
    }
    case "first":
      return { detail: moveTo(items[0], kind, items) };
    case "last":
      return { detail: moveTo(items[items.length - 1], kind, items) };
    case "next":
    case "previous": {
      const at = here();
      let index: number;
      if (at) {
        index =
          action === "next"
            ? items.findIndex((el) => el !== at && !el.contains(at) && before(at, el))
            : lastIndex(items, (el) => el !== at && !at.contains(el) && before(el, at));
      } else {
        const top = firstOnScreen(items);
        index = action === "next" ? (top < items.length ? top : -1) : top - 1;
      }
      if (index < 0) throw new Error(`No ${action === "next" ? "more" : "earlier"} ${PLURAL[kind]} ${action === "next" ? "after" : "before"} this point.`);
      return { detail: moveTo(items[index], kind, items) };
    }
    case "jump": {
      const asked = (name ?? "").trim();
      const scored = items.map((el) => ({ el, score: overlap(kind === "landmark" ? landmarkName(el) : accessibleName(el), asked) }));
      const best = scored.reduce((a, b) => (b.score > a.score ? b : a), { el: items[0], score: 0 });
      if (best.score < 0.5) throw new Error(`There's no ${SINGULAR[kind]} called “${asked}” on this page.`);
      return { detail: moveTo(best.el, kind, items) };
    }
  }
}

function lastIndex<T>(items: T[], test: (item: T) => boolean): number {
  for (let i = items.length - 1; i >= 0; i--) if (test(items[i])) return i;
  return -1;
}

/** Forget where the user was (a new page). */
export function resetStructure() {
  cursor = null;
  outline?.remove();
}
