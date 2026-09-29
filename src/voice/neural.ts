// Navi's on-device voice: Kokoro on the graphics chip (WebGPU), or Kyutai's Pocket TTS on the CPU, using
// the voice lab's engines. Built as its own ES module (voice/neural.js) that Navi's background page imports
// the first time it speaks, so the speech libraries (several MB) never load anywhere else.

import { ChunkPlayer } from "../tts-lab/audio";
import { type Download, KOKORO_VOICES, type LabVoice, kokoroEngine, pocketEngine } from "../tts-lab/engines";

export type NeuralEngineId = "kokoro" | "pocket";

/** Whether this computer has a graphics chip Chrome can compute on (WebGPU). */
export async function hasWebGpu(): Promise<boolean> {
  try {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    return !!gpu && !!(await gpu.requestAdapter());
  } catch {
    return false;
  }
}

/** Kokoro needs a graphics chip to keep up with speech; without one, Pocket TTS is the faster voice. */
export const pickEngine = (gpu: boolean): NeuralEngineId => (gpu ? "kokoro" : "pocket");

export interface NeuralSpeech {
  text: string;
  /** A Kokoro voice ("af_heart"); Pocket TTS uses its own first voice. */
  voice: string;
  volume: number;
  signal: AbortSignal;
}

export interface NeuralVoice {
  readonly engine: NeuralEngineId;
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
export function createNeuralVoice(engine: NeuralEngineId, gpu: boolean): NeuralVoice {
  const kokoro = engine === "kokoro" ? kokoroEngine() : null;
  if (kokoro) kokoro.device = gpu ? "webgpu" : "wasm";
  const pocket = engine === "pocket" ? pocketEngine() : null;
  const player = new ChunkPlayer(1);
  let loading: Promise<void> | null = null;

  const voiceFor = (id: string): LabVoice | undefined =>
    kokoro ? (KOKORO_VOICES.find((v) => v.id === id) ?? KOKORO_VOICES[0]) : pocket!.voices()[0];

  return {
    engine,
    downloadMb: kokoro ? (gpu ? 326 : 92) : 125,
    load(onProgress) {
      loading ??= (async () => {
        if (kokoro) await kokoro.prepare(onProgress);
        else await pocket!.prepare(onProgress);
        // Pocket TTS lists its voices once loaded; fetch the one Navi speaks with.
        if (pocket) await pocket.prepare(onProgress, voiceFor(""));
      })();
      loading.catch(() => (loading = null));
      return loading;
    },
    async speak(o) {
      await loading;
      const voice = voiceFor(o.voice);
      if (!voice) throw new Error("Navi's voice isn't loaded.");
      player.setVolume(o.volume);
      await Promise.race([
        player.resume(),
        new Promise((_, reject) => setTimeout(() => reject(new Error("Chrome blocked audio playback.")), 1000)),
      ]);
      const onAbort = () => player.stop();
      o.signal.addEventListener("abort", onAbort);
      try {
        const stats = await (kokoro ?? pocket!).speak(voice, { text: o.text, player, volume: o.volume, signal: o.signal });
        return stats.firstAudioMs !== null;
      } finally {
        o.signal.removeEventListener("abort", onAbort);
      }
    },
    dispose() {
      player.stop();
      (kokoro ?? pocket!).dispose();
    },
  };
}
