import { beforeEach, describe, expect, it, vi } from "vitest";
import { type HelperInfo, cleanUpLeftHelpers, saveRunning } from "../../src/lib/helpers";

// chrome.storage.session and chrome.windows, in memory.
let session: Record<string, unknown> = {};
const removed: number[] = [];
vi.stubGlobal("chrome", {
  storage: {
    session: {
      get: async (k: string) => (k in session ? { [k]: structuredClone(session[k]) } : {}),
      set: async (items: Record<string, unknown>) => void Object.assign(session, structuredClone(items)),
      remove: async (k: string) => void delete session[k],
    },
  },
  windows: { remove: async (id: number) => void removed.push(id) },
});

beforeEach(() => {
  session = {};
  removed.length = 0;
});

const helper = (id: number, window?: number): HelperInfo => ({
  id, task: `Task ${id}`, thread: "t1", window, keepOpen: false, model: "m", status: "running", step: 1, costUsd: 0,
  started: 0, activity: "", collected: false, inbox: [],
});

describe("helpers when Chrome restarts Navi", () => {
  it("closes the windows of helpers that were running, once, and says which they were", async () => {
    await saveRunning([helper(1, 101), helper(2)]);
    const left = await cleanUpLeftHelpers();
    expect(left.map((h) => h.id)).toEqual([1, 2]);
    expect(removed).toEqual([101]);
    // Only once: a second start finds nothing.
    expect(await cleanUpLeftHelpers()).toEqual([]);
  });
  it("leaves nothing to clean up once no helper is running", async () => {
    await saveRunning([helper(1, 101)]);
    await saveRunning([]);
    expect(await cleanUpLeftHelpers()).toEqual([]);
    expect(removed).toEqual([]);
  });
});
