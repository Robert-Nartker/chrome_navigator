import { describe, expect, it } from "vitest";
import { floatToPcm16Base64, pcm16ToFloat, scribeUrl } from "../../src/lib/elevenlabs";
import { DEFAULT_SETTINGS, usesElevenInput, usesElevenOutput } from "../../src/lib/settings";

describe("scribeUrl", () => {
  const url = (overrides: Partial<Parameters<typeof scribeUrl>[0]> = {}) =>
    new URL(
      scribeUrl({
        token: "tok",
        languageCode: "en-US",
        keyterms: ["Navi", "Hey Navi"],
        filterBackgroundAudio: true,
        silenceSecs: 0.6,
        ...overrides,
      }),
    );

  it("asks for realtime Scribe with background filtering", () => {
    const u = url();
    expect(u.origin + u.pathname).toBe("wss://api.elevenlabs.io/v1/speech-to-text/realtime");
    const p = u.searchParams;
    expect(p.get("model_id")).toBe("scribe_v2_realtime");
    expect(p.get("token")).toBe("tok");
    expect(p.get("audio_format")).toBe("pcm_16000");
    expect(p.get("commit_strategy")).toBe("vad");
    expect(p.get("language_code")).toBe("en");
    // Zero retention is Enterprise-only; sending it on other plans isn't allowed.
    expect(p.has("enable_logging")).toBe(false);
    expect(p.get("filter_background_audio")).toBe("true");
    expect(p.getAll("keyterms")).toEqual(["Navi", "Hey Navi"]);
  });

  it("keeps keyterms within ElevenLabs' limits and clamps the silence window", () => {
    const many = Array.from({ length: 80 }, (_, i) => `site${i}`);
    const u = url({ keyterms: [...many, "a name far longer than twenty characters"], silenceSecs: 10 });
    expect(u.searchParams.getAll("keyterms")).toHaveLength(50);
    expect(u.searchParams.getAll("keyterms").every((t) => t.length <= 20)).toBe(true);
    expect(u.searchParams.get("vad_silence_threshold_secs")).toBe("3");
    expect(url({ filterBackgroundAudio: false }).searchParams.get("filter_background_audio")).toBe("false");
  });
});

describe("PCM conversion", () => {
  it("round-trips samples through 16-bit PCM", () => {
    const samples = new Float32Array([0, 0.5, -0.5, 1, -1, 2]);
    const bytes = Uint8Array.from(atob(floatToPcm16Base64(samples)), (c) => c.charCodeAt(0));
    expect(bytes).toHaveLength(samples.length * 2);
    const back = pcm16ToFloat(bytes);
    expect(back[0]).toBe(0);
    expect(back[1]).toBeCloseTo(0.5, 3);
    expect(back[2]).toBeCloseTo(-0.5, 3);
    expect(back[3]).toBeCloseTo(1, 3);
    expect(back[4]).toBe(-1);
    // Out-of-range input is clipped.
    expect(back[5]).toBeCloseTo(1, 3);
  });

  it("decodes from an odd byte offset and ignores a trailing half sample", () => {
    const buf = new Uint8Array([0xff, 0x00, 0x40, 0x7f]);
    // Starting at offset 1: one full sample (0x4000 = 0.5) plus a stray byte.
    const out = pcm16ToFloat(buf.subarray(1));
    expect(out).toHaveLength(1);
    expect(out[0]).toBeCloseTo(0.5, 3);
  });

  it("encodes long chunks without overflowing the call stack", () => {
    expect(() => floatToPcm16Base64(new Float32Array(48000))).not.toThrow();
  });
});

describe("ElevenLabs settings", () => {
  it("is used only when a key is set and the provider is chosen", () => {
    expect(usesElevenInput(DEFAULT_SETTINGS)).toBe(false);
    expect(usesElevenOutput(DEFAULT_SETTINGS)).toBe(false);
    const keyed = { ...DEFAULT_SETTINGS, elevenLabsKey: "k" };
    expect(usesElevenInput(keyed)).toBe(true);
    expect(usesElevenOutput(keyed)).toBe(true);
    expect(usesElevenInput({ ...keyed, speechInput: "chrome" })).toBe(false);
    expect(usesElevenOutput({ ...keyed, speechOutput: "chrome" })).toBe(false);
  });
});
