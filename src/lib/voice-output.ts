// Spoken replies (ElevenLabs streaming, or the system voices) and short sounds ("earcons") for wake/sleep/error.
// System voices go through chrome.tts where it exists, and through speechSynthesis in Navi's background
// page, which has no chrome.tts (they're the same voices).

import { pcm16ToFloat, speechStream } from "./elevenlabs";

/**
 * One voice everywhere: Chrome's built-in "Google US English" is the same voice on
 * macOS and Windows. Others are fallbacks only if Chrome doesn't offer it.
 */
const PREFERRED_VOICES = [/^Google US English$/i, /Aria.*Natural/i, /^Samantha/i, /Zira/i];

let voicesPromise: Promise<chrome.tts.TtsVoice[]> | null = null;

const hasChromeTts = () => typeof chrome !== "undefined" && !!chrome.tts;

/** speechSynthesis loads its voices asynchronously. */
function synthesisVoices(): Promise<SpeechSynthesisVoice[]> {
  const now = speechSynthesis.getVoices();
  if (now.length) return Promise.resolve(now);
  return new Promise((resolve) => {
    const done = () => resolve(speechSynthesis.getVoices());
    speechSynthesis.addEventListener("voiceschanged", done, { once: true });
    setTimeout(done, 1000);
  });
}

export function listVoices(): Promise<chrome.tts.TtsVoice[]> {
  voicesPromise ??= hasChromeTts()
    ? new Promise((resolve) => chrome.tts.getVoices((voices) => resolve(voices ?? [])))
    : synthesisVoices().then((voices) =>
        voices.map((v) => ({ voiceName: v.name, lang: v.lang, remote: !v.localService }) as chrome.tts.TtsVoice),
      );
  return voicesPromise;
}

/** Picks the most pleasant available voice for the language. */
export async function pickVoice(lang: string): Promise<string | undefined> {
  const voices = (await listVoices()).filter((v) => !v.lang || v.lang.startsWith(lang.slice(0, 2)));
  for (const pattern of PREFERRED_VOICES) {
    const match = voices.find((v) => v.voiceName && pattern.test(v.voiceName));
    if (match) return match.voiceName;
  }
  return voices.find((v) => v.gender === "female")?.voiceName ?? voices[0]?.voiceName;
}

export type EarconName = "wake" | "sleep" | "error" | "unknown" | "done" | "thinking";

/** What the command controller needs to talk: it may run where there's no audio (the background worker). */
export interface Voice {
  say(text: string): Promise<void>;
  stop(): void;
  sound(name: EarconName): void;
}

export interface VoiceSettings {
  rate: number;
  voiceName: string;
  lang: string;
  volume: number;
  /** When set, Navi speaks with this ElevenLabs voice (Chrome's voice is the fallback). */
  eleven?: { apiKey: string; voiceId: string; model: string };
}

export class Speaker implements Voice {
  private speakingUntil = 0;
  private speaking = false;
  private utterance = 0;
  private abort: AbortController | null = null;
  private sources: AudioBufferSourceNode[] = [];

  constructor(
    private readonly getVoice: () => VoiceSettings,
    /** Told when ElevenLabs fails and Chrome's voice is used instead. */
    private readonly onFallback?: (message: string) => void,
  ) {}

  /** True while speaking and briefly after, so the mic doesn't hear Navi's own voice as a command. */
  get busy(): boolean {
    return this.speaking || Date.now() < this.speakingUntil;
  }

  /** Skips speech entirely (used by the benchmark runner). */
  muted = false;

  /** Called when audio actually starts playing (used by the voice lab to time voices). */
  onAudioStart?: () => void;

  async say(text: string): Promise<void> {
    const clean = text.replace(/[*_`#>]/g, "").trim();
    if (!clean || this.muted) return;
    this.stopPlayback();
    const id = ++this.utterance;
    this.speaking = true;
    const voice = this.getVoice();
    try {
      if (voice.eleven) {
        const played = await this.sayEleven(clean, voice, voice.eleven, id).catch((err: unknown) => {
          if (id === this.utterance && !(err instanceof DOMException && err.name === "AbortError")) {
            this.onFallback?.(err instanceof Error ? err.message : String(err));
          }
          return false;
        });
        // Fall back to Chrome's voice only if nothing was heard yet.
        if (played || id !== this.utterance) return;
      }
      await this.sayChrome(clean, voice, id);
    } finally {
      // A newer utterance may have started; only the latest one controls the flag.
      if (id === this.utterance) {
        this.speaking = false;
        this.speakingUntil = Date.now() + 700;
      }
    }
  }

  /** Streams ElevenLabs audio and plays it as it arrives. Resolves true once playback ends. */
  private async sayEleven(
    text: string,
    voice: VoiceSettings,
    eleven: NonNullable<VoiceSettings["eleven"]>,
    id: number,
  ): Promise<boolean> {
    const ctx = await runningAudio();
    const abort = new AbortController();
    this.abort = abort;
    const stream = await speechStream(
      eleven.apiKey,
      text,
      { voiceId: eleven.voiceId, model: eleven.model, speed: voice.rate },
      abort.signal,
    );
    const gain = ctx.createGain();
    gain.gain.value = voice.volume;
    gain.connect(ctx.destination);
    const reader = stream.getReader();
    let playhead = 0;
    let leftover = new Uint8Array(0);
    let played = false;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done || id !== this.utterance) break;
        const bytes = leftover.length ? concat(leftover, value) : value;
        const usable = bytes.length - (bytes.length % 2);
        leftover = bytes.slice(usable);
        const samples = pcm16ToFloat(bytes.subarray(0, usable));
        if (!samples.length) continue;
        const buffer = ctx.createBuffer(1, samples.length, 24000);
        buffer.copyToChannel(samples, 0);
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(gain);
        // A small head start absorbs network jitter between chunks.
        playhead = Math.max(playhead, ctx.currentTime + 0.05);
        source.start(playhead);
        playhead += buffer.duration;
        this.sources.push(source);
        if (!played) this.onAudioStart?.();
        played = true;
      }
    } catch (err) {
      // Once audio is playing, let what arrived finish rather than repeating it in another voice.
      if (!played) throw err;
    } finally {
      reader.releaseLock();
    }
    if (!played) return false;
    // Wait for the scheduled audio to finish (or for stop()).
    await new Promise<void>((resolve) => {
      if (abort.signal.aborted) return resolve();
      const timer = window.setTimeout(resolve, Math.max(0, (playhead - ctx.currentTime) * 1000));
      abort.signal.addEventListener("abort", () => {
        window.clearTimeout(timer);
        resolve();
      });
    });
    return true;
  }

  private async sayChrome(text: string, voice: VoiceSettings, id: number): Promise<void> {
    const voiceName = voice.voiceName || (await pickVoice(voice.lang));
    if (id !== this.utterance) return;
    if (!hasChromeTts()) return this.saySynthesis(text, voice, voiceName);
    return new Promise((resolve) => {
      let finished = false;
      const done = () => {
        if (finished) return;
        finished = true;
        resolve();
      };
      chrome.tts.speak(text, {
        rate: voice.rate,
        lang: voice.lang,
        volume: voice.volume,
        voiceName: voiceName || undefined,
        enqueue: false,
        onEvent: (event) => {
          if (event.type === "start") this.onAudioStart?.();
          if (["end", "interrupted", "cancelled", "error"].includes(event.type)) done();
        },
      });
      // Safety net in case no end event arrives.
      window.setTimeout(done, 1000 + text.length * 120);
    });
  }

  private async saySynthesis(text: string, voice: VoiceSettings, voiceName: string | undefined): Promise<void> {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = voice.rate;
    utterance.volume = voice.volume;
    utterance.lang = voice.lang;
    const match = (await synthesisVoices()).find((v) => v.name === voiceName);
    if (match) utterance.voice = match;
    return new Promise((resolve) => {
      let finished = false;
      const done = () => {
        if (!finished) resolve();
        finished = true;
      };
      utterance.onstart = () => this.onAudioStart?.();
      utterance.onend = done;
      utterance.onerror = done;
      speechSynthesis.cancel();
      speechSynthesis.speak(utterance);
      setTimeout(done, 1000 + text.length * 120);
    });
  }

  private stopPlayback() {
    this.abort?.abort();
    this.abort = null;
    for (const source of this.sources) {
      try {
        source.stop();
      } catch {
        // Already stopped.
      }
    }
    this.sources = [];
  }

  sound(name: EarconName) {
    earcons[name]();
  }

  stop() {
    this.utterance++;
    this.stopPlayback();
    if (hasChromeTts()) chrome.tts.stop();
    else if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
    this.speaking = false;
  }
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}

/** The shared audio output, resumed if the browser suspended it. */
async function runningAudio(): Promise<AudioContext> {
  audio ??= new AudioContext();
  if (audio.state !== "running") {
    await Promise.race([audio.resume(), new Promise((r) => window.setTimeout(r, 300))]);
    // resume() may have changed the state since the check above.
    if ((audio.state as AudioContextState) !== "running") throw new Error("Chrome blocked audio playback; using Chrome's voice.");
  }
  return audio;
}

let audio: AudioContext | null = null;
let masterVolume = 0.6;

/** Scales the sound effects with the user's volume setting. */
export function setSoundVolume(volume: number) {
  masterVolume = volume;
}

function tone(freq: number, start: number, duration: number, level = 0.08) {
  const volume = level * masterVolume;
  if (volume <= 0) return;
  audio ??= new AudioContext();
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  const t = audio.currentTime + start;
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(volume, t + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  osc.connect(gain).connect(audio.destination);
  osc.start(t);
  osc.stop(t + duration + 0.02);
}

export const earcons = {
  wake() {
    tone(660, 0, 0.12);
    tone(990, 0.09, 0.16);
  },
  sleep() {
    tone(880, 0, 0.12);
    tone(587, 0.09, 0.18);
  },
  error() {
    tone(330, 0, 0.12, 0.07);
    tone(262, 0.1, 0.16, 0.07);
  },
  /** Soft "didn't catch that" (heard speech, but it wasn't a command). */
  unknown() {
    tone(523, 0, 0.09, 0.05);
    tone(440, 0.08, 0.12, 0.05);
  },
  done() {
    tone(1175, 0, 0.08, 0.05);
  },
  /** Soft tick when a command goes to the AI, so you know Navi heard you. */
  thinking() {
    tone(784, 0, 0.06, 0.04);
  },
};
