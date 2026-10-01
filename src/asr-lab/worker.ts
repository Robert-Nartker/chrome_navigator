// Runs one speech recognition model off the page's thread, for the recognizer tester (asr-lab.html) and
// Navi's Parakeet listener: Whisper through transformers.js, Parakeet through parakeet.js. One worker per
// model, so switching models never mixes runtimes, and closing a model frees its memory.

export type AsrEngine = "whisper" | "parakeet";

export type AsrRequest =
  /** `threads`: processor threads for the model (default: ONNX Runtime's own choice). */
  | { type: "load"; engine: AsrEngine; model: string; device: "webgpu" | "wasm"; vendor: string; threads?: number }
  | { type: "transcribe"; id: number; pcm: Float32Array };

export type AsrReply =
  | { type: "progress"; loaded: number; total: number }
  | { type: "ready"; ms: number; detail: string }
  | { type: "text"; id: number; text: string; ms: number }
  | { type: "error"; id?: number; message: string };

const post = (reply: AsrReply) => (self as unknown as { postMessage(m: unknown): void }).postMessage(reply);

let transcribe: ((pcm: Float32Array) => Promise<string>) | null = null;

/** Adds up download progress across files. */
function progress() {
  const files = new Map<string, { loaded: number; total: number }>();
  return (file: string, loaded: number, total: number) => {
    files.set(file, { loaded, total: Math.max(total, loaded) });
    let l = 0;
    let t = 0;
    for (const f of files.values()) {
      l += f.loaded;
      t += f.total;
    }
    post({ type: "progress", loaded: l, total: t });
  };
}

async function loadWhisper(model: string, device: "webgpu" | "wasm", vendor: string): Promise<string> {
  const { pipeline, env } = await import("@huggingface/transformers");
  env.allowLocalModels = false;
  if (env.backends.onnx.wasm) env.backends.onnx.wasm.wasmPaths = `${vendor}transformers/`;
  const update = progress();
  const onProgress = (p: { status: string; file?: string; loaded?: number; total?: number }) => {
    if (p.status === "progress" && p.file) update(p.file, p.loaded ?? 0, p.total ?? 0);
  };
  // Full precision on the GPU (a 4-bit decoder costs small Whisper models real accuracy); 8-bit on the CPU.
  const tries: unknown[] = device === "webgpu" ? ["fp32"] : ["q8", "fp32"];
  let lastError: unknown;
  for (const dtype of tries) {
    try {
      const asr = await pipeline("automatic-speech-recognition", model, {
        device,
        dtype: dtype as "fp32",
        progress_callback: onProgress as never,
      });
      transcribe = async (pcm) => {
        const out = (await asr(pcm)) as { text: string } | { text: string }[];
        return (Array.isArray(out) ? out[0]?.text : out.text) ?? "";
      };
      return `${device === "webgpu" ? "graphics chip" : "processor"}, ${dtype}`;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

async function loadParakeet(model: string, device: "webgpu" | "wasm", vendor: string, threads?: number): Promise<string> {
  const ort = await import("onnxruntime-web");
  ort.env.wasm.wasmPaths = `${vendor}ort-1.24/`;
  if (threads) ort.env.wasm.numThreads = threads;
  const { fromHub } = await import("parakeet.js");
  const update = progress();
  const onProgress = (p: { file?: string; loaded?: number; total?: number }) => update(p.file ?? "model", p.loaded ?? 0, p.total ?? 0);
  // Full-precision encoder on the GPU, as parakeet.js recommends (its half-precision export can drop
  // words); 8-bit on the CPU, also if the graphics chip can't run it.
  const tries: [string, string][] = device === "webgpu" ? [["webgpu", "fp32"], ["wasm", "int8"]] : [["wasm", "int8"]];
  let lastError: unknown;
  for (const [backend, encoderQuant] of tries) {
    try {
      const m = await fromHub(model, { backend, encoderQuant, decoderQuant: "int8", progress: onProgress } as never);
      transcribe = async (pcm) => {
        const r = (await m.transcribe(pcm, 16000)) as { utterance_text?: string; text?: string };
        return r.utterance_text ?? r.text ?? "";
      };
      return `${backend === "webgpu" ? "graphics chip" : "processor"}, encoder ${encoderQuant}`;
    } catch (err) {
      lastError = err;
      // Offline: the other build won't download either.
      if (/fetch|network/i.test(String(err))) break;
    }
  }
  throw lastError;
}

self.onmessage = async ({ data }: MessageEvent<AsrRequest>) => {
  if (data.type === "load") {
    const start = performance.now();
    try {
      const detail =
        data.engine === "whisper"
          ? await loadWhisper(data.model, data.device, data.vendor)
          : await loadParakeet(data.model, data.device, data.vendor, data.threads);
      post({ type: "ready", ms: performance.now() - start, detail });
    } catch (err) {
      post({ type: "error", message: err instanceof Error ? err.message : String(err) });
    }
    return;
  }
  if (!transcribe) return post({ type: "error", id: data.id, message: "The model isn't loaded." });
  const start = performance.now();
  try {
    const text = await transcribe(data.pcm);
    post({ type: "text", id: data.id, text: text.trim(), ms: performance.now() - start });
  } catch (err) {
    post({ type: "error", id: data.id, message: err instanceof Error ? err.message : String(err) });
  }
};
