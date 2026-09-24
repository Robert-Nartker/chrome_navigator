import { describe, expect, it } from "vitest";
import { bestMatch, scoreLabel } from "../../src/lib/match";
import { parseNumber } from "../../src/lib/numbers";
import type { ElementInfo } from "../../src/lib/protocol";
import { WakeSession } from "../../src/lib/session";
import { resolveSite, searchUrl } from "../../src/lib/sites";

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
    expect(resolveSite("the first video")).toBeNull();
    expect(resolveSite("my latest email from sarah")).toBeNull();
  });
  it("builds search URLs", () => {
    expect(searchUrl("a&b", "youtube")).toBe("https://www.youtube.com/results?search_query=a%26b");
  });
});

describe("WakeSession", () => {
  function make(mode: "handsfree" | "push" = "handsfree") {
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
    expect(session.handle("scroll down")).toEqual({ command: "scroll down", woke: false });
    advance(59_000);
    // Each command resets the idle timer.
    expect(session.handle("click 3")).toEqual({ command: "click 3", woke: false });
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

  it("treats everything as a command in click-to-talk mode", () => {
    const { session } = make("push");
    expect(session.handle("go back")).toEqual({ command: "go back", woke: false });
    expect(session.handle("navi go back")).toEqual({ command: "go back", woke: false });
  });
});
