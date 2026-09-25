// Service worker: opens the side panel from the toolbar icon or Alt+Shift+N,
// shows the setup page on first install, and refreshes content scripts on update.

import { loadedDevBuild, reinjectContentScripts } from "./lib/dev-reload";

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined);

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    void chrome.tabs.create({ url: chrome.runtime.getURL("setup.html") });
  }
  // Tabs that were open before an update still run the old content script; swap in the new one.
  if (details.reason === "update") void reinjectContentScripts();
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (command !== "open-navi") return;
  const windowId = tab?.windowId;
  if (windowId === undefined) return;
  // Opening must happen synchronously within the shortcut's user gesture.
  chrome.sidePanel.open({ windowId }).catch(() => undefined);
  // If the panel is already open, toggle listening instead.
  void chrome.runtime.sendMessage({ type: "navi:toggle-listening" }).catch(() => undefined);
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
