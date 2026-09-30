// Runs Kokoro in a worker, so the voice lab stays responsive (and screen readers keep working)
// while the model loads and speaks. Built as its own module (lab/kokoro-worker.js).

import { type KokoroDevice, type KokoroProgress, isCached, loadKokoro, speakKokoro, warmUpKokoro } from "./kokoro";

export type KokoroRequest =
  /** `warmUp`: a voice to say a word in, unheard, once loaded. */
  | { type: "load"; device: KokoroDevice; wasmPaths: string; warmUp?: string }
  | { type: "speak"; id: number; text: string; voice: string; speed?: number }
  | { type: "stop" };

export type KokoroReply =
  | ({ type: "progress" } & KokoroProgress)
  | { type: "loaded"; cached: boolean }
  | { type: "audio"; id: number; samples: Float32Array; sampleRate: number }
  | { type: "done"; id: number }
  | { type: "error"; id?: number; message: string };

const post = (reply: KokoroReply) => (self as unknown as { postMessage(m: unknown): void }).postMessage(reply);

let tts: ReturnType<typeof loadKokoro> | null = null;
let speaking: AbortController | null = null;

self.onmessage = async ({ data }: MessageEvent<KokoroRequest>) => {
  if (data.type === "stop") {
    speaking?.abort();
    return;
  }
  const id = data.type === "speak" ? data.id : undefined;
  try {
    if (data.type === "load") {
      const cached = await isCached(data.device);
      tts ??= loadKokoro(data.device, data.wasmPaths, (p) => post({ type: "progress", ...p }));
      const model = await tts;
      if (data.warmUp) await warmUpKokoro(model, data.warmUp).catch(() => undefined);
      post({ type: "loaded", cached });
    } else {
      if (!tts) throw new Error("Kokoro isn't loaded.");
      const model = await tts;
      speaking?.abort();
      const current = new AbortController();
      speaking = current;
      await speakKokoro(
        model,
        data.text,
        data.voice,
        (samples, sampleRate) => post({ type: "audio", id: data.id, samples, sampleRate }),
        current.signal,
        data.speed,
      );
      post({ type: "done", id: data.id });
    }
  } catch (err) {
    if (data.type === "load") tts = null;
    post({ type: "error", id, message: err instanceof Error ? err.message : String(err) });
  }
};
