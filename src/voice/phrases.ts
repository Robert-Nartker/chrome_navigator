// Splits microphone audio into phrases for recognizers that transcribe whole phrases (Parakeet, Whisper,
// Qwen3-ASR): a phrase starts when the speech detector is fairly sure it hears speech, and ends once it
// has heard none for a moment. Used by Navi's Parakeet listener and the recognizer tester.

/** Samples per detector frame at 16 kHz (32 ms), what Silero VAD expects. */
export const FRAME = 512;
export const RATE = 16000;
const FRAME_MS = (FRAME / RATE) * 1000;

export interface PhraseTuning {
  /** Speech probability that starts a phrase. */
  start: number;
  /** Probability that still counts as speech once a phrase has started. */
  still: number;
  /** Silence that ends a phrase. */
  hangMs: number;
  /** Audio kept from before speech is detected, so a phrase keeps its first sound. */
  prerollMs: number;
  /** Shorter blips (a cough, a click) aren't phrases. */
  minVoicedMs: number;
  /** A phrase is cut here even if the talking goes on. */
  maxSeconds: number;
}

const DEFAULT_TUNING: PhraseTuning = { start: 0.5, still: 0.35, hangMs: 350, prerollMs: 300, minVoicedMs: 150, maxSeconds: 20 };

export class PhraseDetector {
  private readonly tuning: PhraseTuning;
  private frames: Promise<void> = Promise.resolve();
  private pending = new Float32Array(0);
  private preroll: Float32Array[] = [];
  private phrase: Float32Array[] = [];
  private phraseSamples = 0;
  private quietMs = 0;
  private voicedMs = 0;
  private talking = false;
  /** Counts phrases, so a transcript of an earlier phrase isn't shown for a newer one. */
  phraseId = 0;

  /**
   * `probability`: the speech detector (0-1 per FRAME samples). `onPhrase`: a finished phrase's audio
   * at 16 kHz. `onStart`: a phrase began.
   */
  constructor(
    private readonly probability: (frame: Float32Array) => Promise<number> | number,
    private readonly onPhrase: (pcm: Float32Array) => void,
    tuning: Partial<PhraseTuning> = {},
    private readonly onStart?: () => void,
  ) {
    this.tuning = { ...DEFAULT_TUNING, ...tuning };
  }

  /** Whether a phrase is in progress. */
  get speaking(): boolean {
    return this.talking;
  }

  /** Samples in the phrase so far. */
  get samples(): number {
    return this.phraseSamples;
  }

  /** Microphone audio at 16 kHz, in any chunk size. */
  push(chunk: Float32Array) {
    const all = new Float32Array(this.pending.length + chunk.length);
    all.set(this.pending);
    all.set(chunk, this.pending.length);
    let at = 0;
    for (; at + FRAME <= all.length; at += FRAME) {
      const frame = all.slice(at, at + FRAME);
      this.frames = this.frames.then(() => this.onFrame(frame)).catch(() => undefined);
    }
    this.pending = all.slice(at);
  }

  /** The phrase so far, as one buffer. */
  audio(): Float32Array {
    const out = new Float32Array(this.phraseSamples);
    let at = 0;
    for (const c of this.phrase) {
      out.set(c, at);
      at += c.length;
    }
    return out;
  }

  /** The mic stopped: finishes the phrase in progress and forgets the rest. */
  flush(): Promise<void> {
    this.frames = this.frames.then(() => {
      if (this.talking) this.end();
      this.pending = new Float32Array(0);
      this.preroll = [];
    });
    return this.frames;
  }

  private async onFrame(frame: Float32Array) {
    const p = await this.probability(frame);
    const t = this.tuning;
    if (!this.talking) {
      this.preroll.push(frame);
      if (this.preroll.length * FRAME_MS > t.prerollMs) this.preroll.shift();
      if (p < t.start) return;
      this.talking = true;
      this.phraseId++;
      this.phrase = this.preroll;
      this.phraseSamples = this.preroll.length * FRAME;
      this.preroll = [];
      this.quietMs = 0;
      this.voicedMs = FRAME_MS;
      this.onStart?.();
      return;
    }
    this.phrase.push(frame);
    this.phraseSamples += frame.length;
    if (p >= t.still) {
      this.voicedMs += FRAME_MS;
      this.quietMs = 0;
    } else {
      this.quietMs += FRAME_MS;
    }
    if (this.quietMs >= t.hangMs || this.phraseSamples > RATE * t.maxSeconds) {
      if (this.voicedMs >= t.minVoicedMs) this.end();
      else this.drop();
    }
  }

  private end() {
    const pcm = this.audio();
    this.drop();
    this.onPhrase(pcm);
  }

  private drop() {
    this.talking = false;
    this.phrase = [];
    this.phraseSamples = 0;
  }
}

/** A loudness check, for when the speech detector can't load: fooled by fans, but better than nothing. */
export function loudness(): (frame: Float32Array) => number {
  let noise = 0.005;
  return (frame) => {
    let sum = 0;
    for (const s of frame) sum += s * s;
    const rms = Math.sqrt(sum / frame.length);
    const loud = rms > Math.max(0.006, noise * 3);
    if (!loud) noise = noise * 0.95 + rms * 0.05;
    return loud ? 1 : 0;
  };
}
