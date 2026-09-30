import { describe, expect, it } from "vitest";
import { splitFirstClause, splitSentences } from "../../src/tts-lab/audio";
import { kokoroSpeed } from "../../src/lib/voice-output";
import { blindName, formatBytes, formatMs, realTimeFactor, shuffle, topRated } from "../../src/tts-lab/format";

describe("splitSentences", () => {
  it("splits on sentence ends but not after titles, times, prices or web addresses", () => {
    expect(splitSentences("Your meeting with Dr. Patel is on Tuesday. It's at 10:30. Bring $5.50!")).toEqual([
      "Your meeting with Dr. Patel is on Tuesday.",
      "It's at 10:30.",
      "Bring $5.50!",
    ]);
    expect(splitSentences("Opening github.com slash navi.")).toEqual(["Opening github.com slash navi."]);
    expect(splitSentences("  Done.  ")).toEqual(["Done."]);
    expect(splitSentences("")).toEqual([]);
  });
});

describe("formatting", () => {
  it("formats times, sizes and real-time factors", () => {
    expect(formatMs(84.4)).toBe("84 ms");
    expect(formatMs(1450)).toBe("1.4 s");
    expect(formatMs(null)).toBe("—");
    expect(formatBytes(92_361_116)).toBe("92 MB");
    expect(formatBytes(1_200)).toBe("1 KB");
    expect(formatBytes(1_300_000_000)).toBe("1.3 GB");
    expect(realTimeFactor(500, 2)).toBe("0.25×");
    expect(realTimeFactor(null, 2)).toBe("—");
    expect(realTimeFactor(500, 0)).toBe("—");
  });

  it("names blind voices by letter", () => {
    expect([0, 1, 25, 26].map(blindName)).toEqual(["Voice A", "Voice B", "Voice Z", "Voice 27"]);
  });
});

describe("ratings", () => {
  it("lists the best-rated voices first, ignoring cleared ratings", () => {
    const top = topRated({
      "system:Daniel": { rating: 3, label: "Daniel (Chrome)" },
      "kokoro:af_heart": { rating: 5, label: "Heart (Kokoro)" },
      "system:Samantha": { rating: 0, label: "Samantha (Chrome)" },
      "kokoro:af_bella": { rating: 5, label: "Bella (Kokoro)" },
    });
    expect(top.map((t) => t.label)).toEqual(["Bella (Kokoro)", "Heart (Kokoro)", "Daniel (Chrome)"]);
  });

  it("shuffles without losing or repeating voices", () => {
    let seed = 1;
    const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    const shuffled = shuffle(["a", "b", "c", "d", "e"], random);
    expect([...shuffled].sort()).toEqual(["a", "b", "c", "d", "e"]);
    expect(shuffled).not.toEqual(["a", "b", "c", "d", "e"]);
  });
});

describe("splitFirstClause", () => {
  it("starts a long first sentence with its opening clause, so the voice starts sooner", () => {
    const reply =
      "Your inbox has three new emails, one from Sarah about the study session, and one from Mike about Saturday. Want me to open them?";
    expect(splitFirstClause(reply)).toEqual([
      "Your inbox has three new emails,",
      "one from Sarah about the study session, and one from Mike about Saturday. Want me to open them?",
    ]);
    // No punctuation: before a joining word.
    expect(splitFirstClause("I opened the recipe in a new tab and scrolled down to the ingredients for you.")[0]).toBe(
      "I opened the recipe in a new tab",
    );
  });
  it("leaves short first sentences, and ones with no good place to split, whole", () => {
    expect(splitFirstClause("Opened YouTube. It's playing.")).toEqual(["", "Opened YouTube. It's playing."]);
    const noBreak = "Supercalifragilistic expialidocious words keep going on forever without any natural pause here at all.";
    expect(splitFirstClause(noBreak)).toEqual(["", noBreak]);
  });
});

describe("kokoroSpeed", () => {
  it("is a little faster than Kokoro's own pace at Navi's normal speed, and follows the setting", () => {
    expect(kokoroSpeed(1)).toBe(1.15);
    expect(kokoroSpeed(1.3)).toBe(1.5);
    expect(kokoroSpeed(3)).toBe(2);
    expect(kokoroSpeed(0)).toBe(1.15);
  });
});
