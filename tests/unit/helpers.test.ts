import { describe, expect, it } from "vitest";
import { HELPER_RULES, type HelperInfo, StuckCheck, describeHelper, formatDuration, helperSettings } from "../../src/lib/helpers";
import { DEFAULT_SETTINGS, normalizeSettings } from "../../src/lib/settings";

describe("the helper supervisor", () => {
  it("counts how many times in a row the same actions left the same page", () => {
    const check = new StuckCheck();
    const scroll = [{ name: "scroll", input: { direction: "up" } }];
    expect([1, 2, 3].map(() => check.note(scroll, "page A"))).toEqual([1, 2, 3]);
    // Something different starts the count over.
    expect(check.note([{ name: "click", input: { element_id: 4 } }], "page A")).toBe(1);
    expect(HELPER_RULES).toMatchObject({ nudgeAfter: 3, stopAfter: 8, running: 5 });
  });

  it("doesn't count it when the page changes or the action does", () => {
    const check = new StuckCheck();
    const down = [{ name: "scroll", input: { direction: "down" } }];
    // Scrolling down a long page: same action, a different page each time.
    for (const page of ["at 0%", "at 20%", "at 40%", "at 60%"]) expect(check.note(down, page)).toBe(1);
    const click = (id: number) => [{ name: "click", input: { element_id: id } }];
    expect([click(1), click(2), click(1)].map((c) => check.note(c, "p"))).toEqual([1, 1, 1]);
  });

  it("runs helpers on the helper model and reasoning, with Navi's asking rules and no step limit", () => {
    const s = helperSettings({ ...DEFAULT_SETTINGS, model: "claude-opus-5-5", effort: "xhigh", autonomy: "yolo", maxAgentSteps: 30, fastMode: true, memory: true });
    expect(s).toMatchObject({ model: "gpt-6.1-sol", effort: "low", autonomy: "default", maxAgentSteps: Infinity, fastMode: false, memory: false });
  });

  it("has one time limit, 15 minutes unless the user changes it", () => {
    expect(normalizeSettings({}).helperMinutes).toBe(15);
    expect(normalizeSettings({ helperMinutes: 45 }).helperMinutes).toBe(45);
    expect(normalizeSettings({ helperMinutes: 0 }).helperMinutes).toBe(15);
    expect(normalizeSettings({ helperMinutes: 500 }).helperMinutes).toBe(120);
  });

  it("describes how each one is doing, in words that read well aloud", () => {
    const h: HelperInfo = {
      id: 2, task: "Find the cheapest desk", thread: "t", keepOpen: false, model: "gpt-6.1-sol", status: "running", step: 4,
      costUsd: 0.01, started: 0, activity: "Reading the page", collected: false,
    };
    expect(describeHelper(h, 185_000)).toBe("Helper 2 (“Find the cheapest desk”): working for 3 minutes, step 4, now: Reading the page");
    expect(describeHelper({ ...h, step: 0, activity: "Thinking…" }, 5000)).toBe("Helper 2 (“Find the cheapest desk”): working for 5 seconds, now: Thinking…");
    expect(describeHelper({ ...h, status: "done", result: "The Flexispot E7 at $399." })).toBe("Helper 2 (“Find the cheapest desk”) finished: The Flexispot E7 at $399.");
    expect(describeHelper({ ...h, status: "stopped", why: "you stopped it", lastAction: "Reading the page" })).toBe(
      "Helper 2 (“Find the cheapest desk”) was stopped: you stopped it. Its last action: Reading the page.",
    );
    expect(describeHelper({ ...h, status: "stopped", why: "it reached its time limit (15 minutes)" })).toBe(
      "Helper 2 (“Find the cheapest desk”) was stopped: it reached its time limit (15 minutes).",
    );
    expect(describeHelper({ ...h, task: "x".repeat(100), status: "failed", why: "the site is down" })).toMatch(/^Helper 2 \(“x{80}…”\) failed: the site is down\.$/);
    expect([1000, 45_000, 60_000, 130_000].map(formatDuration)).toEqual(["1 second", "45 seconds", "1 minute", "2 minutes"]);
  });
});
