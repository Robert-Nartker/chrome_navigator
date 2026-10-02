import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSpeechEngine, withoutRunWords } from "../../src/lib/speech";

// A scripted stand-in for Chrome's recognizer: tests say what it hears and when it ends. Like Chrome,
// a session's results are a growing list of pieces; only the last one can still be changing.
type Handler = ((e?: unknown) => void) | null;
type Piece = { transcript: string; isFinal: boolean; others: string[] };
class FakeRecognition {
  static all: FakeRecognition[] = [];
  onresult: Handler = null;
  onerror: Handler = null;
  onend: Handler = null;
  onstart: Handler = null;
  onaudiostart: Handler = null;
  aborted = false;
  startedAt = Date.now();
  pieces: Piece[] = [];
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
  /** Words of the piece being heard (a new piece if the last one is finished); `isFinal` finishes it. */
  hear(transcript: string, isFinal: boolean, others: string[] = []) {
    const last = this.pieces.at(-1);
    if (last && !last.isFinal) Object.assign(last, { transcript, isFinal, others });
    else this.pieces.push({ transcript, isFinal, others });
    const results = this.pieces.map((p) =>
      Object.assign([{ transcript: p.transcript, confidence: 0.9 }, ...p.others.map((t) => ({ transcript: t, confidence: 0.4 }))], { isFinal: p.isFinal }),
    );
    this.onresult?.({ resultIndex: this.pieces.length - 1, results });
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
let alternatives: string[][];
let interims: string[];
let infos: string[];
let errors: string[];
const callbacks = {
  onInterim: (t: string) => interims.push(t),
  onFinal: (t: string, _c: number, alts?: string[]) => {
    finals.push(t);
    alternatives.push(alts ?? []);
  },
  onRunningChange: () => {},
  onError: (m: string) => errors.push(m),
  onInfo: (m: string) => infos.push(m),
};

/** A whole command ends sooner (Navi's ears decide by parsing it; here, a short list). */
const WHOLE = new Set(["close tab", "go back", "scroll down"]);

async function started(): Promise<WebSpeechEngine> {
  const engine = new WebSpeechEngine({ lang: "en-US", endOfPhraseMs: (t) => (WHOLE.has(t) ? 200 : 600) }, callbacks);
  await engine.start();
  await vi.advanceTimersByTimeAsync(1);
  return engine;
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeRecognition.all = [];
  finals = [];
  alternatives = [];
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
  it("puts the pieces Chrome splits a phrase into back together", async () => {
    const engine = await started();
    current().hear("8", true);
    await vi.advanceTimersByTimeAsync(300);
    current().hear("thousand", false);
    expect(interims.at(-1)).toBe("8 thousand");
    current().hear("thousand", true);
    expect(finals).toEqual([]);
    await vi.advanceTimersByTimeAsync(650);
    expect(finals).toEqual(["8 thousand"]);
    // The next phrase starts fresh.
    current().hear("close", true);
    await vi.advanceTimersByTimeAsync(250);
    current().hear("tab", true);
    await vi.advanceTimersByTimeAsync(650);
    expect(finals).toEqual(["8 thousand", "close tab"]);
    engine.stop();
  });

  it("runs a whole command after a moment, and waits longer for one that isn't finished", async () => {
    const engine = await started();
    current().hear("close tab", true);
    await vi.advanceTimersByTimeAsync(250);
    expect(finals).toEqual(["close tab"]);
    current().hear("search for", true);
    await vi.advanceTimersByTimeAsync(300);
    expect(finals).toEqual(["close tab"]);
    current().hear("used cars", true);
    await vi.advanceTimersByTimeAsync(650);
    expect(finals).toEqual(["close tab", "search for used cars"]);
    engine.stop();
  });

  it("passes on Chrome's other guesses for a phrase in one piece", async () => {
    const engine = await started();
    current().hear("scroll dune", true, ["scroll down", "scroll june"]);
    await vi.advanceTimersByTimeAsync(700);
    expect(finals).toEqual(["scroll dune"]);
    expect(alternatives).toEqual([["scroll down", "scroll june"]]);
    engine.stop();
  });

  it("finishes a phrase Chrome sits on, without restarting Chrome, and doesn't run Chrome's late copy", async () => {
    const engine = await started();
    current().hear("close tab", false);
    await vi.advanceTimersByTimeAsync(1000);
    expect(finals).toEqual([]);
    await vi.advanceTimersByTimeAsync(150);
    expect(finals).toEqual(["close tab"]);
    // Chrome finishes it late: not run twice. Same session, no gap.
    current().hear("close tab", true);
    await vi.advanceTimersByTimeAsync(700);
    expect(finals).toEqual(["close tab"]);
    expect(FakeRecognition.all).toHaveLength(1);
    expect(current().aborted).toBe(false);
    current().hear("go back", true);
    await vi.advanceTimersByTimeAsync(250);
    expect(finals).toEqual(["close tab", "go back"]);
    engine.stop();
  });

  it("hears new words Chrome adds to a piece it was holding", async () => {
    const engine = await started();
    current().hear("close tab", false);
    await vi.advanceTimersByTimeAsync(1200);
    expect(finals).toEqual(["close tab"]);
    // Chrome keeps going in the same piece: only the new words are a new phrase.
    current().hear("close tab scroll down", false);
    expect(interims.at(-1)).toBe("scroll down");
    current().hear("close tab scroll down", true);
    await vi.advanceTimersByTimeAsync(250);
    expect(finals).toEqual(["close tab", "scroll down"]);
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
    // Pieces Chrome finished but Navi was still waiting on, too.
    await vi.advanceTimersByTimeAsync(100);
    current().hear("8", true);
    current().end();
    expect(finals).toEqual(["undo", "8"]);
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
    await vi.advanceTimersByTimeAsync(250);
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

describe("words Navi already ran from a piece Chrome was holding", () => {
  const w = (s: string) => s.split(" ");
  it("come off when Chrome adds to the piece, even if it tidied them up", () => {
    expect(withoutRunWords(w("close tab scroll down"), w("close tab"))).toBe("scroll down");
    expect(withoutRunWords(w("close tab scroll down"), w("close tap"))).toBe("scroll down");
    expect(withoutRunWords(w("close tab"), w("close tab"))).toBe("");
  });
  it("don't when the piece is different speech", () => {
    expect(withoutRunWords(w("go to sleep"), w("hey navi what time is it"))).toBe("go to sleep");
  });
});
