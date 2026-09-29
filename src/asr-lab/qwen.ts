// Qwen3-ASR in the recognizer tester, on the graphics chip (WebGPU), through the browser engine from
// github.com/ainoya/qwen-asr (vendored in third_party/qwen-asr). The engine runs on this page's thread
// with its own WebAssembly threads, so the page must be cross-origin isolated (see manifest.json).
// Model files are downloaded once into the browser's private storage by lab/qwen-files.js.

import {
  IntervalDispatcher,
  buildIntervalDispatchTable,
  extractModelDescriptorsFromHeader,
  parseSafetensorsHeaderStream,
  prepareWasmReducedImage,
  setupGpuHooks,
  streamChunksToTargets,
} from "../../third_party/qwen-asr/loader.js";
import { freshHeap } from "../../third_party/qwen-asr/heap.js";
import { until } from "../../third_party/qwen-asr/tick.js";
import { WebGPUDecoder } from "../../third_party/qwen-asr/webgpu-decoder.js";
import { WebGPUEncoder } from "../../third_party/qwen-asr/webgpu-encoder.js";
import type { QwenFilesReply, QwenFilesRequest } from "./qwen-files";

// The engine's Emscripten module (untyped).
type Engine = any;

export interface QwenModel {
  detail: string;
  transcribe(pcm: Float32Array): Promise<string>;
}

const P = (ptr: number) => ptr >>> 0;

let engineScript: Promise<(o: object) => Promise<Engine>> | null = null;

/** The Emscripten glue must run as a classic script: its threads are started from the script's own URL. */
function loadEngineScript() {
  engineScript ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = chrome.runtime.getURL("vendor/qwen-asr/qwen_asr.js");
    s.onload = () => resolve((window as unknown as { createQwenASR: (o: object) => Promise<Engine> }).createQwenASR);
    s.onerror = () => {
      engineScript = null;
      reject(new Error("the Qwen engine didn't load"));
    };
    document.head.append(s);
  });
  return engineScript;
}

/** Makes sure the model files are in the browser's storage, downloading (and packing) them if not. */
function prepareFiles(req: QwenFilesRequest, onStatus: (s: string) => void): Promise<void> {
  const worker = new Worker(chrome.runtime.getURL("lab/qwen-files.js"), { type: "module" });
  const gb = (n: number) => (n / 1e9).toFixed(2);
  return new Promise<void>((resolve, reject) => {
    worker.onmessage = ({ data }: MessageEvent<QwenFilesReply>) => {
      if (data.type === "progress") {
        const verb = req.packed ? "Downloading" : "Downloading and packing";
        onStatus(data.total ? `${verb} ${gb(data.loaded)} of ${gb(data.total)} GB` : `${verb}…`);
      } else if (data.type === "done") {
        resolve();
      } else {
        reject(new Error(data.message));
      }
    };
    worker.onerror = (e) => reject(new Error(e.message || "the download stopped"));
    worker.postMessage(req);
  }).finally(() => worker.terminate());
}

async function modelDir(dir: string) {
  const root = await navigator.storage.getDirectory();
  return (await root.getDirectoryHandle("qwen-asr")).getDirectoryHandle(dir);
}

export async function loadQwen(req: QwenFilesRequest, onStatus: (s: string) => void): Promise<QwenModel> {
  if (!crossOriginIsolated) throw new Error("this page can't run it (not cross-origin isolated); reload the extension");
  const adapter = await navigator.gpu?.requestAdapter({ powerPreference: "high-performance" });
  if (!adapter) throw new Error("it needs a graphics chip Chrome can use (WebGPU)");

  await prepareFiles(req, onStatus);
  onStatus("Starting the engine…");
  const create = await loadEngineScript();
  const threads = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 2));
  const M: Engine = await create({ pthreadPoolSize: threads });
  const cstr = (s: string) => {
    const n = M.lengthBytesUTF8(s) + 1;
    const p = P(M._qwen_wasm_alloc(n));
    M.stringToUTF8(s, p, n);
    return p;
  };

  const dir = await modelDir(req.dir);
  M.FS.mkdirTree("/model");
  for (const name of ["vocab.json", "merges.txt"]) {
    const file = await (await dir.getFileHandle(name)).getFile();
    M.FS.writeFile(`/model/${name}`, new Uint8Array(await file.arrayBuffer()));
  }

  // The same GPU setup as the engine's demo.
  const lim = adapter.limits;
  const binding = Math.min(lim.maxStorageBufferBindingSize, 1 << 30);
  const device = await adapter.requestDevice({
    requiredFeatures: (["subgroups", "shader-f16", "timestamp-query"] as GPUFeatureName[]).filter((f) => adapter.features.has(f)),
    requiredLimits: {
      maxBufferSize: binding,
      maxStorageBufferBindingSize: binding,
      maxComputeWorkgroupStorageSize: Math.min(lim.maxComputeWorkgroupStorageSize, 32768),
    },
  });

  const model = await (await dir.getFileHandle("model.bin")).getFile();
  const reader = model.stream().getReader();
  const { header, dataBase, leftover } = await parseSafetensorsHeaderStream(reader);
  const reduced = prepareWasmReducedImage(header, M);
  const { decEntries, encEntries } = extractModelDescriptorsFromHeader(header, dataBase);
  const shardBudget = Math.min(256 << 20, device.limits.maxStorageBufferBindingSize);
  const gpu = new WebGPUDecoder(M, { device, adapter });
  gpu.allocateStorageBuffers({ device, adapter, header, entries: decEntries, shardBudget });
  const encoder = new WebGPUEncoder(M, { device, adapter });
  encoder.allocateStorageBuffers({ device, adapter, header, entries: encEntries, shardBudget });
  const dispatcher = new IntervalDispatcher(buildIntervalDispatchTable(header, dataBase, gpu, encoder, reduced.wasmNormMap), device, M);
  await streamChunksToTargets({
    reader,
    dispatcher,
    initialFileOffset: dataBase,
    totalBytes: model.size,
    device,
    excessChunk: leftover,
    reportProgress: (cur, total) => onStatus(`Loading onto the graphics chip: ${Math.round((cur / total) * 100)}%`),
  });

  M._qwen_wasm_set_gpu_resident(1);
  const dirPtr = cstr("/model");
  const rc = M._qwen_wasm_init(reduced.reducedPtr, reduced.reducedLen, dirPtr, threads, 0);
  M._qwen_wasm_release(dirPtr);
  if (rc !== 0) throw new Error("the engine couldn't start with this model");
  onStatus("Preparing the graphics chip…");
  await gpu.finishInit(() => {});
  await encoder.finishInit();
  setupGpuHooks(gpu, encoder, M);
  const lang = cstr("English");
  M._qwen_wasm_set_language(lang);
  M._qwen_wasm_release(lang);
  M._qwen_wasm_set_gpu_encoder(1);
  M._qwen_wasm_set_gpu_decoder(1);

  /** One phrase: mel on a CPU thread, audio encoder and text decoder on the GPU (the demo's batch path). */
  async function once(samples: Float32Array): Promise<string> {
    const ptr = P(M._qwen_wasm_alloc(samples.length * 4));
    if (!ptr) throw new Error("out of memory for the audio");
    try {
      freshHeap(M).HEAPF32.set(samples, ptr / 4);
      if (M._qwen_wasm_mel_start(ptr, samples.length) !== 0) throw new Error("couldn't start");
      await until(() => M._qwen_wasm_mel_done());
      const frames = M._qwen_wasm_mel_finish();
      if (!frames) throw new Error("couldn't read the audio");
      const enc: Float32Array = await encoder.runFromMel(P(M._qwen_wasm_mel_ptr()), frames);
      const ep = P(M._qwen_wasm_alloc(enc.byteLength));
      if (!ep) throw new Error("out of memory for the audio encoding");
      freshHeap(M).HEAPF32.set(enc, ep / 4);
      const started = M._qwen_wasm_embeds_from_enc_start(ep, encoder.tokens);
      M._qwen_wasm_release(ep);
      if (started !== 0) throw new Error("couldn't build the prompt");
      await until(() => M._qwen_wasm_embeds_from_enc_done());
      const seq = M._qwen_wasm_embeds_from_enc_finish();
      if (!seq) throw new Error("couldn't build the prompt");
      const r = await gpu.prefillAndGenerate(P(M._qwen_wasm_embeds_ptr()), seq, 256, null);
      return String(r.text ?? "");
    } finally {
      M._qwen_wasm_release(ptr);
    }
  }

  let queue: Promise<unknown> = Promise.resolve();
  return {
    detail: "graphics chip, 8-bit",
    transcribe(pcm) {
      const run = queue.then(() => once(pcm));
      queue = run.catch(() => undefined);
      return run;
    },
  };
}
