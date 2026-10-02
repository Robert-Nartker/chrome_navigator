import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadStoredSettings, normalizeSettings, saveSettings } from "../../src/lib/settings";

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

beforeEach(() => {
  store = {};
});

describe("saving each mode's own settings", () => {
  it("goes to the mode running now", async () => {
    await saveSettings({ openaiKey: "sk", aiMode: "pro" });
    await saveSettings({ effort: "medium" });
    const stored = await loadStoredSettings();
    expect(stored.modes?.pro).toEqual({ effort: "medium" });
    expect(normalizeSettings(stored, "free").effort).not.toBe("medium");
  });

  it("goes to the mode chosen with them, even before Pro has a key", async () => {
    // Settings shows Pro's values when Pro is chosen; saving keeps them for Pro, though Navi runs Free until a key is added.
    await saveSettings({ aiMode: "pro", subagentModel: "claude-sonnet-5-5", subagentEffort: "medium" });
    const stored = await loadStoredSettings();
    expect(stored.modes?.pro).toEqual({ subagentModel: "claude-sonnet-5-5", subagentEffort: "medium" });
    expect(stored.modes?.free).toBeUndefined();
    expect(normalizeSettings(stored, "free").subagentModel).toBe("gpt-6.1-sol");
    expect(normalizeSettings({ ...stored, openaiKey: "sk" })).toMatchObject({ subagentModel: "claude-sonnet-5-5", subagentEffort: "medium" });
  });
});
