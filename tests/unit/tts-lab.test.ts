import { describe, expect, it } from "vitest";
import { splitSentences } from "../../src/tts-lab/audio";
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
