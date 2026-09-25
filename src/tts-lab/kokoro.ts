// Kokoro, a small neural voice model run by transformers.js. Only the voice lab's Kokoro worker
// (kokoro-worker.ts) imports this, so these libraries (several MB) never load anywhere else.

import { KokoroTTS, TextSplitterStream, env } from "kokoro-js";

const MODEL = "onnx-community/Kokoro-82M-v1.0-ONNX";

export type KokoroDevice = "webgpu" | "wasm";

/** Full precision on the GPU; 8-bit weights (about a quarter of the download) on the CPU. */
const dtypeFor = (device: KokoroDevice) => (device === "webgpu" ? "fp32" : "q8");

export interface KokoroProgress {
  status: string;
  file?: string;
  loaded?: number;
  total?: number;
}

/** `wasmPaths`: where the extension keeps ONNX Runtime's WebAssembly (extensions can't load it from a CDN). */
export function loadKokoro(
  device: KokoroDevice,
  wasmPaths: string,
  onProgress: (p: KokoroProgress) => void,
): Promise<KokoroTTS> {
  env.wasmPaths = wasmPaths;
  return KokoroTTS.from_pretrained(MODEL, {
    device,
    dtype: dtypeFor(device),
    progress_callback: (p) => onProgress(p as KokoroProgress),
  });
}

/** True when the model file for `device` is already in transformers.js's download cache. */
export async function isCached(device: KokoroDevice): Promise<boolean> {
  const file = `${MODEL}/resolve/main/onnx/model${dtypeFor(device) === "q8" ? "_quantized" : ""}.onnx`;
  try {
    const cache = await caches.open("transformers-cache");
    return (await cache.keys()).some((request) => request.url.endsWith(file));
  } catch {
    return false;
  }
}

/** Speaks `text` sentence by sentence, calling `onAudio` as each one is ready. */
export async function speakKokoro(
  tts: KokoroTTS,
  text: string,
  voice: string,
  onAudio: (samples: Float32Array, sampleRate: number) => void,
  signal: AbortSignal,
): Promise<void> {
  // kokoro-js leaves a plain string's splitter open, so the last sentence would never be spoken.
  const splitter = new TextSplitterStream();
  splitter.push(text);
  splitter.close();
  for await (const { audio } of tts.stream(splitter, { voice: voice as "af_heart" })) {
    if (signal.aborted) return;
    onAudio(audio.audio, audio.sampling_rate);
  }
}
