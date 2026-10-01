// Navi's separately built modules (its voice, Parakeet), imported only when first needed.

/**
 * Imports one of Navi's modules by its path in the extension. Chrome remembers a failed import for that
 * address (e.g. one that ran while an update was replacing the files), so the second try uses a fresh one.
 */
export async function loadModule<T>(path: string): Promise<T> {
  const url = chrome.runtime.getURL(path);
  try {
    return (await import(url)) as T;
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    return (await import(`${url}?retry=${Date.now()}`)) as T;
  }
}
