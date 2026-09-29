// Audio helpers for the voice lab: gapless playback of synthesized chunks, and text splitting.

import { pcm16ToFloat } from "../lib/elevenlabs";

/** Plays mono Float32 chunks back to back as a speech engine produces them, at Navi's volume. */
export class ChunkPlayer {
  private ctx: AudioContext | null = null;
  private gain: GainNode | null = null;
  private sources = new Set<AudioBufferSourceNode>();
  private playhead = 0;

  constructor(private volume: number) {}

  setVolume(volume: number) {
    this.volume = volume;
    if (this.gain) this.gain.gain.value = volume;
  }

  /** Call from a click so Chrome lets audio start. */
  async resume(): Promise<void> {
    this.ctx ??= new AudioContext();
    if (!this.gain) {
      this.gain = this.ctx.createGain();
      this.gain.connect(this.ctx.destination);
    }
    this.gain.gain.value = this.volume;
    if (this.ctx.state !== "running") await this.ctx.resume();
  }

  play(samples: Float32Array, sampleRate: number) {
    if (!this.ctx || !this.gain || !samples.length) return;
    const buffer = this.ctx.createBuffer(1, samples.length, sampleRate);
    buffer.getChannelData(0).set(samples);
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.gain);
    // A small head start keeps chunks from overlapping or clicking.
    this.playhead = Math.max(this.playhead, this.ctx.currentTime + 0.05);
    source.start(this.playhead);
    this.playhead += buffer.duration;
    this.sources.add(source);
    source.onended = () => this.sources.delete(source);
  }

  /** Resolves once everything queued has played, or when `signal` aborts. */
  async drain(signal: AbortSignal): Promise<void> {
    const ctx = this.ctx;
    while (ctx && !signal.aborted && ctx.currentTime < this.playhead) {
      await sleep(Math.min(200, (this.playhead - ctx.currentTime) * 1000 + 20), signal);
    }
  }

  stop() {
    for (const source of this.sources) {
      try {
        source.stop();
      } catch {
        // Already stopped.
      }
    }
    this.sources.clear();
    this.playhead = 0;
  }
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      window.clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    };
    const timer = window.setTimeout(done, ms);
    signal?.addEventListener("abort", done);
  });
}

const ABBREVIATION = /\b(?:Dr|Mr|Mrs|Ms|Mt|St|Jr|Sr|Prof|vs|etc|No)\.$/i;

/** Splits text into sentences, so engines that aren't streaming can start speaking after the first one. */
export function splitSentences(text: string): string[] {
  const out: string[] = [];
  for (const piece of text.trim().split(/(?<=[.!?])\s+/)) {
    if (!piece) continue;
    if (out.length && ABBREVIATION.test(out[out.length - 1])) out[out.length - 1] += ` ${piece}`;
    else out.push(piece);
  }
  return out;
}

/** Samples and rate of a 16-bit mono WAV file (the format Piper returns). */
export function decodeWav(wav: ArrayBuffer): { samples: Float32Array; sampleRate: number } {
  const sampleRate = new DataView(wav).getUint32(24, true);
  return { samples: pcm16ToFloat(new Uint8Array(wav, 44)), sampleRate };
}
