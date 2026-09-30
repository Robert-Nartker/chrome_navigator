import { describe, expect, it } from "vitest";
import { FRAME, PhraseDetector, RATE } from "../../src/voice/phrases";
import { parakeetModelFor } from "../../src/voice/parakeet-langs";

/** Frames whose first sample says whether they're speech (1) or not (0), for a fake speech detector. */
function frames(pattern: string): Float32Array {
  const out = new Float32Array(pattern.length * FRAME);
  [...pattern].forEach((c, i) => out.fill(c === "#" ? 1 : 0, i * FRAME, (i + 1) * FRAME));
  return out;
}

async function run(pattern: string, chunk = 1600) {
  const phrases: Float32Array[] = [];
  let starts = 0;
  const d = new PhraseDetector((f) => f[0], (pcm) => phrases.push(pcm), {}, () => starts++);
  const audio = frames(pattern);
  // In the mic's chunk size, which doesn't line up with frames.
  for (let at = 0; at < audio.length; at += chunk) d.push(audio.slice(at, at + chunk));
  await d.flush();
  return { phrases, starts };
}

describe("PhraseDetector", () => {
  // Each character is one 32 ms frame: "#" speech, "." silence. 11 quiet frames (352 ms) end a phrase.
  const quiet = ".".repeat(11);

  it("cuts a phrase about a third of a second after the talking stops, keeping its first sound", async () => {
    const { phrases, starts } = await run(`${quiet}${"#".repeat(30)}${quiet}${quiet}`);
    expect(starts).toBe(1);
    expect(phrases).toHaveLength(1);
    const pcm = phrases[0];
    // A quarter second of lead-in (8 frames), the speech, and the quiet that ended it.
    expect(pcm.length).toBe((8 + 30 + 11) * FRAME);
    expect(pcm[7 * FRAME]).toBe(0);
    expect(pcm[8 * FRAME]).toBe(1);
  });

  it("keeps short pauses inside one phrase, and splits at longer ones", async () => {
    const { phrases } = await run(`${"#".repeat(20)}.....${"#".repeat(20)}${quiet}${"#".repeat(20)}${quiet}`);
    expect(phrases).toHaveLength(2);
  });

  it("ignores blips like a cough or a click", async () => {
    const { phrases, starts } = await run(`${quiet}###${quiet}${quiet}`);
    expect(starts).toBe(1);
    expect(phrases).toHaveLength(0);
  });

  it("ends a phrase when the mic stops mid-sentence, and cuts very long ones", async () => {
    expect((await run(`${"#".repeat(20)}`)).phrases).toHaveLength(1);
    const long = await run("#".repeat(Math.ceil((RATE * 21) / FRAME)));
    expect(long.phrases.length).toBe(2);
    expect(long.phrases[0].length).toBeLessThanOrEqual(RATE * 20 + FRAME);
  });
});

describe("parakeetModelFor", () => {
  it("uses the English model for English, the multilingual one for European languages, and none otherwise", () => {
    expect(parakeetModelFor("en-US")).toBe("parakeet-tdt-0.6b-v2");
    expect(parakeetModelFor("en-GB")).toBe("parakeet-tdt-0.6b-v2");
    expect(parakeetModelFor("es-MX")).toBe("parakeet-tdt-0.6b-v3");
    expect(parakeetModelFor("uk")).toBe("parakeet-tdt-0.6b-v3");
    expect(parakeetModelFor("ja-JP")).toBeUndefined();
  });
});
