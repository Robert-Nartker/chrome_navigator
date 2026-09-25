// Content script entry: answers requests from the Navi side panel.

import type { ContentRequest, ContentResponse } from "../lib/protocol";
import { click, media, pressKey, readPage, scroll, selectOption, typeText } from "./actions";
import { backGrid, clickAtPoint, clickGrid, gridActive, hideGrid, showGrid, zoomGrid } from "./grid";
import { badgesVisible, destroyOverlay, displayedGeneration, hideBadges, refreshBadges, showBadges } from "./overlay";
import { accessibleName, resolveElement, takeSnapshot } from "./snapshot";

function element(id: number, gen?: number): Element {
  // Numbers the user reads off the screen refer to the badges currently shown.
  const el = resolveElement(id, gen ?? displayedGeneration());
  if (!el) throw new Error(`I can't find number ${id} anymore. The page may have changed.`);
  return el;
}

async function handle(req: ContentRequest): Promise<ContentResponse> {
  switch (req.kind) {
    case "ping":
      return { ok: true };
    case "snapshot": {
      const snapshot = takeSnapshot();
      refreshBadges(snapshot);
      return { ok: true, snapshot };
    }
    case "showBadges": {
      const was = badgesVisible();
      return { ok: true, snapshot: showBadges(), detail: was ? "visible" : "hidden" };
    }
    case "hideBadges":
      hideBadges();
      return { ok: true };
    case "click": {
      const el = element(req.id, req.gen);
      const name = accessibleName(el);
      click(el);
      return { ok: true, detail: name ? `Clicked ${name}` : "Clicked" };
    }
    case "type": {
      const target = req.id !== undefined ? element(req.id, req.gen) : null;
      return { ok: true, detail: typeText(target, req.text, req.submit, req.clear) };
    }
    case "select":
      return { ok: true, detail: selectOption(element(req.id, req.gen), req.option) };
    case "scroll":
      return { ok: true, detail: scroll(req.direction, req.amount) };
    case "pressKey":
      return { ok: true, detail: pressKey(req.key) };
    case "readPage":
      return { ok: true, text: readPage(req.maxChars) };
    case "media":
      return { ok: true, detail: await media(req.action, req.seconds) };
    case "grid": {
      let detail: string;
      switch (req.action) {
        case "show":
          detail = showGrid();
          break;
        case "zoom":
          detail = zoomGrid(req.cell ?? 5);
          break;
        case "back":
          detail = backGrid();
          break;
        case "click":
          detail = clickGrid(req.cell);
          break;
        case "hide":
          hideGrid();
          detail = "Grid hidden";
          break;
      }
      return { ok: true, detail, gridActive: gridActive() };
    }
    case "clickAt":
      return { ok: true, detail: clickAtPoint(req.x, req.y) };
  }
}

// A newer copy of this script (extension update or dev reload) replaces this one:
// tell any older copy in this page to stop, then take over.
window.dispatchEvent(new CustomEvent("navi:teardown"));

const onMessage = (req: ContentRequest, _sender: chrome.runtime.MessageSender, sendResponse: (r: ContentResponse) => void) => {
  handle(req)
    .then(sendResponse)
    .catch((err: unknown) => sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }));
  return true; // keep the channel open for the async response
};
chrome.runtime.onMessage.addListener(onMessage);

// Keep badges in sync when single-page apps swap content without scrolling.
let mutationTimer: number | undefined;
const observer = new MutationObserver(() => {
  if (!badgesVisible()) return;
  window.clearTimeout(mutationTimer);
  mutationTimer = window.setTimeout(() => refreshBadges(takeSnapshot()), 400);
});
observer.observe(document.documentElement, { childList: true, subtree: true });

window.addEventListener(
  "navi:teardown",
  () => {
    observer.disconnect();
    window.clearTimeout(mutationTimer);
    destroyOverlay();
    hideGrid();
    try {
      chrome.runtime.onMessage.removeListener(onMessage);
    } catch {
      // This copy's extension context is already gone.
    }
  },
  { once: true },
);
