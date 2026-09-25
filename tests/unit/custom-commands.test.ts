import { describe, expect, it } from "vitest";
import { type CustomCommand, fillStep, matchCommand, validateCommand } from "../../src/lib/custom-commands";

const cmd = (phrases: string[], steps: CustomCommand["steps"]): CustomCommand => ({
  id: phrases[0],
  phrases,
  steps,
  description: "",
  updatedAt: "",
});

const wordle = cmd(["open wordle", "play wordle"], [
  { type: "open", url: "https://www.nytimes.com/games/wordle/index.html", newTab: false },
]);
const spotify = cmd(["play {song} on spotify"], [{ type: "run", command: "search spotify for {song}" }]);
const studyMode = cmd(["study mode"], [
  { type: "open", url: "https://osu.instructure.com", newTab: true },
  { type: "run", command: "search youtube for lofi beats" },
]);

describe("matching personal commands", () => {
  it("matches any phrase, ignoring filler and punctuation", () => {
    expect(matchCommand("Play Wordle.", [wordle])?.command.id).toBe("open wordle");
    expect(matchCommand("okay, open wordle please", [wordle])?.command.id).toBe("open wordle");
    expect(matchCommand("open youtube", [wordle])).toBeNull();
  });

  it("captures {placeholders} and fills them into steps", () => {
    const m = matchCommand("play Bohemian Rhapsody on Spotify", [spotify]);
    expect(m?.params).toEqual({ song: "bohemian rhapsody" });
    expect(fillStep(spotify.steps[0], m!.params)).toEqual({ type: "run", command: "search spotify for bohemian rhapsody" });
    expect(fillStep({ type: "open", url: "https://x.com/search?q={q}", newTab: false }, { q: "a b&c" })).toEqual({
      type: "open",
      url: "https://x.com/search?q=a%20b%26c",
      newTab: false,
    });
  });

  it("prefers exact phrases over placeholder phrases", () => {
    const exact = cmd(["play lofi on spotify"], [{ type: "run", command: "exact" }]);
    expect(matchCommand("play lofi on spotify", [spotify, exact])?.command.id).toBe("play lofi on spotify");
  });
});

describe("validating personal commands", () => {
  it("cleans phrases and accepts multi-step commands", () => {
    const clean = validateCommand(
      { phrases: ["Study Mode!", "study mode"], steps: studyMode.steps, description: " Focus time " },
      [],
    );
    expect(clean.phrases).toEqual(["study mode"]);
    expect(clean.steps).toHaveLength(2);
    expect(clean.description).toBe("Focus time");
  });

  it("protects core and built-in commands", () => {
    const steps = wordle.steps;
    expect(() => validateCommand({ phrases: ["stop"], steps }, [])).toThrow(/core command/);
    expect(() => validateCommand({ phrases: ["go to sleep"], steps }, [])).toThrow(/core command/);
    expect(() => validateCommand({ phrases: ["scroll down"], steps }, [])).toThrow(/built-in/);
    expect(() => validateCommand({ phrases: ["list my commands"], steps }, [])).toThrow(/reserved/);
    // Generic built-ins like "open X" can be personalized.
    expect(() => validateCommand({ phrases: ["open youtube"], steps }, [])).not.toThrow();
  });

  it("rejects non-web URLs, empty steps, and phrases owned by another command", () => {
    expect(() => validateCommand({ phrases: ["x"], steps: [{ type: "open", url: "javascript:alert(1)", newTab: false }] }, [])).toThrow(/web address/);
    expect(() => validateCommand({ phrases: ["x"], steps: [] }, [])).toThrow(/at least one step/);
    expect(() => validateCommand({ phrases: ["play wordle"], steps: wordle.steps }, [wordle])).toThrow(/already used/);
    // Updating the same command is fine.
    expect(() => validateCommand({ phrases: ["play wordle"], steps: wordle.steps }, [wordle], wordle.id)).not.toThrow();
  });
});
