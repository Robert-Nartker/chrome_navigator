// Service worker: opens the side panel from the toolbar icon or Alt+Shift+N,
// and shows the setup page on first install.

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined);

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    void chrome.tabs.create({ url: chrome.runtime.getURL("setup.html") });
  }
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
