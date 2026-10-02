// Service worker: runs Navi (commands, AI, the activity log; see background/navi.ts), opens the side
// panel from the toolbar icon or Alt+Shift+N, takes the "talk now" shortcut and address-bar typing,
// shows the setup page on first install, and refreshes content scripts on update.

import { runTyped, startNavi, toggleWake } from "./background/navi";
import { loadedDevBuild, reinjectContentScripts, reopenAfterDevRestart } from "./lib/dev-reload";
import { closePanel, panelOpen, registerPanel } from "./background/panels";

startNavi();

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined);

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    void chrome.tabs.create({ url: chrome.runtime.getURL("setup.html") });
  }
  // Tabs that were open before an update still run the old content script; swap in the new one.
  if (details.reason === "update") void reinjectContentScripts();
});

chrome.runtime.onConnect.addListener(registerPanel);

// Type to Navi from the address bar: "navi", a space, then a command or question.
chrome.omnibox.setDefaultSuggestion({ description: "Ask Navi or run a command (the answer shows on the page)" });
chrome.omnibox.onInputEntered.addListener((text) => runTyped(text));

// Ctrl+Space (push to talk): talk to Navi now, without saying its name (or put it back to sleep).
// Alt+Shift+N (Option+Shift+N on a Mac) opens the panel, or closes it if it's open.
chrome.commands.onCommand.addListener((command, tab) => {
  if (command === "wake-navi") {
    void toggleWake();
    return;
  }
  if (command !== "open-navi") return;
  const windowId = tab?.windowId;
  if (windowId === undefined) return;
  if (panelOpen(windowId)) {
    void closePanel(windowId);
    return;
  }
  // Opening must happen synchronously within the shortcut's user gesture.
  chrome.sidePanel.open({ windowId }).catch(() => undefined);
});

if (__DEV__) {
  void reopenAfterDevRestart();
  // Which build this worker started with, so the side panel knows when a full reload is needed.
  const started = loadedDevBuild();
  chrome.runtime.onMessage.addListener((msg: { type?: string }, _sender, sendResponse) => {
    if (msg.type !== "navi:dev-full-hash") return;
    void started.then((build) => sendResponse(build?.fullHash ?? null));
    return true;
  });
}
