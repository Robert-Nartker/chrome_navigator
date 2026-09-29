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

/** Keys sorted at every level, so manifests compare by content (Chrome reports the one it loaded sorted). */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v);
}

/** The manifest on disk (canonical), if a build changed it since Chrome loaded it; only a full reload applies it. */
export async function staleManifest(): Promise<string | null> {
  try {
    const onDisk = (await (await fetch(chrome.runtime.getURL("manifest.json"), { cache: "no-store" })).json()) as Record<string, unknown>;
    const loaded = chrome.runtime.getManifest() as unknown as Record<string, unknown>;
    return Object.keys(onDisk).some((k) => canonical(onDisk[k]) !== canonical(loaded[k])) ? canonical(onDisk) : null;
  } catch {
    return null;
  }
}

/** Reloads the whole extension. `reopen`: the background opens this page again afterwards (a reload closes it). */
async function restartExtension(reopen: boolean) {
  if (reopen) await chrome.storage.local.set({ devReopen: location.pathname.slice(1) });
  chrome.runtime.reload();
}

/** Restarts if the manifest on disk is newer than the loaded one; true if it did. */
async function restartForManifest(reopen: boolean): Promise<boolean> {
  const disk = await staleManifest();
  if (!disk) return false;
  // Once per manifest: if Chrome ever reported a manifest differently from the file, this mustn't loop.
  const { devRestartedFor } = (await chrome.storage.local.get("devRestartedFor")) as { devRestartedFor?: string };
  if (devRestartedFor === disk) return false;
  await chrome.storage.local.set({ devRestartedFor: disk });
  await restartExtension(reopen);
  return true;
}

/** After a restart that `reopen` asked for, opens that page again (called by the background). */
export async function reopenAfterDevRestart() {
  const { devReopen } = (await chrome.storage.local.get("devReopen")) as { devReopen?: string };
  if (!devReopen) return;
  await chrome.storage.local.remove("devReopen");
  await chrome.tabs.create({ url: chrome.runtime.getURL(devReopen) });
}

/**
 * `background`: don't re-inject content scripts (Navi's background page can't; the panel or worker does).
 * `reopen`: this is a tab, which the background reopens after a full extension restart.
 */
export async function startDevReload(onStatus: (text: string) => void, { background = false, reopen = false } = {}) {
  // A manifest change (new permissions, cross-origin isolation) needs a full restart, which nothing may
  // have done if no Navi page was open when the build landed.
  if (await restartForManifest(reopen)) return onStatus("updating (extension restart)…");
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
      await restartExtension(reopen);
      return;
    }
    if (await restartForManifest(reopen)) {
      source.close();
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
