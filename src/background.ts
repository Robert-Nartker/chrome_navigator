// Service worker: runs Navi (commands, AI, the activity log; see background/navi.ts), opens the side
// panel from the toolbar icon or Alt+Shift+N, shows the setup page on first install, and refreshes
// content scripts on update.

import { startNavi } from "./background/navi";
import { loadedDevBuild, reinjectContentScripts } from "./lib/dev-reload";

startNavi();

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined);

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    void chrome.tabs.create({ url: chrome.runtime.getURL("setup.html") });
  }
  // Tabs that were open before an update still run the old content script; swap in the new one.
  if (details.reason === "update") void reinjectContentScripts();
});

/** Side panels that are open, by window: each panel keeps a port connected while it's open. */
const openPanels = new Map<number, chrome.runtime.Port>();

chrome.runtime.onConnect.addListener((port) => {
  const match = port.name.match(/^navi-panel:(\d+)$/);
  if (!match) return;
  const windowId = Number(match[1]);
  openPanels.set(windowId, port);
  port.onDisconnect.addListener(() => {
    if (openPanels.get(windowId) === port) openPanels.delete(windowId);
  });
});

// Alt+Shift+N (Option+Shift+N on a Mac) opens the panel, or closes it if it's open.
chrome.commands.onCommand.addListener((command, tab) => {
  if (command !== "open-navi") return;
  const windowId = tab?.windowId;
  if (windowId === undefined) return;
  const open = openPanels.get(windowId);
  if (open) {
    // sidePanel.close() is Chrome 141+; older versions: the panel closes itself.
    const close = (chrome.sidePanel as { close?: (o: { windowId: number }) => Promise<void> }).close;
    if (close) close({ windowId }).catch(() => open.postMessage({ type: "navi:close-panel" }));
    else open.postMessage({ type: "navi:close-panel" });
    return;
  }
  // Opening must happen synchronously within the shortcut's user gesture.
  chrome.sidePanel.open({ windowId }).catch(() => undefined);
});

if (__DEV__) {
  // Which build this worker started with, so the side panel knows when a full reload is needed.
  const started = loadedDevBuild();
  chrome.runtime.onMessage.addListener((msg: { type?: string }, _sender, sendResponse) => {
    if (msg.type !== "navi:dev-full-hash") return;
    void started.then((build) => sendResponse(build?.fullHash ?? null));
    return true;
  });
}
