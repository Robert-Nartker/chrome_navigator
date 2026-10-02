// Browser-level control (tabs, navigation) plus a typed channel to the content
// script in the tab being controlled. Runs in Navi's background service worker.

import type { ContentRequest, ContentResponse, PageSnapshot } from "./protocol";

const WEB_URL = /^(https?|file|ftp):/;

class RestrictedPageError extends Error {
  constructor(url?: string) {
    super(
      url?.startsWith("chrome")
        ? "Chrome doesn't let extensions control its own pages. Open a website first."
        : "I can't control this page.",
    );
  }
}

export function isWebUrl(url?: string): boolean {
  return !!url && WEB_URL.test(url) && !url.startsWith("https://chromewebstore.google.com");
}

/**
 * The window Navi acts in for the command running now: the one it was given in, or the one Navi is
 * pinned to. Unset between commands.
 */
let workWindow: number | undefined;
/** The window Navi is pinned to, if it is (see window-pin.ts). */
let pinnedWindow: number | undefined;
/** Tests: stands in for the window with focus (headless Chrome doesn't move focus). */
let focusForTests: number | undefined;

export function setWorkWindow(id: number | undefined) {
  workWindow = id;
}

export function setPinnedWindow(id: number | undefined) {
  pinnedWindow = id;
}

export function setFocusedWindowForTests(id: number | undefined) {
  focusForTests = id;
}

/** The window the user is using. */
export async function focusedWindowId(): Promise<number | undefined> {
  if (focusForTests !== undefined) return focusForTests;
  return (await chrome.windows.getCurrent().catch(() => undefined))?.id;
}

/**
 * Navi's window: where the command running now was given, else the window Navi is pinned to, else the
 * one the user is using. Everything Navi shows or opens goes there (the pill, new tabs, the AI's work).
 */
export async function naviWindowId(): Promise<number | undefined> {
  return workWindow ?? pinnedWindow ?? (await focusedWindowId());
}
const windowId = naviWindowId;

/**
 * The tab Navi acts on: the active tab in its window, else that window's (or any) most recent web tab.
 * `inWindow`: a helper agent's own window instead.
 */
export async function targetTab(inWindow?: number): Promise<chrome.tabs.Tab> {
  const win = inWindow ?? (await windowId());
  const [active] = await chrome.tabs.query(win !== undefined ? { active: true, windowId: win } : { active: true, lastFocusedWindow: true });
  if (active && !isExtensionPage(active.url)) return active;
  const tabs = await chrome.tabs.query({});
  const web = tabs
    .filter((t) => isWebUrl(t.url))
    .sort((a, b) => Number(b.windowId === win) - Number(a.windowId === win) || (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0));
  if (web[0]) return web[0];
  if (active) return active;
  throw new Error("No tab to control.");
}

function isExtensionPage(url?: string) {
  return !!url && url.startsWith(`chrome-extension://${chrome.runtime.id}/`);
}

async function inject(tabId: number) {
  await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
}

/** Sends a request to the page, injecting the content script first if needed. */
async function sendToPage(tab: chrome.tabs.Tab, req: ContentRequest): Promise<ContentResponse> {
  if (tab.id === undefined) throw new Error("No tab to control.");
  if (!isWebUrl(tab.url)) throw new RestrictedPageError(tab.url);
  const send = () => chrome.tabs.sendMessage(tab.id!, req) as Promise<ContentResponse | undefined>;
  let res: ContentResponse | undefined;
  try {
    res = await send();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/port closed|message channel closed/i.test(message)) {
      // The action navigated away before the page could reply; it did run.
      return { ok: true, detail: "Done" };
    }
    if (!/Receiving end does not exist|Could not establish connection/i.test(message)) throw err;
    // Tabs opened before the extension was installed have no content script yet.
    try {
      await inject(tab.id);
    } catch {
      throw new RestrictedPageError(tab.url);
    }
    res = await send();
  }
  if (!res) throw new Error("The page didn't respond.");
  return res;
}

export async function pageRequest(tab: chrome.tabs.Tab, req: ContentRequest): Promise<ContentResponse & { ok: true }> {
  const res = await sendToPage(tab, req);
  if (!res.ok) throw new Error(res.error);
  return res;
}

export async function snapshot(tab: chrome.tabs.Tab): Promise<PageSnapshot> {
  const res = await pageRequest(tab, { kind: "snapshot" });
  if (!res.snapshot) throw new Error("Couldn't read the page.");
  return res.snapshot;
}

/** Waits until the tab finishes loading (or a timeout), then lets the page settle. */
export async function waitForLoad(tabId: number, timeoutMs = 8000): Promise<chrome.tabs.Tab> {
  const started = Date.now();
  const before = (await chrome.tabs.get(tabId).catch(() => undefined))?.url;
  // Give navigations triggered by a click a moment to start.
  await sleep(250);
  let first = true;
  while (Date.now() - started < timeoutMs) {
    const tab = await chrome.tabs.get(tabId);
    if (tab.status === "complete") {
      // Nothing started loading (a menu, a button on the page): no page to let settle.
      if (first && tab.url === before) return tab;
      await sleep(300);
      return chrome.tabs.get(tabId);
    }
    first = false;
    await sleep(150);
  }
  return chrome.tabs.get(tabId);
}

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** A tab with nothing in it yet: a new tab page or a blank one. */
function isBlankTab(url?: string): boolean {
  return !url || /^(?:about:blank|chrome:\/\/(?:newtab|new-tab-page)|chrome-search:\/\/local-ntp)/.test(url);
}

/**
 * Opens a URL in this tab, or with `newTab` in a new one next to it (a blank tab is simply reused).
 * Spoken commands decide by their verb: "open" opens a new tab, "go to" stays in this one.
 */
export async function navigate(url: string, newTab: boolean, inWindow?: number): Promise<chrome.tabs.Tab> {
  const current = await targetTab(inWindow).catch(() => undefined);
  const usable = !!current?.id && !isExtensionPage(current.url);
  if (!usable || (newTab && !isBlankTab(current.url))) {
    const tab = await chrome.tabs.create({
      url,
      active: true,
      ...(usable ? { index: current.index + 1, openerTabId: current.id, windowId: current.windowId } : { windowId: inWindow ?? (await windowId()) }),
    });
    return waitForLoad(tab.id!);
  }
  await chrome.tabs.update(current.id!, { url, active: true });
  return waitForLoad(current.id!);
}

/**
 * The tabs among these with typing that hasn't been sent or saved, which closing would lose. Tabs that
 * don't answer quickly (Chrome pages, tabs asleep in the background) count as having none.
 */
export async function tabsWithUnsavedTyping(tabs: chrome.tabs.Tab[]): Promise<chrome.tabs.Tab[]> {
  const ask = async (t: chrome.tabs.Tab) => {
    if (t.id === undefined || !isWebUrl(t.url) || t.discarded) return false;
    const reply = chrome.tabs.sendMessage(t.id, { kind: "unsaved" } satisfies ContentRequest) as Promise<ContentResponse | undefined>;
    const res = await Promise.race([reply.catch(() => undefined), sleep(500).then(() => undefined)]);
    return !!(res?.ok && res.unsaved);
  };
  const unsaved = await Promise.all(tabs.map(ask));
  return tabs.filter((_, i) => unsaved[i]);
}

/**
 * Goes back a page. A tab with nothing to go back to that was opened from another tab (by Navi, or a
 * link that opened a new tab) is closed instead, back to the tab it came from, as on a phone.
 */
export async function goBack(tab: chrome.tabs.Tab): Promise<chrome.tabs.Tab> {
  try {
    await chrome.tabs.goBack(tab.id!);
    return await waitForLoad(tab.id!);
  } catch {
    const opener = tab.openerTabId !== undefined ? await chrome.tabs.get(tab.openerTabId).catch(() => undefined) : undefined;
    if (!opener?.id) throw new Error(`There's no previous page in “${tab.title || tab.url || "this tab"}”.`);
    await chrome.tabs.update(opener.id, { active: true });
    await chrome.tabs.remove(tab.id!);
    return opener;
  }
}

/** The tabs in Navi's window (or `inWindow`). */
export async function listTabs(inWindow?: number): Promise<chrome.tabs.Tab[]> {
  const win = inWindow ?? (await windowId());
  const tabs = await chrome.tabs.query(win !== undefined ? { windowId: win } : { currentWindow: true });
  return tabs.filter((t) => !isExtensionPage(t.url));
}

/**
 * Moves a tab into a new window, or into the user's other window (the one used most recently), and
 * shows it there. Returns the window it went to.
 */
export async function moveTab(tab: chrome.tabs.Tab, to: "new" | "other"): Promise<number> {
  if (tab.id === undefined) throw new Error("No tab to move.");
  if (to === "new") {
    const win = await chrome.windows.create({ tabId: tab.id, focused: true });
    return win!.id!;
  }
  const others = (await chrome.tabs.query({ active: true, windowType: "normal" }))
    .filter((t) => t.windowId !== tab.windowId)
    .sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0));
  const target = others[0]?.windowId;
  if (target === undefined) throw new Error("There's no other window. Say “move this tab to a new window”.");
  await chrome.tabs.move(tab.id, { windowId: target, index: -1 });
  await chrome.tabs.update(tab.id, { active: true });
  await chrome.windows.update(target, { focused: true });
  return target;
}

/** Shows a tab. Its window comes to the front only if it's the one the user is using: Navi working in another window never takes focus. */
export async function activateTab(tab: chrome.tabs.Tab) {
  if (tab.id === undefined) return;
  await chrome.tabs.update(tab.id, { active: true });
  if (tab.windowId !== undefined && tab.windowId === (await focusedWindowId())) {
    await chrome.windows.update(tab.windowId, { focused: true });
  }
}

export async function cycleTab(offset: 1 | -1): Promise<chrome.tabs.Tab | undefined> {
  const tabs = await listTabs();
  const current = await targetTab();
  const idx = tabs.findIndex((t) => t.id === current.id);
  const next = tabs[(idx + offset + tabs.length) % tabs.length];
  if (next) await activateTab(next);
  return next;
}

export async function findTab(query: string): Promise<chrome.tabs.Tab | undefined> {
  const q = query.toLowerCase().replace(/\s+/g, " ").trim();
  const compact = q.replace(/\s+/g, "");
  const tabs = await listTabs();
  return (
    tabs.find((t) => (t.title ?? "").toLowerCase().includes(q)) ??
    tabs.find((t) => hostOf(t.url).includes(compact)) ??
    tabs.find((t) => (t.title ?? "").toLowerCase().replace(/\s+/g, "").includes(compact))
  );
}

/** All tabs whose title or site matches the name (for actions that must not guess). */
export async function matchingTabs(query: string): Promise<chrome.tabs.Tab[]> {
  const q = query.toLowerCase().replace(/\s+/g, " ").trim();
  const compact = q.replace(/\s+/g, "");
  if (!compact) return [];
  return (await listTabs()).filter(
    (t) =>
      (t.title ?? "").toLowerCase().includes(q) ||
      hostOf(t.url).includes(compact) ||
      (t.title ?? "").toLowerCase().replace(/\s+/g, "").includes(compact),
  );
}

export function hostOf(url?: string): string {
  try {
    return new URL(url ?? "").hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export async function zoom(direction: "in" | "out" | "reset") {
  const tab = await targetTab();
  if (tab.id === undefined) return;
  if (direction === "reset") return chrome.tabs.setZoom(tab.id, 0);
  const current = await chrome.tabs.getZoom(tab.id);
  const next = direction === "in" ? current * 1.2 : current / 1.2;
  await chrome.tabs.setZoom(tab.id, Math.min(5, Math.max(0.25, next)));
}
