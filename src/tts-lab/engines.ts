// The speech engines the voice lab compares. The free neural engines are imported only when first
// used, so their libraries (and ONNX Runtime) stay out of this bundle and every other page's.

import type { PocketTTS, ProgressInfo } from "pocket-tts-js";
import { DEFAULT_VOICE_ID, TTS_MODELS } from "../lib/elevenlabs";
import type { Settings } from "../lib/settings";
import { Speaker } from "../lib/voice-output";
import { type ChunkPlayer, decodeWav, splitSentences } from "./audio";
import type { KokoroDevice } from "./kokoro";
import type { KokoroReply, KokoroRequest } from "./kokoro-worker";
import type { TtsSession } from "./piper";

export { KOKORO_VOICES } from "./kokoro-voices";

export type EngineId = "system" | "kokoro" | "pocket" | "piper" | "eleven";

export interface LabVoice {
  /** Unique across engines ("kokoro:af_heart"); ratings are saved under it. */
  key: string;
  engine: EngineId;
  /** The engine's own name for the voice. */
  id: string;
  name: string;
  /** Accent, gender and the like. */
  detail: string;
  lang?: string;
  /** Chrome voices that send text to an online service. */
  online?: boolean;
}

/** An engine or voice's first load in this tab. */
export interface LoadStats {
  ms: number;
  /** Size of the downloaded files (0 when unknown). */
  bytes: number;
  /** Came from the browser's storage rather than the network. */
  cached: boolean;
}

export interface RunStats {
  /** From the start of synthesis until the first audio was ready to play. */
  firstAudioMs: number | null;
  /** Until the whole phrase was synthesized (playback can still be going). */
  synthMs: number | null;
  /** Length of the audio produced. */
  audioSec: number | null;
}

export interface Download {
  loaded: number;
  total: number;
}

export interface SpeakOptions {
  text: string;
  player: ChunkPlayer;
  volume: number;
  signal: AbortSignal;
}

export interface Engine {
  /**
   * Loads the engine (and `voice`, for engines with one model per voice), downloading it the first time.
   * Returns stats only to the call that actually loaded something.
   */
  prepare(onProgress: (d: Download) => void, voice?: LabVoice): Promise<LoadStats | null>;
  /** Speaks and resolves when playback has finished. */
  speak(voice: LabVoice, o: SpeakOptions): Promise<RunStats>;
  stop(): void;
}

export const PIPER_VOICES: LabVoice[] = [
  ["en_US-hfc_female-medium", "HFC female", "US English · female"],
  ["en_US-amy-medium", "Amy", "US English · female"],
  ["en_US-kristin-medium", "Kristin", "US English · female"],
  ["en_US-lessac-medium", "Lessac", "US English · female"],
  ["en_GB-jenny_dioco-medium", "Jenny", "British English · female"],
].map(([id, name, detail]) => ({ key: `piper:${id}`, engine: "piper", id, name, detail }));

export function systemVoices(voices: chrome.tts.TtsVoice[]): LabVoice[] {
  return voices
    .filter((v) => v.voiceName)
    .map((v) => ({
      key: `system:${v.voiceName}`,
      engine: "system" as const,
      id: v.voiceName!,
      name: v.voiceName!,
      detail: [v.lang, v.remote ? "online" : "on this computer"].filter(Boolean).join(" · "),
      lang: v.lang ?? "",
      online: !!v.remote,
    }));
}

export function pocketVoices(names: string[]): LabVoice[] {
  return names.map((id) => ({
    key: `pocket:${id}`,
    engine: "pocket",
    id,
    name: id.charAt(0).toUpperCase() + id.slice(1),
    detail: "English",
  }));
}

export function elevenVoice(settings: Settings): LabVoice {
  const model = TTS_MODELS.find((m) => m.id === settings.elevenModel)?.label ?? settings.elevenModel;
  return {
    key: `eleven:${settings.elevenVoiceId}`,
    engine: "eleven",
    id: settings.elevenVoiceId,
    name: settings.elevenVoiceId === DEFAULT_VOICE_ID ? "Sarah" : "Your ElevenLabs voice",
    detail: `Paid, online · ${model}`,
  };
}

/** Loads each key once; only the first caller gets the load stats. A failed load can be retried. */
class Loader<T> {
  readonly loads = new Map<string, Promise<{ value: T; stats: LoadStats }>>();

  async get(key: string, load: () => Promise<{ value: T; stats: LoadStats }>) {
    let pending = this.loads.get(key);
    const first = !pending;
    if (!pending) {
      pending = load();
      this.loads.set(key, pending);
      pending.catch(() => this.loads.delete(key));
    }
    const { value, stats } = await pending;
    return { value, stats: first ? stats : null };
  }
}

/** Adds up progress across several downloaded files. */
function downloads(onProgress: (d: Download) => void) {
  const files = new Map<string, Download>();
  const sum = () => {
    let loaded = 0;
    let total = 0;
    for (const f of files.values()) {
      loaded += f.loaded;
      total += f.total;
    }
    return { loaded, total };
  };
  return {
    update(file: string, loaded: number, total: number) {
      files.set(file, { loaded, total: Math.max(total, loaded) });
      onProgress(sum());
    },
    get bytes() {
      return sum().total;
    },
  };
}

/** Plays chunks as they're synthesized and times the synthesis. */
async function timed(
  o: SpeakOptions,
  synthesize: (emit: (samples: Float32Array, sampleRate: number) => void) => Promise<void>,
): Promise<RunStats> {
  const start = performance.now();
  let firstAudioMs: number | null = null;
  let audioSec = 0;
  await synthesize((samples, sampleRate) => {
    if (o.signal.aborted) return;
    firstAudioMs ??= performance.now() - start;
    audioSec += samples.length / sampleRate;
    o.player.play(samples, sampleRate);
  });
  const synthMs = performance.now() - start;
  await o.player.drain(o.signal);
  return { firstAudioMs, synthMs, audioSec };
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer = 0;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => (timer = window.setTimeout(() => reject(new Error(message)), ms))),
  ]).finally(() => window.clearTimeout(timer));
}

/** Chrome's own voices (chrome.tts): built into the OS or Chrome, or an online Google voice. */
export const systemEngine: Engine = {
  async prepare() {
    return null;
  },
  speak(voice, o) {
    const start = performance.now();
    let firstAudioMs: number | null = null;
    return new Promise((resolve, reject) => {
      let finished = false;
      const finish = (error?: string) => {
        if (finished) return;
        finished = true;
        window.clearTimeout(timer);
        o.signal.removeEventListener("abort", onAbort);
        if (error) reject(new Error(error));
        else resolve({ firstAudioMs, synthMs: null, audioSec: null });
      };
      const onAbort = () => {
        chrome.tts.stop();
        finish();
      };
      // Safety net in case Chrome never reports the end.
      const timer = window.setTimeout(() => finish(), 10_000 + o.text.length * 150);
      o.signal.addEventListener("abort", onAbort);
      chrome.tts.speak(o.text, {
        voiceName: voice.id,
        volume: o.volume,
        rate: 1,
        enqueue: false,
        onEvent: (event) => {
          if (event.type === "start") firstAudioMs ??= performance.now() - start;
          else if (event.type === "error") finish(event.errorMessage || "Chrome couldn't use this voice.");
          else if (["end", "interrupted", "cancelled"].includes(event.type)) finish();
        },
      });
    });
  },
  stop() {
    chrome.tts.stop();
  },
};

/** Kokoro's worker (kokoro-worker.ts), with a request/reply helper. */
class KokoroWorker {
  private readonly worker = new Worker(chrome.runtime.getURL("lab/kokoro-worker.js"), { type: "module" });
  private readonly listeners = new Set<(reply: KokoroReply) => void>();

  constructor() {
    this.worker.onmessage = (e: MessageEvent<KokoroReply>) => this.listeners.forEach((l) => l(e.data));
    this.worker.onerror = (e) => {
      e.preventDefault();
      this.listeners.forEach((l) => l({ type: "error", message: e.message || "Kokoro's worker stopped" }));
    };
  }

  post(request: KokoroRequest) {
    this.worker.postMessage(request);
  }

  /** Sends `request` and passes replies to `handle` until it returns a value. Rejects on an error reply. */
  request<T>(request: KokoroRequest, handle: (reply: KokoroReply) => T | undefined): Promise<T> {
    const id = "id" in request ? request.id : undefined;
    return new Promise((resolve, reject) => {
      const listener = (reply: KokoroReply) => {
        // Ignore what's left of an earlier, stopped request.
        if ("id" in reply && reply.id !== undefined && reply.id !== id) return;
        const result = reply.type === "error" ? undefined : handle(reply);
        if (reply.type !== "error" && result === undefined) return;
        this.listeners.delete(listener);
        if (reply.type === "error") reject(new Error(reply.message));
        else resolve(result as T);
      };
      this.listeners.add(listener);
      this.post(request);
    });
  }

  terminate() {
    this.worker.terminate();
    this.listeners.forEach((l) => l({ type: "error", message: "Kokoro was unloaded" }));
  }
}

/** Kokoro via transformers.js in a worker, on the GPU (WebGPU) or the CPU (WebAssembly). One model, many voices. */
export function kokoroEngine() {
  const loader = new Loader<KokoroWorker>();
  let nextId = 0;
  return {
    device: "wasm" as KokoroDevice,

    async prepare(onProgress: (d: Download) => void) {
      const device = this.device;
      // One model in memory at a time: switching devices ends the other one's worker.
      for (const [key, load] of loader.loads) {
        if (key === device) continue;
        loader.loads.delete(key);
        void load.then(({ value }) => value.terminate()).catch(() => {});
      }
      const { stats } = await loader.get(device, async () => {
        const worker = new KokoroWorker();
        const files = downloads(onProgress);
        const start = performance.now();
        try {
          const wasmPaths = chrome.runtime.getURL("vendor/transformers/");
          const cached = await worker.request({ type: "load", device, wasmPaths }, (reply) => {
            if (reply.type === "progress" && reply.status === "progress" && reply.file) {
              files.update(reply.file, reply.loaded ?? 0, reply.total ?? 0);
            }
            return reply.type === "loaded" ? reply.cached : undefined;
          });
          return { value: worker, stats: { ms: performance.now() - start, bytes: files.bytes, cached } };
        } catch (err) {
          worker.terminate();
          throw err;
        }
      });
      return stats;
    },

    async speak(voice: LabVoice, o: SpeakOptions) {
      const load = loader.loads.get(this.device);
      if (!load) throw new Error("Kokoro isn't loaded.");
      const { value: worker } = await load;
      const id = ++nextId;
      const onAbort = () => worker.post({ type: "stop" });
      o.signal.addEventListener("abort", onAbort);
      try {
        return await timed(o, async (emit) => {
          await worker.request({ type: "speak", id, text: o.text, voice: voice.id }, (reply) => {
            if (reply.type === "audio") emit(reply.samples, reply.sampleRate);
            return reply.type === "done" || undefined;
          });
        });
      } finally {
        o.signal.removeEventListener("abort", onAbort);
      }
    },

    stop() {
      // speak() tells the worker through the abort signal.
    },

    /** Ends the worker, freeing the model's memory. */
    dispose() {
      for (const load of loader.loads.values()) void load.then(({ value }) => value.terminate()).catch(() => {});
      loader.loads.clear();
    },
  } satisfies Engine & { device: KokoroDevice; dispose(): void };
}

/** Kyutai's Pocket TTS, running in its own worker. One model with a set of built-in voices. */
export function pocketEngine() {
  const loader = new Loader<PocketTTS>();
  const refs = new Map<string, string>();
  let tts: PocketTTS | null = null;
  return {
    voices: () => pocketVoices(tts?.predefinedVoices ?? []),

    async prepare(onProgress: (d: Download) => void, voice?: LabVoice) {
      const { value, stats } = await loader.get("pocket", async () => {
        // Loaded from the extension's own files at runtime, so the library's worker (which it finds
        // relative to its own URL) and ONNX Runtime come from the extension, not a CDN.
        const url = chrome.runtime.getURL("vendor/pocket-tts/index.js");
        const { PocketTTS } = (await import(url)) as typeof import("pocket-tts-js");
        const pocket = new PocketTTS({
          language: "english_2026-04",
          voiceCloning: false,
          ortBaseUrl: chrome.runtime.getURL("vendor/ort-1.20.0/"),
        });
        const files = downloads(onProgress);
        let cached = true;
        const start = performance.now();
        try {
          await pocket.load((p: ProgressInfo) => {
            if (p.type !== "progress" || !p.label) return;
            files.update(p.label, p.loaded ?? 0, p.total ?? 0);
            if (!p.fromCache) cached = false;
          });
          // The built-in voices come in one file; fetch it now so it counts as part of the first load.
          const first = pocket.predefinedVoices[0];
          if (first) refs.set(first, await pocket.loadVoice(first));
        } catch (err) {
          pocket.destroy();
          throw err;
        }
        return { value: pocket, stats: { ms: performance.now() - start, bytes: files.bytes, cached } };
      });
      tts = value;
      if (voice && !refs.has(voice.id)) refs.set(voice.id, await value.loadVoice(voice.id));
      return stats;
    },

    async speak(voice: LabVoice, o: SpeakOptions) {
      const pocket = tts;
      const ref = refs.get(voice.id);
      if (!pocket || !ref) throw new Error("Pocket TTS isn't loaded.");
      const onAbort = () => void pocket.stop();
      o.signal.addEventListener("abort", onAbort);
      try {
        return await timed(o, async (emit) => {
          await pocket.generate(o.text, { voice: ref, onChunk: (audio) => emit(audio, pocket.sampleRate) });
        });
      } finally {
        o.signal.removeEventListener("abort", onAbort);
      }
    },

    stop() {
      void tts?.stop();
    },

    /** Ends Pocket TTS's worker, freeing the model's memory. */
    dispose() {
      for (const load of loader.loads.values()) void load.then(({ value }) => value.destroy()).catch(() => {});
      loader.loads.clear();
      tts = null;
    },
  } satisfies Engine & { voices(): LabVoice[]; dispose(): void };
}

/** Piper: one small model per voice, downloaded when the voice is first played. */
export function piperEngine(): Engine {
  const loader = new Loader<TtsSession>();
  return {
    async prepare(onProgress, voice) {
      if (!voice) return null;
      const { stats } = await loader.get(voice.id, async () => {
        const { loadPiperVoice } = await import("./piper");
        let bytes = 0;
        const start = performance.now();
        const value = await loadPiperVoice(voice.id, (p) => {
          // (The library also reports progress through long texts here.)
          if (p.url.startsWith("tts://")) return;
          bytes = Math.max(bytes, p.total || p.loaded);
          onProgress({ loaded: p.loaded, total: p.total });
        });
        // No progress means it was read from the browser's storage.
        return { value, stats: { ms: performance.now() - start, bytes, cached: bytes === 0 } };
      });
      return stats;
    },

    async speak(voice, o) {
      const load = loader.loads.get(voice.id);
      if (!load) throw new Error("This Piper voice isn't loaded.");
      const { value: session } = await load;
      // Piper synthesizes a whole text at once, so go sentence by sentence to start sooner.
      return timed(o, async (emit) => {
        for (const sentence of splitSentences(o.text)) {
          if (o.signal.aborted) return;
          const wav = await withTimeout(session.predict(sentence), 30_000, "Piper stopped responding.");
          const { samples, sampleRate } = decodeWav(await wav.arrayBuffer());
          emit(samples, sampleRate);
        }
      });
    },

    stop() {
      // The sentence loop checks the abort signal.
    },
  };
}

/** The paid ElevenLabs voice from Navi's settings, spoken through Navi's own Speaker. */
export function elevenEngine(settings: Settings): Engine {
  let speaker: Speaker | null = null;
  return {
    async prepare() {
      return null;
    },

    async speak(_voice, o) {
      let fallback = "";
      const current = new Speaker(
        () => ({
          rate: 1,
          voiceName: "",
          lang: settings.lang,
          volume: o.volume,
          eleven: { apiKey: settings.elevenLabsKey, voiceId: settings.elevenVoiceId, model: settings.elevenModel },
        }),
        (message) => (fallback = message),
      );
      speaker = current;
      const start = performance.now();
      let firstAudioMs: number | null = null;
      current.onAudioStart = () => (firstAudioMs ??= performance.now() - start);
      const onAbort = () => current.stop();
      o.signal.addEventListener("abort", onAbort);
      try {
        await current.say(o.text);
      } finally {
        o.signal.removeEventListener("abort", onAbort);
      }
      if (fallback) throw new Error(`${fallback} Chrome's voice played instead.`);
      return { firstAudioMs, synthMs: null, audioSec: null };
    },

    stop() {
      speaker?.stop();
    },
  };
}
