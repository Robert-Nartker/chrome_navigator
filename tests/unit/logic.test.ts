import { describe, expect, it } from "vitest";
import { bestMatch, scoreLabel } from "../../src/lib/match";
import { parseNumber } from "../../src/lib/numbers";
import type { ElementInfo } from "../../src/lib/protocol";
import { WakeSession } from "../../src/lib/session";
import { resolveSite, searchUrl, siteEngine } from "../../src/lib/sites";

const el = (id: number, name: string, inViewport = true): ElementInfo => ({
  id,
  name,
  role: "button",
  tag: "button",
  inViewport,
});

describe("parseNumber", () => {
  it("parses digits, words, compounds and homophones", () => {
    expect(parseNumber("12")).toBe(12);
    expect(parseNumber("twelve")).toBe(12);
    expect(parseNumber("forty-two")).toBe(42);
    expect(parseNumber("twenty one")).toBe(21);
    expect(parseNumber("for")).toBe(4);
    expect(parseNumber("banana")).toBeNull();
  });
});

describe("label matching", () => {
  it("scores exact over partial", () => {
    expect(scoreLabel("sign in", "Sign in")).toBe(1);
    expect(scoreLabel("sign in", "Sign in with Google")).toBeGreaterThanOrEqual(0.8);
    expect(scoreLabel("sign in", "Help")).toBe(0);
  });
  it("clicks only a clear winner", () => {
    expect(bestMatch("sign in", [el(1, "Home"), el(2, "Sign in"), el(3, "Help")])?.element.id).toBe(2);
    expect(bestMatch("subscribe", [el(1, "Subscribe"), el(2, "Subscribe to newsletter")])?.element.id).toBe(1);
    // Two equally good candidates: ambiguous, so defer to the AI.
    expect(bestMatch("reply", [el(1, "Reply to Sam"), el(2, "Reply to Alex")])).toBeNull();
    expect(bestMatch("checkout", [el(1, "Home"), el(2, "Cart")])).toBeNull();
  });
  it("prefers on-screen elements", () => {
    expect(bestMatch("next", [el(1, "Next", false), el(2, "Next")])?.element.id).toBe(2);
  });
});

describe("sites", () => {
  it("resolves names, spoken domains, and rejects non-sites", () => {
    expect(resolveSite("YouTube")).toBe("https://www.youtube.com");
    expect(resolveSite("the youtube website")).toBe("https://www.youtube.com");
    expect(resolveSite("youtube dot com")).toBe("https://www.youtube.com");
    expect(resolveSite("news dot ycombinator dot com")).toBe("https://news.ycombinator.com");
    expect(resolveSite("localhost:3000")).toBe("http://localhost:3000");
    expect(resolveSite("192.168.1.1")).toBe("http://192.168.1.1");
    expect(resolveSite("the first video")).toBeNull();
    expect(resolveSite("my latest email from sarah")).toBeNull();
  });
  it("builds search URLs", () => {
    expect(searchUrl("a&b", "youtube")).toBe("https://www.youtube.com/results?search_query=a%26b");
  });
  it("knows which sites have their own search", () => {
    expect(siteEngine("https://www.youtube.com/watch?v=abc")).toBe("youtube");
    expect(siteEngine("https://m.youtube.com/")).toBe("youtube");
    expect(siteEngine("https://en.wikipedia.org/wiki/Navi")).toBe("wikipedia");
    expect(siteEngine("https://www.google.com/search?q=x")).toBeUndefined();
    expect(siteEngine("https://notyoutube.com/")).toBeUndefined();
    expect(siteEngine("chrome://newtab/")).toBeUndefined();
    expect(siteEngine(undefined)).toBeUndefined();
  });
});

describe("WakeSession", () => {
  function make(mode: "handsfree" | "open" = "handsfree") {
    let t = 0;
    const session = new WakeSession({ mode, wakeName: "Navi", timeoutSec: 60 }, () => t);
    return { session, advance: (ms: number) => (t += ms) };
  }

  it("ignores speech until woken", () => {
    const { session } = make();
    expect(session.handle("scroll down")).toEqual({ command: null, woke: false });
    expect(session.current).toBe("sleeping");
  });

  it("wakes once and then takes commands without the name", () => {
    const { session, advance } = make();
    expect(session.handle("hey navi open youtube")).toEqual({ command: "open youtube", woke: true });
    advance(30_000);
    expect(session.handle("scroll down")).toMatchObject({ command: "scroll down", woke: false });
    advance(59_000);
    // Each command resets the idle timer.
    expect(session.handle("click 3")).toMatchObject({ command: "click 3", woke: false });
  });

  it("falls asleep after the timeout", () => {
    const { session, advance } = make();
    session.handle("hey navi");
    advance(61_000);
    expect(session.current).toBe("sleeping");
    expect(session.handle("scroll down").command).toBeNull();
  });

  it("goes to sleep on request", () => {
    const { session } = make();
    session.handle("hey navi");
    session.sleep();
    expect(session.handle("go back").command).toBeNull();
  });

  it("treats everything as a command in open mic mode, and notices the name", () => {
    const { session } = make("open");
    expect(session.handle("go back")).toEqual({ command: "go back", woke: false, named: false });
    expect(session.handle("navi go back")).toEqual({ command: "go back", woke: false, named: true });
    // "Hey Navi" alone: nothing to run, but Navi says it heard (a sound).
    expect(session.handle("hey navi")).toEqual({ command: null, woke: false, named: true });
    expect(session.handle("wake up")).toEqual({ command: null, woke: false, named: true });
  });

  it("wakes on “wake up” or “wake”, with or without the name, and runs what follows", () => {
    for (const said of ["wake up", "wake", "Wake up.", "hey wake up", "wake up navi", "okay wake up navigator", "wakey wakey"]) {
      const { session } = make();
      expect(session.handle(said), said).toEqual({ command: null, woke: true });
    }
    const { session } = make();
    expect(session.handle("wake up, open youtube")).toEqual({ command: "open youtube", woke: true });
    // Awake, "wake" can start an ordinary command; only "wake up" on its own is a greeting.
    expect(session.handle("wake me up at seven")).toMatchObject({ command: "wake me up at seven" });
    expect(session.handle("wake up")).toMatchObject({ command: null, named: true });
  });

  it("wakes as soon as the name is heard, before the recognizer finishes the phrase", () => {
    const { session, advance } = make();
    expect(session.hearsWakePhrase("hey navi")).toBe(true);
    expect(session.hearsWakePhrase("wake up")).toBe(true);
    expect(session.hearsWakePhrase("scroll down")).toBe(false);
    expect(session.wakeMidPhrase()).toBe(true);
    expect(session.current).toBe("awake");
    expect(session.wakeMidPhrase()).toBe(false);
    // The finished phrase is the one that woke it: the name (and words before it) come off, with no second sound.
    advance(1500);
    expect(session.handle("um hey navi scroll down")).toEqual({ command: "scroll down", woke: false, named: false });
    // Later phrases only lose a leading name.
    expect(session.handle("open the navy page")).toMatchObject({ command: "open the navy page" });
  });

  it("still takes the command when the recognizer drops the phrase that woke it", () => {
    const { session, advance } = make();
    session.wakeMidPhrase();
    advance(20_000);
    expect(session.handle("close tab")).toMatchObject({ command: "close tab", woke: false });
  });
});

describe("metrics", async () => {
  const { summarize, toCsv } = await import("../../src/lib/metrics");
  const rows = [
    { t: "2026-09-24T00:00:00Z", command: "scroll down", path: "fast" as const, intent: "scroll", ms: 40 },
    { t: "2026-09-24T00:00:01Z", command: 'open "the" video, please', path: "ai" as const, ms: 2400, steps: 2 },
  ];
  it("summarizes fast vs AI", () => {
    expect(summarize(rows)).toMatchObject({ total: 2, fast: 1, ai: 1, fastMedianMs: 40, aiMedianMs: 2400, aiMedianSteps: 2 });
  });
  it("counts background work's cost, but not as a command", () => {
    const memory = { t: "2026-09-24T00:01:00Z", command: "(memory update)", path: "background" as const, ms: 900, costUsd: 0.0004 };
    const paid = [...rows.slice(0, 1), { ...rows[1], costUsd: 0.02 }, memory];
    expect(summarize(paid)).toMatchObject({ total: 2, ai: 1, aiMedianMs: 2400 });
    expect(summarize(paid).costUsd).toBeCloseTo(0.0204);
  });
  it("escapes CSV cells", () => {
    expect(toCsv(rows).split("\n")[2]).toContain('"open ""the"" video, please"');
  });
});
