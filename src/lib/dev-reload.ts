// Dev builds only (`npm run dev`): listens to the local dev server and reloads
// Navi when a new build lands, so testing a change needs no clicks.

interface DevBuild {
  buildId: number;
  fullHash: string;
  commit: string;
}

const DEV_SERVER = "http://localhost:35729/events";

export async function loadedDevBuild(): Promise<DevBuild | null> {
  try {
    return (await (await fetch(chrome.runtime.getURL("dev-build.json"), { cache: "no-store" })).json()) as DevBuild;
  } catch {
    return null;
  }
}

/** Re-injects the latest content script into open tabs (the old copy tears itself down). */
export async function reinjectContentScripts() {
  const tabs = await chrome.tabs.query({ url: ["http://*/*", "https://*/*", "file:///*"] });
  await Promise.all(
    tabs.map((tab) =>
      tab.id === undefined
        ? undefined
        : chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] }).catch(() => undefined),
    ),
  );
}

/** `background`: in Navi's background page, which can't re-inject content scripts (the panel or worker does). */
export async function startDevReload(onStatus: (text: string) => void, { background = false } = {}) {
  const mine = await loadedDevBuild();
  // What the background worker loaded; it only changes on a full extension reload.
  const loadedFullHash = (await chrome.runtime.sendMessage({ type: "navi:dev-full-hash" }).catch(() => null)) as
    | string
    | null;
  onStatus(mine ? `dev build #${mine.buildId}` : "dev build");

  const source = new EventSource(DEV_SERVER);
  source.onmessage = async (event) => {
    const latest = JSON.parse(event.data) as DevBuild;
    const stale = [mine?.fullHash, loadedFullHash].some((hash) => hash && hash !== latest.fullHash);
    if (latest.fullHash && stale) {
      onStatus("updating (extension restart)…");
      source.close();
      chrome.runtime.reload();
      return;
    }
    if (mine && latest.buildId !== mine.buildId) {
      onStatus(`updating to #${latest.buildId}…`);
      source.close();
      if (!background) await reinjectContentScripts();
      location.reload();
    }
  };
  source.onerror = () => onStatus(mine ? `dev build #${mine.buildId} · dev server offline` : "dev server offline");
  source.onopen = () => onStatus(mine ? `dev build #${mine.buildId} · ${mine.commit}` : "dev build");
}
