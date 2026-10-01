// Parakeet (NVIDIA, open weights) as Navi's recognizer, instead of Chrome's: it runs on this computer, on
// the graphics chip when there is one. Silero VAD splits the mic into phrases; while one is being said,
// Parakeet re-transcribes it every half second for the live caption, and transcribes it once more when
// it ends. Built as its own ES module (voice/parakeet.js) that Navi's background page imports only when
// Parakeet is chosen, so its libraries load nowhere else. The model runs in the recognizer tester's worker.

import type { SpeechCallbacks, SpeechEngine } from "../lib/speech";
import type { AsrReply, AsrRequest } from "../asr-lab/worker";
import { PhraseDetector, RATE, loudness } from "./phrases";
import { type Vad, loadVad } from "./vad";
import { hasWebGpu } from "./gpu";
import { parakeetModelFor } from "./parakeet-langs";

/** While talking, the phrase so far is transcribed at most this often for the live caption. */
const LIVE_EVERY_MS = 1000;
/** Longer phrases get no live caption, only the finished transcript (each live pass redoes the whole phrase). */
const LIVE_MAX_S = 6;
/** Phrases shorter than this are clicks and breaths. */
const MIN_PHRASE_S = 0.3;
/** A command is short; nonstop "speech" (a video, the TV) is cut into pieces this long. */
const MAX_PHRASE_S = 12;
/** Processor threads for the model: the rest of the computer keeps the others. */
const THREADS = 2;
/**
 * Taking longer than this fraction of a phrase's length to transcribe it, this many times in a row, means
 * this computer can't keep up: Chrome's recognizer takes over rather than letting Parakeet bog it down.
 */
const TOO_SLOW = { ratio: 0.8, times: 3 };

export interface ParakeetEngine extends SpeechEngine {
  /** Roughly what it downloads once. */
  readonly downloadGb: number;
  /** Downloads (the first time) and loads the model and speech detector. The mic stays off. */
  load(onProgress: (loaded: number, total: number) => void): Promise<void>;
  /** Unloads the model (its worker and memory). */
  dispose(): void;
}

/** Stands in for the model in tests: the text for the phrase so far (live) or the finished phrase. */
export type FakeModel = (pcm: Float32Array, final: boolean) => Promise<string>;

export interface ParakeetOptions {
  /** Whether a live caption is wanted now (Navi awake or dictating): asleep, only finished phrases matter. */
  live: () => boolean;
  /** Tests: stands in for the model. */
  fake?: FakeModel;
}

export async function createParakeetEngine(lang: string, callbacks: SpeechCallbacks, options: ParakeetOptions): Promise<ParakeetEngine> {
  const { fake } = options;
  const model = parakeetModelFor(lang);
  if (!model) throw new Error(`Parakeet doesn't recognize ${lang}`);
  const gpu = await hasWebGpu();
  const vendor = chrome.runtime.getURL("vendor/");
  let worker: Worker | null = null;
  let vad: Vad | null = null;
  let loading: Promise<void> | null = null;
  let detail = "";

  // One transcription at a time: the worker's model isn't safe to run twice at once.
  let nextId = 0;
  let queue: Promise<unknown> = Promise.resolve();
  let busy = false;
  const waiting = new Map<number, (r: AsrReply) => void>();
  const transcribe = (pcm: Float32Array, final: boolean): Promise<string> => {
    if (fake) return fake(pcm, final);
    const run = queue.then(
      () =>
        new Promise<string>((resolve, reject) => {
          if (!worker) return reject(new Error("Parakeet isn't loaded."));
          const id = ++nextId;
          busy = true;
          waiting.set(id, (r) => {
            busy = false;
            if (r.type === "text") resolve(r.text);
            else reject(new Error(r.type === "error" ? r.message : "No transcript."));
          });
          worker.postMessage({ type: "transcribe", id, pcm } satisfies AsrRequest, [pcm.buffer]);
        }),
    );
    queue = run.catch(() => undefined);
    return run;
  };

  // The mic, and what it has heard.
  let stream: MediaStream | null = null;
  let ctx: AudioContext | null = null;
  let wanted = false;
  let liveTimer: number | undefined;
  let lastLive = 0;
  const byLoudness = loudness();
  const phrases = new PhraseDetector(
    (frame) => (vad ? vad.run(frame) : byLoudness(frame)),
    (pcm) => void finish(pcm),
    { maxSeconds: MAX_PHRASE_S },
  );
  let slow = 0;

  async function finish(pcm: Float32Array) {
    callbacks.onInterim("");
    if (pcm.length < RATE * MIN_PHRASE_S) return;
    try {
      const started = performance.now();
      const text = (await transcribe(pcm, true)).trim();
      const seconds = (performance.now() - started) / 1000;
      slow = seconds > (pcm.length / RATE) * TOO_SLOW.ratio ? slow + 1 : 0;
      if (slow >= TOO_SLOW.times && !fake) {
        engine.stop();
        callbacks.onError("Parakeet is too slow on this computer", true);
        return;
      }
      if (text && wanted) callbacks.onFinal(text, 0);
    } catch (err) {
      callbacks.onError(`Parakeet: ${err instanceof Error ? err.message : String(err)}`, false);
    }
  }

  /** While a phrase is being said: show what Parakeet makes of it so far. */
  async function live() {
    if (!phrases.speaking || busy || !options.live()) return;
    if (phrases.samples < RATE * 0.5 || phrases.samples > RATE * LIVE_MAX_S || Date.now() - lastLive < LIVE_EVERY_MS) return;
    lastLive = Date.now();
    const phrase = phrases.phraseId;
    const text = await transcribe(phrases.audio(), false).catch(() => "");
    if (text.trim() && phrases.speaking && phrase === phrases.phraseId) callbacks.onInterim(text.trim());
  }

  const engine: ParakeetEngine = {
    downloadGb: gpu ? 2.5 : 0.7,
    get label() {
      return `Parakeet (on-device${detail ? `, ${detail}` : ""})`;
    },
    get running() {
      return wanted;
    },

    load(onProgress) {
      loading ??= (async () => {
        if (fake) {
          vad = await loadVad(vendor);
          detail = "test model";
          return;
        }
        const w = new Worker(chrome.runtime.getURL("lab/asr-worker.js"), { type: "module" });
        worker = w;
        const ready = new Promise<void>((resolve, reject) => {
          w.onmessage = ({ data }: MessageEvent<AsrReply>) => {
            if (data.type === "progress") onProgress(data.loaded, data.total);
            else if (data.type === "ready") {
              // e.g. "graphics chip, encoder fp32"
              detail = data.detail.split(",")[0];
              resolve();
            } else if (data.type === "error" && data.id === undefined) reject(new Error(data.message));
            else if (data.type === "text" || data.type === "error") {
              waiting.get(data.id!)?.(data);
              waiting.delete(data.id!);
            }
          };
          w.onerror = (e) => {
            const message = e.message || "Parakeet's worker stopped (out of memory?)";
            reject(new Error(message));
            // Nothing in flight waits forever.
            for (const done of waiting.values()) done({ type: "error", message });
            waiting.clear();
          };
        });
        w.postMessage({ type: "load", engine: "parakeet", model, device: gpu ? "webgpu" : "wasm", vendor, threads: THREADS } satisfies AsrRequest);
        // The speech detector is small; if it fails, phrases are split by loudness instead.
        const detector = loadVad(vendor).then(
          (v) => (vad = v),
          () => callbacks.onInfo?.("Parakeet's speech detector didn't load, so phrases are split by loudness."),
        );
        await Promise.all([ready, detector]);
      })();
      loading.catch(() => {
        worker?.terminate();
        worker = null;
        loading = null;
      });
      return loading;
    },

    async start() {
      wanted = true;
      try {
        await engine.load(() => undefined);
        // Echo cancellation keeps Navi's own voice out; noise suppression stays off (it smears quiet
        // speech, and Parakeet is trained on raw audio).
        const mic = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: true, channelCount: 1 },
        });
        stream = mic;
        const audio = new AudioContext({ sampleRate: RATE });
        ctx = audio;
        await audio.audioWorklet.addModule(chrome.runtime.getURL("pcm-worklet.js"));
        // Stopped meanwhile.
        if (!wanted || ctx !== audio) return void mic.getTracks().forEach((t) => t.stop());
        const node = new AudioWorkletNode(audio, "pcm-chunker");
        node.port.onmessage = ({ data }: MessageEvent<Float32Array>) => phrases.push(data);
        audio.createMediaStreamSource(mic).connect(node);
        await audio.resume().catch(() => undefined);
        // The mic disappeared (unplugged, or taken by another app).
        mic.getAudioTracks()[0]?.addEventListener("ended", () => {
          if (wanted) callbacks.onError("Can't hear the microphone. Check it's connected, then turn the mic off and on.", false);
        });
      } catch (err) {
        engine.stop();
        const blocked = err instanceof DOMException && err.name === "NotAllowedError";
        callbacks.onError(
          blocked ? "Microphone access is blocked. Open Navi setup to allow it." : `Parakeet: ${err instanceof Error ? err.message : String(err)}`,
          true,
        );
        return;
      }
      liveTimer = window.setInterval(() => void live(), 250);
      callbacks.onInfo?.(`Speech: ${engine.label}`);
      callbacks.onRunningChange(true);
    },

    stop() {
      const was = wanted;
      wanted = false;
      window.clearInterval(liveTimer);
      stream?.getTracks().forEach((t) => t.stop());
      void ctx?.close();
      stream = null;
      ctx = null;
      void phrases.flush().then(() => vad?.reset());
      callbacks.onInterim("");
      if (was) callbacks.onRunningChange(false);
    },

    dispose() {
      engine.stop();
      worker?.terminate();
      worker = null;
      loading = null;
    },
  };
  return engine;
}
