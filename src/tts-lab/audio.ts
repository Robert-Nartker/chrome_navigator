// Audio helpers for the voice lab: gapless playback of synthesized chunks, and text splitting.

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
/** Longer first sentences are split at a clause boundary, so a voice can start speaking sooner. */
const QUICK_START_WORDS = 10;

/**
 * Splits off a short opening clause when the first sentence is long ("Your inbox has three new emails,
 * one from Sarah…" → "Your inbox has three new emails," + the rest). A voice that synthesizes a sentence
 * at a time starts speaking after the clause instead of the whole sentence, and the rest is made while
 * the clause plays. Returns ["", text] when there's nothing worth splitting.
 */
export function splitFirstClause(text: string): [string, string] {
  const trimmed = text.trim();
  const first = splitSentences(trimmed)[0] ?? "";
  const words = first.split(/\s+/);
  if (words.length <= QUICK_START_WORDS + 2) return ["", trimmed];
  // After a comma, semicolon, colon or dash between the 3rd and 14th word; else before "and", "but"…
  let cut = words.findIndex((w, i) => i >= 2 && i < 14 && /[,;:—–]$/.test(w)) + 1;
  if (!cut) cut = words.findIndex((w, i) => i >= 4 && i < 14 && /^(?:and|but|so|because|which|while|then)$/i.test(w));
  if (cut <= 0 || words.length - cut < 3) return ["", trimmed];
  const head = words.slice(0, cut).join(" ");
  return [head, trimmed.slice(trimmed.indexOf(head) + head.length).trim()];
}

export function splitSentences(text: string): string[] {
  const out: string[] = [];
  for (const piece of text.trim().split(/(?<=[.!?])\s+/)) {
    if (!piece) continue;
    if (out.length && ABBREVIATION.test(out[out.length - 1])) out[out.length - 1] += ` ${piece}`;
    else out.push(piece);
  }
  return out;
}
