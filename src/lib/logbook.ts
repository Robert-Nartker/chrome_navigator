// The activity log, kept by the background worker: each entry is tagged with the command (turn) and
// the thread it belongs to, so any view (the side panel, opened at any time) can draw one card per
// command in each thread's feed. Kept in this browser profile, like the threads themselves.

import type { LogEntry, LogKind } from "./messages";

const KEY = "panelLog";
const MAX_ENTRIES = 500;

export class LogBook {
  private entries: LogEntry[] = [];
  /** The newest command. */
  private latest: string | undefined;
  /** The command being worked on. */
  private active: string | undefined;
  private seq = 0;
  private saveTimer: ReturnType<typeof setTimeout> | undefined;
  readonly ready: Promise<void>;

  /** `thread`: the thread entries from before threads existed belong to. */
  constructor(thread: Promise<string>) {
    // Older versions kept the log for the browser session only.
    const older = chrome.storage.session.get(KEY).then((data) => {
      void chrome.storage.session.remove(KEY);
      return (data as Record<string, LogEntry[] | undefined>)[KEY];
    });
    this.ready = Promise.all([chrome.storage.local.get(KEY), older.catch(() => undefined), thread])
      .then(([data, before, current]) => {
        const stored = (data as Record<string, LogEntry[] | undefined>)[KEY] ?? before ?? [];
        for (const entry of stored) entry.thread ??= current;
        this.entries = [...stored, ...this.entries].slice(-MAX_ENTRIES);
        this.latest = [...this.entries].reverse().find((e) => e.kind === "user")?.turn;
      })
      .catch(() => undefined);
  }

  get all(): LogEntry[] {
    return this.entries;
  }

  /** `solo`: a note of its own, not part of the command running now. */
  add(kind: LogKind, text: string, meta: string | undefined, thread: string, solo = false): LogEntry {
    const entry: LogEntry = { kind, text, t: Date.now(), thread };
    if (meta) entry.meta = meta;
    if (solo) {
      // No turn: shown as a note of its own.
    } else if (kind === "user") entry.turn = this.latest = this.newId();
    else if (this.active) entry.turn = this.active;
    else if (kind === "step") entry.turn = this.latest ?? (this.latest = this.newId());
    this.entries = [...this.entries, entry].slice(-MAX_ENTRIES);
    this.save();
    return entry;
  }

  /** Forgets the feeds of threads that were deleted. */
  keepThreads(ids: string[]) {
    const kept = this.entries.filter((e) => !e.thread || ids.includes(e.thread));
    if (kept.length === this.entries.length) return;
    this.entries = kept;
    this.save();
  }

  private save() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => void chrome.storage.local.set({ [KEY]: this.entries }).catch(() => undefined), 300);
  }

  /** The command just logged is the one being worked on. Returns it. */
  setWorking(on: boolean): string | undefined {
    this.active = on ? (this.active ?? this.latest) : undefined;
    return this.active;
  }

  private newId(): string {
    return `${Date.now().toString(36)}-${(++this.seq).toString(36)}`;
  }
}
