// Content script entry: answers Navi's requests (from its background worker), and shows the floating pill.

import type { PillUpdate } from "../lib/messages";
import type { ContentRequest, ContentResponse } from "../lib/protocol";
import { autoScroll, click, edit, findOnPage, media, pressKey, readPage, scroll, selectOption, typeText } from "./actions";
import { clickAtPoint, gridActive, hideGrid, runGrid } from "./grid";
import { badgesVisible, destroyOverlay, displayedGeneration, hideBadges, refreshBadges, showBadges } from "./overlay";
import { destroyPill, startPill, updatePill } from "./pill";
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
      const detail = await runGrid(req.action, req.cells, req.image);
      return { ok: true, detail, gridActive: gridActive() };
    }
    case "clickAt":
      return { ok: true, detail: clickAtPoint(req.x, req.y) };
    case "autoScroll":
      return { ok: true, ...autoScroll(req.action) };
    case "find":
      return { ok: true, detail: findOnPage(req.text) };
    case "edit":
      return { ok: true, detail: edit(req.action) };
    case "print":
      window.setTimeout(() => window.print(), 50);
      return { ok: true, detail: "printing" };
  }
}

// A newer copy of this script (extension update or dev reload) replaces this one:
// tell any older copy in this page to stop, then take over.
window.dispatchEvent(new CustomEvent("navi:teardown"));

const onMessage = (
  req: ContentRequest | PillUpdate,
  _sender: chrome.runtime.MessageSender,
  sendResponse: (r: ContentResponse) => void,
) => {
  if ("type" in req) {
    if (req.type === "pill:update") updatePill(req);
    return false;
  }
  handle(req)
    .then(sendResponse)
    .catch((err: unknown) => sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }));
  return true; // keep the channel open for the async response
};
chrome.runtime.onMessage.addListener(onMessage);
startPill();

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
    destroyPill();
    hideGrid();
    autoScroll("stop");
    try {
      chrome.runtime.onMessage.removeListener(onMessage);
    } catch {
      // This copy's extension context is already gone.
    }
  },
  { once: true },
);
