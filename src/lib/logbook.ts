// The activity log, kept by the background worker: each entry is tagged with the command (turn) it
// belongs to, so any view (the side panel, opened at any time) can draw one card per command.
// Saved for the browser session, so closing and reopening the panel doesn't wipe it.

import type { LogEntry, LogKind } from "./messages";

const KEY = "panelLog";
const MAX_ENTRIES = 200;

export class LogBook {
  private entries: LogEntry[] = [];
  /** The newest command. */
  private latest: string | undefined;
  /** The command being worked on. */
  private active: string | undefined;
  private seq = 0;
  private saveTimer: ReturnType<typeof setTimeout> | undefined;
  readonly ready: Promise<void>;

  constructor() {
    this.ready = chrome.storage.session
      .get(KEY)
      .then((data) => {
        const stored = (data as Record<string, LogEntry[] | undefined>)[KEY] ?? [];
        this.entries = [...stored, ...this.entries].slice(-MAX_ENTRIES);
        this.latest = [...this.entries].reverse().find((e) => e.kind === "user")?.turn;
      })
      .catch(() => undefined);
  }

  get all(): LogEntry[] {
    return this.entries;
  }

  add(kind: LogKind, text: string, meta?: string): LogEntry {
    const entry: LogEntry = { kind, text, t: Date.now() };
    if (meta) entry.meta = meta;
    if (kind === "user") entry.turn = this.latest = this.newId();
    else if (this.active) entry.turn = this.active;
    else if (kind === "step") entry.turn = this.latest ?? (this.latest = this.newId());
    this.entries = [...this.entries, entry].slice(-MAX_ENTRIES);
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => void chrome.storage.session.set({ [KEY]: this.entries }).catch(() => undefined), 300);
    return entry;
  }

  /** The command just logged is the one being worked on. */
  setWorking(on: boolean) {
    this.active = on ? (this.active ?? this.latest) : undefined;
  }

  private newId(): string {
    return `${Date.now().toString(36)}-${(++this.seq).toString(36)}`;
  }
}
