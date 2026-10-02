// Navi's window: by default Navi works in the window the user is using (each command stays in the
// window it was given in, even if the user moves on). Pinned, Navi works only in one window, so the
// user can work in another while talking to Navi. Chrome's window ids last for the browser session.

const KEY = "naviPinnedWindow";

export class WindowPin {
  private id: number | undefined;
  readonly ready: Promise<void>;

  /** `onChange`: the pin changed; `closed` when its window was closed. */
  constructor(private readonly onChange: (id: number | undefined, closed: boolean) => void = () => undefined) {
    this.ready = chrome.storage.session
      .get(KEY)
      .then(async (data) => {
        const id = (data as Record<string, number | undefined>)[KEY];
        // Pinned to a window that has since closed (while this worker was stopped): unpinned.
        if (id !== undefined && (await chrome.windows.get(id).catch(() => undefined))) this.id = id;
      })
      .catch(() => undefined);
    chrome.windows.onRemoved.addListener((closed) => {
      if (closed === this.id) void this.set(undefined, true);
    });
  }

  /** The window Navi is pinned to, if it is. */
  get window(): number | undefined {
    return this.id;
  }

  async set(id: number | undefined, closed = false) {
    if (id === this.id) return;
    this.id = id;
    await (id === undefined ? chrome.storage.session.remove(KEY) : chrome.storage.session.set({ [KEY]: id })).catch(() => undefined);
    this.onChange(id, closed);
  }
}
