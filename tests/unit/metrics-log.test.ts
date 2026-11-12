import { beforeEach, describe, expect, it, vi } from "vitest";
import { type CommandMetric, loadMetrics, markLastMisheard, recordMetric } from "../../src/lib/metrics";

// chrome.storage.local, in memory, with a little delay so writes overlap like they do in Chrome.
let store: Record<string, unknown> = {};
const tick = () => new Promise((resolve) => setTimeout(resolve, Math.random() * 5));
vi.stubGlobal("chrome", {
  storage: {
    local: {
      get: async (k: string) => (await tick(), k in store ? { [k]: structuredClone(store[k]) } : {}),
      set: async (items: Record<string, unknown>) => (await tick(), void Object.assign(store, structuredClone(items))),
    },
  },
});

beforeEach(() => {
  store = {};
});

const row = (command: string, heard?: string): CommandMetric => ({ t: "2026-11-12T00:00:00Z", command, path: "fast", ms: 10, heard });

describe("the usage log", () => {
  it("keeps every row when commands are logged at the same moment", async () => {
    await Promise.all(Array.from({ length: 20 }, (_, i) => recordMetric(row(`command ${i}`))));
    expect((await loadMetrics()).map((r) => r.command)).toEqual(Array.from({ length: 20 }, (_, i) => `command ${i}`));
  });

  it("“that's not what I said” marks the last spoken command, even one still being written", async () => {
    await recordMetric(row("scroll down", "scroll down"));
    void recordMetric(row("go back", "go bag"));
    const marked = await markLastMisheard();
    expect(marked?.heard).toBe("go bag");
    const rows = await loadMetrics();
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => !!r.misheard)).toEqual([false, true]);
  });
});
