// Threads: separate conversations, like a chat app. Each keeps its own activity feed and AI
// conversation; what's said or typed goes to the current one. Kept in this browser profile.
//
// Only one command runs at a time, whichever thread it belongs to: a command for another thread
// waits its turn. Switching threads while Navi works is fine: the running command finishes in its
// own thread.

export interface ThreadExchange {
  said: string;
  reply: string;
  t: number;
}

export interface Thread {
  id: string;
  /** Empty until it's named, or titled from what was first asked in it. */
  title: string;
  /** The user named it (it's never retitled). */
  named: boolean;
  created: number;
  updated: number;
  /** Commands run in it. */
  turns: number;
  /** The latest exchanges with the AI, so a thread picks up where it left off. */
  exchanges: ThreadExchange[];
}

/** What views show. */
export interface ThreadSummary {
  id: string;
  title: string;
  updated: number;
}

export interface ThreadsState {
  current: string;
  /** The thread of the command running now, if one is. */
  running?: string;
  /** Most recently used first. */
  threads: ThreadSummary[];
}

const KEY = "naviThreads";
export const MAX_THREADS = 20;
const MAX_EXCHANGES = 20;
const UNTITLED = "New thread";

export function threadTitle(thread: Pick<Thread, "title">): string {
  return thread.title || UNTITLED;
}

/** A title from what was asked: its first words, capitalized. */
export function titleFrom(text: string): string {
  const words = text.replace(/\s+/g, " ").trim().replace(/[.?!]+$/, "");
  const short = words.length <= 40 ? words : `${words.slice(0, 40).replace(/\s+\S*$/, "")}…`;
  return short.charAt(0).toUpperCase() + short.slice(1);
}

const normalize = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\b(the|my|a|an|thread|conversation|chat)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const ORDINALS: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, one: 1, two: 2, three: 3, four: 4, five: 5 };

/**
 * The thread a spoken name refers to: "shopping" (its title, or words in it), "first" / "second"
 * (oldest first), "1", "last" or "previous" (the one used before this one). Null if none or unclear.
 */
export function findThread(name: string, threads: Thread[], current: string): Thread | null {
  const wanted = normalize(name);
  const others = threads.filter((t) => t.id !== current).sort((a, b) => b.updated - a.updated);
  if (/^(last|previous|other|old|older)$/.test(wanted)) return others[0] ?? null;
  const n = /^\d+$/.test(wanted) ? Number(wanted) : ORDINALS[wanted.replace(/^number /, "")];
  if (n) return [...threads].sort((a, b) => a.created - b.created)[n - 1] ?? null;
  if (!wanted) return null;
  const scored = threads
    .map((t) => {
      const title = normalize(threadTitle(t));
      const words = wanted.split(" ");
      const hits = words.filter((w) => title.split(" ").some((tw) => tw === w || (w.length > 3 && tw.startsWith(w.slice(0, -1))))).length;
      const score = title === wanted ? 2 : title.includes(wanted) ? 1.5 : hits / words.length;
      return { t, score };
    })
    .filter((s) => s.score >= 0.5)
    // On a tie, another thread beats the current one ("go back to …" means somewhere else).
    .sort((a, b) => b.score - a.score || Number(a.t.id === current) - Number(b.t.id === current) || b.t.updated - a.t.updated);
  const [best, next] = scored;
  if (!best) return null;
  // Two other threads match equally well: unclear.
  if (next && next.score === best.score && best.score < 2 && next.t.id !== current) return null;
  return best.t;
}

/** Earlier exchanges, for the AI when it picks a thread back up after its conversation expired. */
export function threadTranscript(thread: Thread, max = 6): string {
  const recent = thread.exchanges.slice(-max);
  if (!recent.length) return "";
  const lines = recent.map((e) => `User: ${e.said}\nNavi: ${e.reply}`).join("\n");
  return `Earlier in this thread (“${threadTitle(thread)}”), oldest first:\n${lines}`;
}

const newId = () => `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** Now, as a stamp that's always later than the last one, so "most recently used" never ties. */
let lastStamp = 0;
const stamp = () => (lastStamp = Math.max(Date.now(), lastStamp + 1));

function blank(title = ""): Thread {
  const now = stamp();
  return { id: newId(), title, named: !!title, created: now, updated: now, turns: 0, exchanges: [] };
}

/** The threads, kept by the background worker (the only writer). */
export class ThreadBook {
  private threads: Thread[] = [];
  private currentId = "";
  private runningId: string | undefined;
  private saveTimer: ReturnType<typeof setTimeout> | undefined;
  readonly ready: Promise<void>;

  constructor(private readonly onChange: (state: ThreadsState) => void = () => undefined) {
    this.ready = chrome.storage.local
      .get(KEY)
      .then((data) => {
        const stored = (data as Record<string, { current?: string; threads?: Thread[] } | undefined>)[KEY];
        this.threads = Array.isArray(stored?.threads) ? stored.threads : [];
        this.currentId = stored?.current ?? "";
      })
      .catch(() => undefined)
      .then(() => {
        if (!this.get(this.currentId)) {
          const latest = this.list()[0] ?? this.add(blank());
          this.currentId = latest.id;
        }
      });
  }

  get current(): string {
    return this.currentId;
  }

  /** The thread of the command running now: its log and reply go there even if the user switches away. */
  get running(): string | undefined {
    return this.runningId;
  }

  set running(id: string | undefined) {
    if (id === this.runningId) return;
    this.runningId = id;
    this.onChange(this.state());
  }

  currentThread(): Thread {
    return this.get(this.currentId) ?? this.list()[0];
  }

  get(id: string | undefined): Thread | undefined {
    return this.threads.find((t) => t.id === id);
  }

  /** Most recently used first (on a tie, the newer thread). */
  list(): Thread[] {
    return [...this.threads].reverse().sort((a, b) => b.updated - a.updated);
  }

  state(): ThreadsState {
    return {
      current: this.currentId,
      running: this.running,
      threads: this.list().map((t) => ({ id: t.id, title: threadTitle(t), updated: t.updated })),
    };
  }

  /** A new thread becomes the current one. The current thread is reused if nothing was done in it yet. */
  create(title = ""): Thread {
    const current = this.currentThread();
    let thread: Thread;
    if (current && current.turns === 0 && !current.exchanges.length && current.id !== this.running) {
      thread = current;
      if (title) Object.assign(thread, { title, named: true });
    } else {
      thread = this.add(blank(title));
    }
    this.currentId = thread.id;
    this.changed();
    return thread;
  }

  switchTo(id: string): Thread | undefined {
    const thread = this.get(id);
    if (!thread) return undefined;
    this.currentId = id;
    thread.updated = Math.max(thread.updated, stamp());
    this.changed();
    return thread;
  }

  rename(id: string, title: string) {
    const thread = this.get(id);
    if (!thread || !title.trim()) return;
    thread.title = title.trim();
    thread.named = true;
    this.changed();
  }

  /** Deletes a thread (never the one a command is running in). The current one is replaced by the latest other. */
  remove(id: string): boolean {
    if (id === this.running || !this.get(id)) return false;
    this.threads = this.threads.filter((t) => t.id !== id);
    if (id === this.currentId) this.currentId = (this.list()[0] ?? this.add(blank())).id;
    this.changed();
    return true;
  }

  /** A command ran in the thread. */
  noteTurn(id: string, said: string) {
    const thread = this.get(id);
    if (!thread) return;
    thread.turns++;
    thread.updated = stamp();
    if (!thread.title) thread.title = titleFrom(said);
    this.changed();
  }

  /** Something said to the AI in the thread, and its reply. The first one names an unnamed thread. */
  noteExchange(id: string, said: string, reply: string) {
    const thread = this.get(id);
    if (!thread) return;
    if (!thread.named && !thread.exchanges.length) thread.title = titleFrom(said);
    thread.exchanges = [...thread.exchanges, { said: said.slice(0, 1000), reply: reply.slice(0, 1000), t: Date.now() }].slice(-MAX_EXCHANGES);
    thread.updated = stamp();
    this.changed();
  }

  private add(thread: Thread): Thread {
    this.threads.push(thread);
    // Past the cap, the least recently used go (never the current or running one).
    while (this.threads.length > MAX_THREADS) {
      const oldest = [...this.threads]
        .sort((a, b) => a.updated - b.updated)
        .find((t) => t.id !== this.currentId && t.id !== this.running && t.id !== thread.id);
      if (!oldest) break;
      this.threads = this.threads.filter((t) => t !== oldest);
    }
    return thread;
  }

  private changed() {
    this.onChange(this.state());
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(
      () => void chrome.storage.local.set({ [KEY]: { current: this.currentId, threads: this.threads } }).catch(() => undefined),
      200,
    );
  }
}
