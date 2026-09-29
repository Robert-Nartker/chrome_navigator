# Qwen3-ASR browser engine

The speech recognizer tester (`src/asr-lab/qwen.ts`) runs Qwen3-ASR with this engine: WebAssembly with
threads for the audio front end and prompt assembly, and WebGPU for the audio encoder and text decoder.

Source: https://github.com/ainoya/qwen-asr, commit `5f80f45` (MIT, see LICENSE).

| file | what it is |
|---|---|
| `qwen_asr.js`, `qwen_asr.wasm` | Built from that commit with `source emsdk_env.sh && ./wasm/build.sh` (Emscripten 6.0.10). Copied into the extension as `vendor/qwen-asr/`. |
| `webgpu-decoder.js`, `webgpu-encoder.js`, `heap.js`, `tick.js` | `wasm/demo/` files, unchanged. |
| `loader.js` | The model-loading functions from `wasm/demo/app.js`, copied out of that UI script unchanged apart from its logging. |
| `*.d.ts` | Types for the above, written for this project. |

The 8-bit model file the engine loads is published for the 1.7B model only. `src/asr-lab/qwen-pack.ts`
makes it for the 0.6B from the official weights, matching the engine's own `--pack-q8` byte for byte
(see `tests/fixtures/qwen-pack/`).
