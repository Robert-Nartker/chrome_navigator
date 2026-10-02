import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSpeechEngine } from "../../src/lib/speech";

// A scripted stand-in for Chrome's recognizer: tests say what it hears and when it ends.
type Handler = ((e?: unknown) => void) | null;
class FakeRecognition {
  static all: FakeRecognition[] = [];
  onresult: Handler = null;
  onerror: Handler = null;
  onend: Handler = null;
  onstart: Handler = null;
  onaudiostart: Handler = null;
  aborted = false;
  startedAt = Date.now();
  constructor() {
    FakeRecognition.all.push(this);
  }
  static available() {
    return Promise.resolve("available");
  }
  start() {
    this.startedAt = Date.now();
    setTimeout(() => this.onstart?.(), 0);
  }
  stop() {
    setTimeout(() => this.onend?.(), 0);
  }
  abort() {
    this.aborted = true;
    setTimeout(() => this.onend?.(), 0);
  }
  hear(transcript: string, isFinal: boolean) {
    this.onresult?.({ resultIndex: 0, results: [Object.assign([{ transcript, confidence: 0.9 }], { isFinal })] });
  }
  fail(error: string) {
    this.onerror?.({ error, message: "" });
  }
  end() {
    this.onend?.();
  }
}
const current = () => FakeRecognition.all.at(-1)!;

/** The mic's loudness, for the "Chrome went deaf" check. */
let micLevel = 0;
class FakeAudioContext {
  createAnalyser() {
    return { fftSize: 1024, getFloatTimeDomainData: (b: Float32Array) => b.fill(micLevel) };
  }
  createMediaStreamSource() {
    return { connect() {} };
  }
  close() {
    return Promise.resolve();
  }
}

let finals: string[];
let interims: string[];
let infos: string[];
let errors: string[];
const callbacks = {
  onInterim: (t: string) => interims.push(t),
  onFinal: (t: string) => finals.push(t),
  onRunningChange: () => {},
  onError: (m: string) => errors.push(m),
  onInfo: (m: string) => infos.push(m),
};

async function started(): Promise<WebSpeechEngine> {
  const engine = new WebSpeechEngine({ lang: "en-US" }, callbacks);
  await engine.start();
  await vi.advanceTimersByTimeAsync(1);
  return engine;
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeRecognition.all = [];
  finals = [];
  interims = [];
  infos = [];
  errors = [];
  micLevel = 0;
  const track = { readyState: "live", stop() {} };
  vi.stubGlobal("window", { SpeechRecognition: FakeRecognition, setTimeout, clearTimeout, setInterval, clearInterval });
  vi.stubGlobal("navigator", {
    mediaDevices: { getUserMedia: () => Promise.resolve({ getAudioTracks: () => [track], getTracks: () => [track] }) },
  });
  vi.stubGlobal("AudioContext", FakeAudioContext);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Chrome's recognizer, kept listening", () => {
  it("finishes a phrase Chrome sits on, starts a fresh session at once, and ignores Chrome's late copy", async () => {
    const engine = await started();
    const first = current();
    first.hear("close tab", false);
    await vi.advanceTimersByTimeAsync(1000);
    expect(finals).toEqual([]);
    await vi.advanceTimersByTimeAsync(150);
    expect(finals).toEqual(["close tab"]);
    expect(first.aborted).toBe(true);
    // Chrome's own final arrives late: not run twice.
    first.hear("close tab", true);
    expect(finals).toEqual(["close tab"]);
    // A new session is listening within a tenth of a second.
    await vi.advanceTimersByTimeAsync(100);
    expect(FakeRecognition.all).toHaveLength(2);
    current().hear("go back", true);
    expect(finals).toEqual(["close tab", "go back"]);
    engine.stop();
  });

  it("keeps changing words waiting: only a pause finishes the phrase", async () => {
    const engine = await started();
    for (const words of ["search", "search for", "search for pizza", "search for pizza near me"]) {
      current().hear(words, false);
      await vi.advanceTimersByTimeAsync(700);
    }
    expect(finals).toEqual([]);
    await vi.advanceTimersByTimeAsync(500);
    expect(finals).toEqual(["search for pizza near me"]);
    engine.stop();
  });

  it("runs a phrase still on screen when Chrome ends the session, instead of dropping it", async () => {
    const engine = await started();
    current().hear("undo", false);
    current().end();
    expect(finals).toEqual(["undo"]);
    expect(interims.at(-1)).toBe("");
    engine.stop();
  });

  it("restarts right away after quiet sessions, however many in a row (no growing wait)", async () => {
    const engine = await started();
    for (let i = 0; i < 12; i++) {
      await vi.advanceTimersByTimeAsync(3000);
      current().fail("no-speech");
      const before = FakeRecognition.all.length;
      current().end();
      await vi.advanceTimersByTimeAsync(80);
      expect(FakeRecognition.all.length, `session ${i}`).toBe(before + 1);
    }
    engine.stop();
  });

  it("waits longer each time only when sessions fail straight away", async () => {
    const engine = await started();
    const waits: number[] = [];
    for (let i = 0; i < 6; i++) {
      const before = FakeRecognition.all.length;
      current().end();
      let waited = 0;
      while (FakeRecognition.all.length === before) {
        await vi.advanceTimersByTimeAsync(50);
        waited += 50;
      }
      waits.push(waited);
    }
    expect(waits).toEqual([500, 1000, 2000, 4000, 8000, 8000]);
    // A session that works resets it.
    current().hear("scroll down", true);
    await vi.advanceTimersByTimeAsync(200);
    const before = FakeRecognition.all.length;
    current().end();
    await vi.advanceTimersByTimeAsync(80);
    expect(FakeRecognition.all.length).toBe(before + 1);
    engine.stop();
  });

  it("backs off on a broken mic, more each time it fails", async () => {
    const engine = await started();
    const waits: number[] = [];
    for (let i = 0; i < 4; i++) {
      await vi.advanceTimersByTimeAsync(2000);
      current().fail("audio-capture");
      const before = FakeRecognition.all.length;
      current().end();
      let waited = 0;
      while (FakeRecognition.all.length === before) {
        await vi.advanceTimersByTimeAsync(50);
        waited += 50;
      }
      waits.push(waited);
    }
    expect(waits).toEqual([500, 1000, 2000, 4000]);
    expect(errors).toEqual(["Can't hear the microphone. Check it's connected; retrying…"]);
    engine.stop();
  });

  it("restarts a recognizer that has gone deaf while someone talks, but not for silence or a short noise", async () => {
    const engine = await started();
    // Quiet room for a while: nothing happens.
    micLevel = 0.002;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(current().aborted).toBe(false);
    // A short noise: still nothing.
    micLevel = 0.2;
    await vi.advanceTimersByTimeAsync(500);
    micLevel = 0.002;
    await vi.advanceTimersByTimeAsync(3000);
    expect(current().aborted).toBe(false);
    // Talking for a second or more with no words from Chrome: it's restarted, once.
    const deaf = current();
    micLevel = 0.2;
    await vi.advanceTimersByTimeAsync(1500);
    expect(deaf.aborted).toBe(true);
    expect(FakeRecognition.all).toHaveLength(2);
    expect(infos).toContain("Chrome's recognizer stopped hearing; restarted it.");
    engine.stop();
  });

  it("doesn't restart while Chrome is hearing the talking", async () => {
    const engine = await started();
    micLevel = 0.2;
    for (let i = 0; i < 10; i++) {
      current().hear(`word ${i}`, false);
      await vi.advanceTimersByTimeAsync(500);
    }
    expect(FakeRecognition.all).toHaveLength(1);
    expect(current().aborted).toBe(false);
    engine.stop();
  });
});
