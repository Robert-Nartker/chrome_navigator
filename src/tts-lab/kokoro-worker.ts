// Runs Kokoro in a worker, so the voice lab stays responsive (and screen readers keep working)
// while the model loads and speaks. Built as its own module (lab/kokoro-worker.js).

import { type KokoroDevice, type KokoroProgress, isCached, loadKokoro, speakKokoro } from "./kokoro";

export type KokoroRequest =
  | { type: "load"; device: KokoroDevice; wasmPaths: string }
  | { type: "speak"; id: number; text: string; voice: string }
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
      await tts;
      post({ type: "loaded", cached });
    } else {
      if (!tts) throw new Error("Kokoro isn't loaded.");
      const model = await tts;
      speaking?.abort();
      const current = new AbortController();
      speaking = current;
      await speakKokoro(model, data.text, data.voice, (samples, sampleRate) => post({ type: "audio", id: data.id, samples, sampleRate }), current.signal);
      post({ type: "done", id: data.id });
    }
  } catch (err) {
    if (data.type === "load") tts = null;
    post({ type: "error", id, message: err instanceof Error ? err.message : String(err) });
  }
};
