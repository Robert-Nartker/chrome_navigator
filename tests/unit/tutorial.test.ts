import { describe, expect, it } from "vitest";
import { parseCommand } from "../../src/lib/parser";
import { Tutorial, parseTutorialControl, tutorialSteps } from "../../src/lib/tutorial";

const base = { name: "Navi", openMic: false, ai: true, screenFree: false };
const ids = (c: Partial<typeof base> = {}) => tutorialSteps({ ...base, ...c }).map((s) => s.id);

describe("the tutorial", () => {
  it("teaches what fits: numbers for people who see the screen, describing it for those who don't, the AI only when there is one", () => {
    expect(ids()).toEqual(["intro", "wake", "scroll", "click", "search", "back", "stop", "ask", "finish"]);
    expect(ids({ screenFree: true })).toEqual(["intro", "wake", "scroll", "describe", "search", "back", "stop", "ask", "finish"]);
    expect(ids({ ai: false })).not.toContain("ask");
  });

  it("practices waking Navi by its name (and goes to sleep for it), except in open mic mode", () => {
    const [, wake] = tutorialSteps(base);
    expect(wake).toMatchObject({ sleepAfter: true });
    expect(wake.say).toContain("Try: Hey Navi, open Wikipedia.");
    expect(wake.praise).toContain("“Hey Navigator” works too.");
    const custom = tutorialSteps({ ...base, name: "Jarvis" })[1];
    expect(custom.say).toContain("Hey Jarvis");
    expect(custom.praise).not.toContain("Navigator");
    const open = tutorialSteps({ ...base, openMic: true })[1];
    expect(open.sleepAfter).toBeUndefined();
    expect(open.say).toContain("just say the command");
  });

  it("moves on only when the step's command worked", () => {
    const steps = tutorialSteps(base);
    const step = (id: string) => steps.find((s) => s.id === id)!;
    expect(step("wake").done!({ command: "open wikipedia", intent: "open" })).toBe(true);
    expect(step("wake").done!({ command: "scroll down", intent: "scroll" })).toBe(false);
    expect(step("click").done!({ command: "show numbers", intent: "showNumbers" })).toBe(false);
    expect(step("click").done!({ command: "click 4", intent: "clickNumber" })).toBe(true);
    expect(step("ask").done!({ command: "what is this", intent: "ai", path: "ai" })).toBe(true);
    // A failed command has no intent, so it doesn't count.
    expect(step("search").done!({ command: "search for octopus" })).toBe(false);
    expect(step("intro").done).toBeUndefined();
  });

  it("understands next, repeat, end, and yes or no only for its question", () => {
    const c = (t: string, q = false) => parseTutorialControl(t, q);
    expect(["next", "Next.", "skip", "skip this step", "okay next", "continue", "go on"].map((t) => c(t))).toEqual(Array(7).fill("next"));
    expect(["repeat", "repeat that", "say that again", "what did you say"].map((t) => c(t))).toEqual(Array(4).fill("repeat"));
    expect(["end tutorial", "stop the tutorial", "exit tutorial", "skip the tutorial", "end the tour"].map((t) => c(t))).toEqual(Array(5).fill("end"));
    expect(c("yes please", true)).toBe("yes");
    expect(c("yeah", true)).toBe("yes");
    expect(c("no thanks", true)).toBe("no");
    expect(c("yes")).toBeNull();
    // Ordinary commands stay commands: "stop" interrupts, "next tab" switches tabs.
    expect(["stop", "next tab", "next page", "go back", "scroll down"].map((t) => c(t, true))).toEqual(Array(5).fill(null));
  });

  it("tailors the rest of the tour to the answer, and ends after the last step", () => {
    const t = new Tutorial();
    expect(t.start(base).id).toBe("intro");
    expect(t.view()).toMatchObject({ step: 1, total: 9, title: "Welcome", question: true });
    t.answer(true);
    expect(t.step?.id).toBe("intro");
    expect(t.advance()?.id).toBe("wake");
    expect(t.advance()?.id).toBe("scroll");
    expect(t.advance()?.id).toBe("describe");
    expect(t.view()).toMatchObject({ step: 4, total: 9, question: false });
    while (t.advance());
    expect(t.active).toBe(false);
    expect(t.view()).toBeUndefined();
  });
});

describe("new built-in commands", () => {
  it("describe the screen, for people who can't see it", () => {
    for (const t of ["describe the screen", "describe this page", "what's on the screen", "what is on my screen", "what do you see", "what am I looking at", "tell me what's on the screen"]) {
      expect(parseCommand(t), t).toEqual({ type: "describeScreen" });
    }
    // "What's this page" still says which page it is, and "what's on this page" (often "what's this article about") goes to the AI.
    expect(parseCommand("what's this page")).toEqual({ type: "whereAmI" });
    expect(parseCommand("what's on this page")).toBeNull();
  });

  it("open settings, and the tutorial", () => {
    for (const t of ["open settings", "open navi settings", "show the settings", "go to settings"]) expect(parseCommand(t), t).toEqual({ type: "openSettings" });
    for (const t of ["start the tutorial", "tutorial", "start tutorial", "take the tour", "teach me", "how do I use you", "start the tutorial again"]) {
      expect(parseCommand(t), t).toEqual({ type: "tutorial" });
    }
  });

  it("stop one helper by number", () => {
    expect(parseCommand("stop helper 2")).toEqual({ type: "stopHelpers", everything: false, id: 2 });
    expect(parseCommand("stop helper number three")).toEqual({ type: "stopHelpers", everything: false, id: 3 });
    expect(parseCommand("stop helpers")).toEqual({ type: "stopHelpers", everything: false });
  });
});
