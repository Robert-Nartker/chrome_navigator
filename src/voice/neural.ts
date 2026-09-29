// Navi's on-device voice: Kokoro, on the graphics chip (WebGPU) when there is one, otherwise on the CPU. It
// uses the voice lab's engine, and is built as its own ES module (voice/neural.js) that Navi's background
// page imports the first time it speaks, so the speech libraries (several MB) never load anywhere else.

import { ChunkPlayer } from "../tts-lab/audio";
import { type Download, KOKORO_VOICES, kokoroEngine } from "../tts-lab/engines";

/** Whether this computer has a graphics chip Chrome can compute on (WebGPU). */
export async function hasWebGpu(): Promise<boolean> {
  try {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    return !!gpu && !!(await gpu.requestAdapter());
  } catch {
    return false;
  }
}

export interface NeuralSpeech {
  text: string;
  /** A Kokoro voice, e.g. "af_heart". */
  voice: string;
  volume: number;
  signal: AbortSignal;
}

export interface NeuralVoice {
  /** Roughly what it downloads once. */
  readonly downloadMb: number;
  /** Downloads (the first time) and loads the model. */
  load(onProgress: (d: Download) => void): Promise<void>;
  /** Speaks and resolves once playback has finished; false if no audio came out. */
  speak(o: NeuralSpeech): Promise<boolean>;
  /** Unloads the model (its worker and memory). */
  dispose(): void;
}

/** `gpu`: run Kokoro on the graphics chip at full precision; otherwise on the CPU with 8-bit weights. */
export function createNeuralVoice(gpu: boolean): NeuralVoice {
  const kokoro = kokoroEngine();
  kokoro.device = gpu ? "webgpu" : "wasm";
  const player = new ChunkPlayer(1);
  let loading: Promise<void> | null = null;

  return {
    downloadMb: gpu ? 326 : 92,
    load(onProgress) {
      loading ??= kokoro.prepare(onProgress).then(() => undefined);
      loading.catch(() => (loading = null));
      return loading;
    },
    async speak(o) {
      await loading;
      const voice = KOKORO_VOICES.find((v) => v.id === o.voice) ?? KOKORO_VOICES[0];
      player.setVolume(o.volume);
      await Promise.race([
        player.resume(),
        new Promise((_, reject) => setTimeout(() => reject(new Error("Chrome blocked audio playback.")), 1000)),
      ]);
      const onAbort = () => player.stop();
      o.signal.addEventListener("abort", onAbort);
      try {
        const stats = await kokoro.speak(voice, { text: o.text, player, volume: o.volume, signal: o.signal });
        return stats.firstAudioMs !== null;
      } finally {
        o.signal.removeEventListener("abort", onAbort);
      }
    },
    dispose() {
      player.stop();
      kokoro.dispose();
    },
  };
}
