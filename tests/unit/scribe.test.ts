import { describe, expect, it } from "vitest";
import { VoiceDetector } from "../../src/lib/scribe";

const chunk = (level: number) => new Float32Array(1600).fill(level);

describe("voice detector (talk-only streaming)", () => {
  it("sends nothing while it's quiet", () => {
    const vad = new VoiceDetector();
    for (let i = 0; i < 20; i++) expect(vad.push(chunk(0.002))).toBe(false);
  });

  it("starts after two loud chunks and keeps sending through a short pause", () => {
    const vad = new VoiceDetector();
    for (let i = 0; i < 10; i++) vad.push(chunk(0.003));
    expect(vad.push(chunk(0.2))).toBe(false);
    expect(vad.push(chunk(0.2))).toBe(true);
    // A 1 s pause mid-sentence is still part of the phrase.
    for (let i = 0; i < 10; i++) expect(vad.push(chunk(0.003))).toBe(true);
    expect(vad.push(chunk(0.2))).toBe(true);
  });

  it("stops 1.5 s after speech ends", () => {
    const vad = new VoiceDetector();
    vad.push(chunk(0.2));
    vad.push(chunk(0.2));
    let sent = 0;
    for (let i = 0; i < 30; i++) if (vad.push(chunk(0.003))) sent++;
    expect(sent).toBe(15);
    expect(vad.speaking).toBe(false);
  });

  it("gives up on steady noise after 30 s and learns it as background", () => {
    const vad = new VoiceDetector();
    for (let i = 0; i < 305; i++) vad.push(chunk(0.1));
    expect(vad.speaking).toBe(false);
    // The same level no longer counts as speech.
    expect(vad.push(chunk(0.1))).toBe(false);
    expect(vad.push(chunk(0.1))).toBe(false);
  });
});
