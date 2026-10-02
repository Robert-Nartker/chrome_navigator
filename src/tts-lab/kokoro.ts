// Kokoro, a small neural voice model run by transformers.js. Only the voice lab's Kokoro worker
// (kokoro-worker.ts) imports this, so these libraries (several MB) never load anywhere else.

import { KokoroTTS, TextSplitterStream, env } from "kokoro-js";
import { splitFirstClause } from "./audio";

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

/** Where kokoro-js downloads a voice from, and the cache it keeps it in. */
const voiceUrl = (voice: string) => `https://huggingface.co/${MODEL}/resolve/main/voices/${voice}.bin`;
const VOICE_CACHE = "kokoro-voices";
/** A voice is a table of 256-number style vectors, as 32-bit floats. */
const isVoiceFile = (bytes: number) => bytes > 0 && bytes % (256 * 4) === 0;
const goodVoices = new Set<string>();

/**
 * kokoro-js downloads a voice the first time it's used and caches whatever comes back, even an error
 * page; that copy then fails every time ("byte length of Float32Array should be a multiple of 4"). So
 * Navi downloads and checks the voice itself first, replacing a bad cached copy.
 */
export async function ensureVoice(voice: string): Promise<void> {
  if (goodVoices.has(voice)) return;
  const url = voiceUrl(voice);
  const cache = await caches.open(VOICE_CACHE).catch(() => undefined);
  const cached = await cache?.match(url);
  if (cached && isVoiceFile((await cached.arrayBuffer()).byteLength)) {
    goodVoices.add(voice);
    return;
  }
  if (cached) await cache?.delete(url);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Couldn't download the voice (error ${res.status})`);
  const data = await res.arrayBuffer();
  if (!isVoiceFile(data.byteLength)) throw new Error("The voice download was incomplete");
  await cache?.put(url, new Response(data, { headers: { "content-type": "application/octet-stream" } }));
  goodVoices.add(voice);
}

/**
 * Speaks `text` sentence by sentence, calling `onAudio` as each one is ready. A long first sentence
 * starts with its opening clause, so the first sound comes sooner. `speed`: 1 is Kokoro's own pace.
 */
export async function speakKokoro(
  tts: KokoroTTS,
  text: string,
  voice: string,
  onAudio: (samples: Float32Array, sampleRate: number) => void,
  signal: AbortSignal,
  speed = 1,
): Promise<void> {
  await ensureVoice(voice);
  const options = { voice: voice as "af_heart", speed };
  const [head, rest] = splitFirstClause(text);
  if (head) {
    const audio = await tts.generate(head, options);
    if (signal.aborted) return;
    onAudio(audio.audio, audio.sampling_rate);
  }
  if (!rest) return;
  // kokoro-js leaves a plain string's splitter open, so the last sentence would never be spoken.
  const splitter = new TextSplitterStream();
  splitter.push(rest);
  splitter.close();
  for await (const { audio } of tts.stream(splitter, options)) {
    if (signal.aborted) return;
    onAudio(audio.audio, audio.sampling_rate);
  }
}

/**
 * Makes a moment of speech and throws it away, so the first real reply doesn't also pay for compiling
 * the graphics chip's programs and fetching the voice.
 */
export async function warmUpKokoro(tts: KokoroTTS, voice: string): Promise<void> {
  await ensureVoice(voice);
  await tts.generate("Ready.", { voice: voice as "af_heart" });
}
