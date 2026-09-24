// Content script entry: answers requests from the Navi side panel.

import type { ContentRequest, ContentResponse } from "../lib/protocol";
import { click, media, pressKey, readPage, scroll, selectOption, typeText } from "./actions";
import { badgesVisible, displayedGeneration, hideBadges, refreshBadges, showBadges } from "./overlay";
import { accessibleName, resolveElement, takeSnapshot } from "./snapshot";

declare global {
  interface Window {
    __naviContentLoaded?: boolean;
  }
}

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
    case "showBadges":
      return { ok: true, snapshot: showBadges() };
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
  }
}

if (!window.__naviContentLoaded) {
  window.__naviContentLoaded = true;
  chrome.runtime.onMessage.addListener((req: ContentRequest, _sender, sendResponse) => {
    handle(req)
      .then(sendResponse)
      .catch((err: unknown) =>
        sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }),
      );
    return true; // keep the channel open for the async response
  });
  // Keep badges in sync when single-page apps swap content without scrolling.
  let mutationTimer: number | undefined;
  new MutationObserver(() => {
    if (!badgesVisible()) return;
    window.clearTimeout(mutationTimer);
    mutationTimer = window.setTimeout(() => refreshBadges(takeSnapshot()), 400);
  }).observe(document.documentElement, { childList: true, subtree: true });
}
