import { describe, expect, it } from "vitest";
import { addUsage, costOf, effortFor, formatCost, modelInfo } from "../../src/lib/models";
import { parseDecision } from "../../src/lib/router";
import { DEFAULT_SETTINGS, keyFor } from "../../src/lib/settings";

describe("model catalog", () => {
  it("prices cached, cache-write, and output tokens separately", () => {
    // Opus 5.5: $4 in, $0.40 cached, $5 cache write, $20 out per million.
    const usage = { input: 1000, cachedInput: 10_000, cacheWrite: 2000, output: 500 };
    expect(costOf("claude-opus-5-5", usage)).toBeCloseTo((1000 * 4 + 10_000 * 0.4 + 2000 * 5 + 500 * 20) / 1e6, 12);
  });

  it("returns NaN cost for models without a known price", () => {
    expect(costOf("some-new-model", { input: 1, cachedInput: 0, cacheWrite: 0, output: 1 })).toBeNaN();
    expect(formatCost(Number.NaN)).toBe("$?");
    expect(modelInfo("gpt-7-mini").provider).toBe("openai");
    expect(modelInfo("claude-future").provider).toBe("anthropic");
  });

  it("clamps reasoning effort to what each model supports", () => {
    expect(effortFor("claude-opus-5-5", "none")).toBe("low");
    expect(effortFor("gpt-6-astra", "none")).toBe("low");
    expect(effortFor("gpt-6-luna", "none")).toBe("none");
    expect(effortFor("gpt-6-sol", "medium")).toBe("medium");
    expect(effortFor("claude-haiku-4-5", "high")).toBe("none");
  });

  it("adds usage and formats small costs readably", () => {
    const a = { input: 1, cachedInput: 2, cacheWrite: 3, output: 4 };
    expect(addUsage(a, a)).toEqual({ input: 2, cachedInput: 4, cacheWrite: 6, output: 8 });
    expect(formatCost(0.00021)).toBe("$0.0002");
    expect(formatCost(0.0345)).toBe("$0.035");
    expect(formatCost(3.456)).toBe("$3.46");
  });

  it("uses the right provider's key", () => {
    const s = { ...DEFAULT_SETTINGS, apiKey: "ant", openaiKey: "oai" };
    expect(keyFor(s, "claude-opus-5-5")).toBe("ant");
    expect(keyFor(s, "gpt-6-luna")).toBe("oai");
  });
});

describe("router decisions", () => {
  it("parses commands, ignores, and falls back to the agent", () => {
    expect(parseDecision('{"route":"command","command":" scroll down "}')).toEqual({ route: "command", command: "scroll down" });
    expect(parseDecision('{"route":"ignore","command":""}')).toEqual({ route: "ignore" });
    expect(parseDecision('{"route":"command","command":""}')).toEqual({ route: "agent" });
    expect(parseDecision("not json")).toEqual({ route: "agent" });
  });
});
