// Silero VAD (github.com/snakers4/silero-vad, MIT; third_party/silero-vad): a 2 MB neural speech
// detector. Unlike a loudness check it tells speech from steady noise like a fan, so a phrase can end
// about a third of a second after you stop talking.

import type { Tensor } from "onnxruntime-web";

/** Samples per frame at 16 kHz (32 ms). */
export const VAD_FRAME = 512;
/** The model also sees the end of the previous frame, as the reference implementation feeds it. */
const CONTEXT = 64;

export interface Vad {
  /** Speech probability (0-1) of the next frame of VAD_FRAME samples. */
  run(frame: Float32Array): Promise<number>;
  /** Forgets the audio so far (before a new stream). */
  reset(): void;
}

/** `vendor`: the extension's vendor/ folder URL (ONNX Runtime's WebAssembly and the model). */
export async function loadVad(vendor: string): Promise<Vad> {
  const ort = await import("onnxruntime-web");
  ort.env.wasm.wasmPaths = `${vendor}ort-1.24/`;
  ort.env.wasm.numThreads = 1;
  const session = await ort.InferenceSession.create(`${vendor}silero-vad/silero_vad.onnx`, { executionProviders: ["wasm"] });
  const sr = new ort.Tensor("int64", BigInt64Array.from([16000n]), []);
  let state: Tensor;
  let context: Float32Array;
  const reset = () => {
    state = new ort.Tensor("float32", new Float32Array(2 * 128), [2, 1, 128]);
    context = new Float32Array(CONTEXT);
  };
  reset();
  return {
    reset,
    async run(frame) {
      const input = new Float32Array(CONTEXT + frame.length);
      input.set(context);
      input.set(frame, CONTEXT);
      const out = await session.run({ input: new ort.Tensor("float32", input, [1, input.length]), state, sr });
      state = out.stateN;
      context = frame.slice(-CONTEXT);
      return (out.output.data as Float32Array)[0];
    },
  };
}
