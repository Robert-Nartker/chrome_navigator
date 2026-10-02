import { describe, expect, it } from "vitest";
import { HELPER_LIMITS, type HelperInfo, StuckCheck, describeHelper, helperSettings } from "../../src/lib/helpers";
import { DEFAULT_SETTINGS } from "../../src/lib/settings";

describe("the helper supervisor", () => {
  it("calls it stuck after the same actions leave the same page three times in a row", () => {
    const check = new StuckCheck();
    const scroll = [{ name: "scroll", input: { direction: "up" } }];
    expect(check.note(scroll, "page A")).toBe(false);
    expect(check.note(scroll, "page A")).toBe(false);
    expect(check.note(scroll, "page A")).toBe(true);
  });

  it("doesn't when the page changes or the action does", () => {
    const check = new StuckCheck();
    const down = [{ name: "scroll", input: { direction: "down" } }];
    // Scrolling down a long page: same action, a different page each time.
    for (const page of ["at 0%", "at 20%", "at 40%", "at 60%"]) expect(check.note(down, page)).toBe(false);
    const click = (id: number) => [{ name: "click", input: { element_id: id } }];
    expect(check.note(click(1), "p")).toBe(false);
    expect(check.note(click(2), "p")).toBe(false);
    expect(check.note(click(1), "p")).toBe(false);
  });

  it("runs helpers on the helper model and reasoning, with Navi's asking rules and its own limits", () => {
    const s = helperSettings({ ...DEFAULT_SETTINGS, model: "claude-opus-5-5", effort: "xhigh", autonomy: "yolo", maxAgentSteps: 30, fastMode: true, memory: true });
    expect(s).toMatchObject({ model: "gpt-6.1-sol", effort: "low", autonomy: "default", maxAgentSteps: HELPER_LIMITS.steps, fastMode: false, memory: false });
    expect(HELPER_LIMITS).toMatchObject({ steps: 15, minutes: 5, usd: 0.5, running: 3 });
  });

  it("describes how each one is doing", () => {
    const h: HelperInfo = {
      id: 2, task: "Find the cheapest desk", thread: "t", keepOpen: false, model: "gpt-6.1-sol", status: "running", step: 4,
      costUsd: 0.01, started: 0, activity: "", collected: false,
    };
    expect(describeHelper(h)).toBe("Helper 2 (“Find the cheapest desk”): still working, step 4.");
    expect(describeHelper({ ...h, status: "done", result: "The Flexispot E7 at $399." })).toBe("Helper 2 (“Find the cheapest desk”) finished: The Flexispot E7 at $399.");
    expect(describeHelper({ ...h, status: "stopped", why: "you stopped it" })).toBe("Helper 2 (“Find the cheapest desk”) was stopped: you stopped it.");
    expect(describeHelper({ ...h, task: "x".repeat(100), status: "failed", why: "the site is down" })).toMatch(/^Helper 2 \(“x{80}…”\) failed: the site is down\.$/);
  });
});
