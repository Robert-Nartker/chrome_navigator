import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseCommand } from "../../src/lib/parser";
import { MAX_THREADS, type Thread, ThreadBook, findThread, threadTranscript, titleFrom } from "../../src/lib/threads";

// chrome.storage.local, in memory.
let store: Record<string, unknown> = {};
vi.stubGlobal("chrome", {
  storage: {
    local: {
      get: async (k: string) => (k in store ? { [k]: structuredClone(store[k]) } : {}),
      set: async (items: Record<string, unknown>) => void Object.assign(store, structuredClone(items)),
    },
  },
});

const thread = (id: string, title: string, created: number, updated = created): Thread => ({
  id, title, named: false, created, updated, turns: 1, exchanges: [],
});

beforeEach(() => {
  store = {};
  vi.useRealTimers();
});

describe("thread commands", () => {
  it("are understood however they're said", () => {
    expect(parseCommand("new thread")).toEqual({ type: "newThread" });
    expect(parseCommand("let's start a new conversation")).toEqual({ type: "newThread" });
    expect(parseCommand("start a new thread about trip planning")).toEqual({ type: "newThread", title: "Trip planning" });
    expect(parseCommand("go back to the shopping thread")).toEqual({ type: "switchThread", name: "shopping" });
    expect(parseCommand("switch to my Wordle conversation")).toEqual({ type: "switchThread", name: "wordle" });
    expect(parseCommand("previous thread")).toEqual({ type: "switchThread", name: "previous" });
    expect(parseCommand("go to thread 2")).toEqual({ type: "switchThread", name: "2" });
    expect(parseCommand("what threads do I have")).toEqual({ type: "listThreads" });
    expect(parseCommand("rename this thread to groceries")).toEqual({ type: "renameThread", title: "Groceries" });
  });

  it("don't take over tab and page commands", () => {
    expect(parseCommand("go back")?.type).toBe("back");
    expect(parseCommand("go to youtube")?.type).toBe("open");
    expect(parseCommand("new tab")?.type).toBe("newTab");
    expect(parseCommand("previous tab")?.type).toBe("prevTab");
    expect(parseCommand("new line")).toEqual({ type: "edit", action: "newline" });
  });
});

describe("finding a thread by name", () => {
  const threads = [thread("a", "Shopping for a desk", 1, 50), thread("b", "Trip planning", 2, 40), thread("c", "Wordle", 3, 60)];

  it("by words in its title, ignoring filler", () => {
    expect(findThread("shopping", threads, "c")?.id).toBe("a");
    expect(findThread("the trip", threads, "c")?.id).toBe("b");
    expect(findThread("wordle thread", threads, "a")?.id).toBe("c");
    expect(findThread("taxes", threads, "c")).toBeNull();
  });

  it("by order, oldest first, or the one used before this one", () => {
    expect(findThread("first", threads, "c")?.id).toBe("a");
    expect(findThread("2", threads, "c")?.id).toBe("b");
    expect(findThread("number three", threads, "a")?.id).toBe("c");
    // "previous": the most recently used other thread.
    expect(findThread("previous", threads, "c")?.id).toBe("a");
    expect(findThread("last", threads, "a")?.id).toBe("c");
  });

  it("not when two other threads match equally; on a tie with the current one, the other", () => {
    const twins = [thread("a", "Desk shopping", 1), thread("b", "Shoe shopping", 2)];
    expect(findThread("shopping", twins, "x")).toBeNull();
    expect(findThread("shoe shopping", twins, "x")?.id).toBe("b");
    expect(findThread("shopping", twins, "a")?.id).toBe("b");
    expect(findThread("shopping", twins, "b")?.id).toBe("a");
  });
});

describe("titles and transcripts", () => {
  it("titles a thread from what was first asked", () => {
    expect(titleFrom("find me a cheap flight to denver next weekend please?")).toBe("Find me a cheap flight to denver next…");
    expect(titleFrom("  what's  the weather ")).toBe("What's the weather");
  });

  it("recaps the latest exchanges", () => {
    const t = { ...thread("a", "Trip planning", 1), exchanges: [1, 2, 3, 4].map((i) => ({ said: `q${i}`, reply: `a${i}`, t: i })) };
    expect(threadTranscript(t, 2)).toBe("Earlier in this thread (“Trip planning”), oldest first:\nUser: q3\nNavi: a3\nUser: q4\nNavi: a4");
    expect(threadTranscript({ ...t, exchanges: [] })).toBe("");
  });
});

describe("the thread book", () => {
  it("starts with one thread, and reuses it while nothing was done in it", async () => {
    const book = new ThreadBook();
    await book.ready;
    const first = book.current;
    expect(book.list()).toHaveLength(1);
    expect(book.create().id).toBe(first);
    expect(book.create("Taxes").title).toBe("Taxes");
    expect(book.list()).toHaveLength(1);
    book.noteTurn(first, "scroll down");
    const second = book.create();
    expect(second.id).not.toBe(first);
    expect(book.current).toBe(second.id);
  });

  it("names a thread from its first AI exchange unless the user named it", async () => {
    const book = new ThreadBook();
    await book.ready;
    const id = book.current;
    book.noteTurn(id, "scroll down");
    expect(book.get(id)?.title).toBe("Scroll down");
    book.noteExchange(id, "plan a trip to denver", "Sure: when?");
    expect(book.get(id)?.title).toBe("Plan a trip to denver");
    book.noteExchange(id, "in may", "Okay.");
    expect(book.get(id)?.title).toBe("Plan a trip to denver");
    book.rename(id, "Denver");
    book.noteExchange(id, "cheaper", "Okay.");
    expect(book.get(id)).toMatchObject({ title: "Denver", named: true });
  });

  it("never reuses, deletes or drops the thread a command is running in", async () => {
    const book = new ThreadBook();
    await book.ready;
    const busy = book.current;
    book.running = busy;
    expect(book.create().id).not.toBe(busy);
    expect(book.remove(busy)).toBe(false);
    book.running = undefined;
    expect(book.remove(busy)).toBe(true);
    // Deleting the current thread moves to the latest other one (or a new one).
    const only = book.current;
    book.noteTurn(only, "hi");
    book.remove(only);
    expect(book.list()).toHaveLength(1);
    expect(book.current).not.toBe(only);
  });

  it("keeps at most 20, dropping the least recently used", async () => {
    vi.useFakeTimers();
    const book = new ThreadBook();
    await book.ready;
    const first = book.current;
    for (let i = 0; i < MAX_THREADS + 3; i++) {
      vi.advanceTimersByTime(1000);
      book.noteTurn(book.current, `task ${i}`);
      book.create();
    }
    expect(book.list()).toHaveLength(MAX_THREADS);
    expect(book.get(first)).toBeUndefined();
  });

  it("is saved, and loads back where it was", async () => {
    vi.useFakeTimers();
    const changes: string[] = [];
    const book = new ThreadBook((state) => changes.push(state.current));
    await book.ready;
    book.noteTurn(book.current, "plan a trip");
    const trip = book.current;
    const taxes = book.create("Taxes");
    vi.advanceTimersByTime(300);
    expect(changes.at(-1)).toBe(taxes.id);
    vi.useRealTimers();
    const again = new ThreadBook();
    await again.ready;
    expect(again.current).toBe(taxes.id);
    expect(again.list().map((t) => t.title)).toEqual(["Taxes", "Plan a trip"]);
    expect(again.switchTo(trip)?.title).toBe("Plan a trip");
    expect(again.state()).toMatchObject({ current: trip, threads: [{ title: "Plan a trip" }, { title: "Taxes" }] });
  });
});
