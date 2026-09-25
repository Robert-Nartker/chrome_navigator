// Finds the interactive elements on the page, names them the way a screen reader
// would, and numbers them top-to-bottom. Only labels leave the page, never page text.

import type { ElementInfo, PageSnapshot } from "../lib/protocol";

const INTERACTIVE_SELECTOR = [
  "a[href]",
  "button",
  "input:not([type=hidden])",
  "select",
  "textarea",
  "summary",
  "video",
  "[contenteditable='']",
  "[contenteditable='true']",
  "[onclick]",
  "[tabindex]:not([tabindex='-1'])",
  ...[
    "button",
    "link",
    "tab",
    "menuitem",
    "menuitemcheckbox",
    "menuitemradio",
    "checkbox",
    "radio",
    "switch",
    "option",
    "combobox",
    "textbox",
    "searchbox",
    "slider",
    "treeitem",
    "gridcell",
  ].map((r) => `[role='${r}']`),
].join(",");

const MAX_IN_VIEW = 180;
const MAX_BELOW = 60;
const MAX_NAME = 90;
const POINTER_SCAN_LIMIT = 2500;
const KEEP_GENERATIONS = 6;

let generation = 0;
const generations = new Map<number, Element[]>();

export function latestGeneration(): number {
  return generation;
}

/** Resolves a badge number to its element, using the given (or latest) snapshot. */
export function resolveElement(id: number, gen?: number): Element | null {
  const list = generations.get(gen ?? generation) ?? generations.get(generation);
  const el = list?.[id - 1];
  return el && el.isConnected ? el : null;
}

export function idOf(el: Element | null, gen = generation): number | undefined {
  if (!el) return undefined;
  const idx = generations.get(gen)?.indexOf(el) ?? -1;
  return idx >= 0 ? idx + 1 : undefined;
}

/** Collects elements across the document and any open shadow roots. */
function queryDeep(root: Document | ShadowRoot, selector: string, out: Element[]) {
  root.querySelectorAll(selector).forEach((el) => out.push(el));
  root.querySelectorAll("*").forEach((el) => {
    if (el.shadowRoot) queryDeep(el.shadowRoot, selector, out);
  });
}

function isRendered(el: Element, rect: DOMRect): boolean {
  if (rect.width < 3 || rect.height < 3) return false;
  const check = (el as HTMLElement).checkVisibility;
  if (typeof check === "function") {
    return el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
  }
  const style = getComputedStyle(el);
  return style.visibility !== "hidden" && style.display !== "none" && Number(style.opacity) > 0.05;
}

function isDisabled(el: Element): boolean {
  return (
    (el as HTMLButtonElement).disabled === true || el.getAttribute("aria-disabled") === "true"
  );
}

/** True if something else (e.g. a modal backdrop) sits on top of the element's center. */
function isOccluded(el: Element, rect: DOMRect): boolean {
  const x = Math.min(Math.max(rect.left + rect.width / 2, 0), innerWidth - 1);
  const y = Math.min(Math.max(rect.top + rect.height / 2, 0), innerHeight - 1);
  let hit = document.elementFromPoint(x, y);
  // Descend into open shadow roots so hits inside web components count.
  while (hit?.shadowRoot) {
    const inner = hit.shadowRoot.elementFromPoint(x, y);
    if (!inner || inner === hit) break;
    hit = inner;
  }
  if (!hit) return false;
  if (el.contains(hit) || hit.contains(el)) return false;
  const label = (el as HTMLInputElement).labels?.[0];
  if (label && label.contains(hit)) return false;
  return true;
}

function collapse(text: string | null | undefined): string {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

function truncate(text: string): string {
  return text.length > MAX_NAME ? `${text.slice(0, MAX_NAME - 1)}…` : text;
}

export function accessibleName(el: Element): string {
  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy) {
    const text = labelledBy
      .split(/\s+/)
      .map((id) => collapse(document.getElementById(id)?.textContent))
      .join(" ")
      .trim();
    if (text) return text;
  }
  const aria = collapse(el.getAttribute("aria-label"));
  if (aria) return aria;

  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
    const label = collapse(el.labels?.[0]?.textContent);
    if (label) return label;
    if (el instanceof HTMLInputElement && ["submit", "button", "reset"].includes(el.type)) {
      if (el.value) return collapse(el.value);
    }
    const placeholder = collapse(el.getAttribute("placeholder"));
    if (placeholder) return placeholder;
  }
  if (el instanceof HTMLImageElement && el.alt) return collapse(el.alt);

  const text = collapse((el as HTMLElement).innerText ?? el.textContent);
  if (text) return text;

  const img = el.querySelector("img[alt]");
  if (img) {
    const alt = collapse(img.getAttribute("alt"));
    if (alt) return alt;
  }
  const svgTitle = collapse(el.querySelector("svg title")?.textContent);
  if (svgTitle) return svgTitle;
  const title = collapse(el.getAttribute("title"));
  if (title) return title;
  const name = collapse(el.getAttribute("name"));
  return name;
}

export function roleOf(el: Element): string {
  const explicit = el.getAttribute("role");
  if (explicit) return explicit.split(/\s+/)[0];
  const tag = el.tagName.toLowerCase();
  if (tag === "a") return "link";
  if (tag === "button" || tag === "summary") return "button";
  if (tag === "select") return "combobox";
  if (tag === "textarea") return "textbox";
  if (tag === "video") return "video";
  if (tag === "input") {
    const type = (el as HTMLInputElement).type;
    if (type === "checkbox") return "checkbox";
    if (type === "radio") return "radio";
    if (type === "range") return "slider";
    if (type === "search") return "searchbox";
    if (["submit", "button", "reset", "image"].includes(type)) return "button";
    return "textbox";
  }
  if ((el as HTMLElement).isContentEditable) return "textbox";
  return "clickable";
}

/** Adds divs/spans that only look clickable (cursor: pointer), as many web apps use them. */
function pointerCandidates(existing: Set<Element>): Element[] {
  const found: Element[] = [];
  const all = document.body?.querySelectorAll("div, span, li, img, svg, i, label") ?? [];
  let scanned = 0;
  for (const el of all) {
    if (++scanned > POINTER_SCAN_LIMIT) break;
    if (existing.has(el)) continue;
    const rect = el.getBoundingClientRect();
    if (rect.bottom < 0 || rect.top > innerHeight * 2 || rect.width < 8 || rect.height < 8) continue;
    if (getComputedStyle(el).cursor !== "pointer") continue;
    const parent = el.parentElement;
    if (parent && getComputedStyle(parent).cursor === "pointer") continue;
    if (el.closest(INTERACTIVE_SELECTOR)) continue;
    found.push(el);
  }
  return found;
}

export function takeSnapshot(): PageSnapshot {
  const candidates: Element[] = [];
  queryDeep(document, INTERACTIVE_SELECTOR, candidates);
  const seen = new Set(candidates);
  candidates.push(...pointerCandidates(seen));

  type Entry = { el: Element; rect: DOMRect; inViewport: boolean };
  const entries: Entry[] = [];
  const kept = new Set<Element>();

  for (const el of candidates) {
    if (el.closest("navi-overlay, navi-grid")) continue;
    const rect = el.getBoundingClientRect();
    if (!isRendered(el, rect) || isDisabled(el)) continue;
    const inViewport =
      rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth;
    const below = rect.top >= innerHeight && rect.top < innerHeight * 3;
    if (!inViewport && !below) continue;
    if (inViewport && isOccluded(el, rect)) continue;
    entries.push({ el, rect, inViewport });
    kept.add(el);
  }

  // Drop elements nested in another kept element with the same label (e.g. <span> in <button>).
  const deduped = entries.filter(({ el }) => {
    let parent = el.parentElement;
    while (parent) {
      if (kept.has(parent)) {
        return accessibleName(parent) !== accessibleName(el) && roleOf(el) !== "clickable";
      }
      parent = parent.parentElement;
    }
    return true;
  });

  // Reading order: rows by vertical center (so a small icon beside a button shares its row), then left to right.
  const row = (e: Entry) => Math.round((e.rect.top + e.rect.bottom) / 2 / 16);
  const byPosition = (a: Entry, b: Entry) => row(a) - row(b) || a.rect.left - b.rect.left;
  const inView = deduped.filter((e) => e.inViewport).sort(byPosition).slice(0, MAX_IN_VIEW);
  const belowFold = deduped.filter((e) => !e.inViewport).sort(byPosition).slice(0, MAX_BELOW);
  const ordered = [...inView, ...belowFold];

  generation += 1;
  generations.set(
    generation,
    ordered.map((e) => e.el),
  );
  for (const g of generations.keys()) {
    if (g <= generation - KEEP_GENERATIONS) generations.delete(g);
  }

  const elements: ElementInfo[] = ordered.map(({ el, inViewport }, i) => {
    const info: ElementInfo = {
      id: i + 1,
      role: roleOf(el),
      name: truncate(accessibleName(el)),
      tag: el.tagName.toLowerCase(),
      inViewport,
    };
    if (el instanceof HTMLAnchorElement && el.href) {
      info.href = el.href.length > 120 ? `${el.href.slice(0, 119)}…` : el.href;
    }
    if (el instanceof HTMLInputElement) {
      info.inputType = el.type;
      if (el.type === "checkbox" || el.type === "radio") info.checked = el.checked;
      // Never expose password contents.
      else if (el.type !== "password" && el.value) info.value = truncate(el.value);
    } else if (el instanceof HTMLTextAreaElement && el.value) {
      info.value = truncate(el.value);
    } else if (el instanceof HTMLSelectElement) {
      info.value = truncate(el.selectedOptions[0]?.text ?? "");
    }
    const ariaChecked = el.getAttribute("aria-checked") ?? el.getAttribute("aria-selected");
    if (ariaChecked === "true" || ariaChecked === "false") info.checked = ariaChecked === "true";
    return info;
  });

  const scroller = document.scrollingElement ?? document.documentElement;
  return {
    gen: generation,
    url: location.href,
    title: document.title,
    elements,
    scrollY: Math.round(scrollY),
    scrollMax: Math.max(0, Math.round(scroller.scrollHeight - innerHeight)),
    focusedId: idOf(deepActiveElement()),
    dialogOpen: !!document.querySelector("dialog[open], [role=dialog]:not([aria-hidden=true]), [aria-modal=true]"),
    viewport: { width: innerWidth, height: innerHeight },
  };
}

export function deepActiveElement(): Element | null {
  let el: Element | null = document.activeElement;
  while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
  return el === document.body ? null : el;
}
