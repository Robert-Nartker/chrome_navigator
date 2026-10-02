// Navi's side panel, by window: which are open, and opening or closing one (the toolbar icon, the
// Alt+Shift+N shortcut, or by voice: "open the panel", "close the panel").

/** Open panels, by the window they belong to: each keeps a port connected while it's open. */
const openPanels = new Map<number, chrome.runtime.Port>();

/** A panel connected: it stays registered until it closes. */
export function registerPanel(port: chrome.runtime.Port) {
  const match = port.name.match(/^navi-panel:(\d+)$/);
  if (!match) return;
  const windowId = Number(match[1]);
  openPanels.set(windowId, port);
  port.onDisconnect.addListener(() => {
    if (openPanels.get(windowId) === port) openPanels.delete(windowId);
  });
}

export function panelOpen(windowId: number): boolean {
  return openPanels.has(windowId);
}

/** Closes the panel in a window (Chrome 141+ closes side panels itself; otherwise the panel closes itself). */
export async function closePanel(windowId: number): Promise<boolean> {
  const open = openPanels.get(windowId);
  if (!open) return false;
  // The panel closes itself (a side panel, or the window it opened as); Chrome 141+ can also close side panels.
  try {
    open.postMessage({ type: "navi:close-panel" });
  } catch {
    // Already closing.
  }
  const close = (chrome.sidePanel as { close?: (o: { windowId: number }) => Promise<void> }).close;
  await close?.({ windowId }).catch(() => undefined);
  return true;
}

/**
 * Opens the panel in a window. Chrome opens the side panel only from a click or a shortcut, so when
 * asked by voice Navi opens the same panel as a small window along the right edge of that window.
 * Returns how it opened.
 */
export async function openPanel(windowId: number): Promise<"side" | "window" | "already"> {
  if (openPanels.has(windowId)) return "already";
  try {
    await chrome.sidePanel.open({ windowId });
    return "side";
  } catch {
    const win = await chrome.windows.get(windowId);
    const width = 400;
    const url = chrome.runtime.getURL(`sidepanel.html?window=${windowId}`);
    // Along the window's right edge; where Chrome won't place it there (off screen), wherever it likes.
    await chrome.windows
      .create({
        url,
        type: "popup",
        width,
        height: win.height,
        left: Math.max(0, (win.left ?? 0) + (win.width ?? width) - width),
        top: win.top,
        focused: false,
      })
      .catch(() => chrome.windows.create({ url, type: "popup", width, focused: false }));
    return "window";
  }
}
