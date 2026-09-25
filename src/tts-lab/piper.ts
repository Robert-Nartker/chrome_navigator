// Piper voices (piper-tts-web). The voice lab imports this module dynamically, so it becomes a
// separate chunk loaded on first use.

import { type Progress, TtsSession } from "@mintplex-labs/piper-tts-web";
import * as ort from "onnxruntime-web/wasm";

export type { TtsSession };

// Piper asks this ONNX Runtime (the same instance it imports) for one thread per CPU core. Extension pages
// aren't cross-origin isolated, but Chrome still gives them SharedArrayBuffer, which is all this version
// checks, so it would load its multi-threaded build. Keep it single-threaded like the other engines here
// (only that build is copied into the extension).
Object.defineProperty(ort.env.wasm, "numThreads", { get: () => 1, set: () => {}, configurable: true });

/** Local copies of the runtime files the library would otherwise load from CDNs. */
function wasmPaths() {
  return {
    onnxWasm: chrome.runtime.getURL("vendor/ort-1.18.0/"),
    piperData: chrome.runtime.getURL("vendor/piper/piper_phonemize.data"),
    piperWasm: chrome.runtime.getURL("vendor/piper/piper_phonemize.wasm"),
  };
}

/** Loads one voice, downloading it the first time (the library keeps it in the browser's file storage). */
export async function loadPiperVoice(voiceId: string, progress: (p: Progress) => void): Promise<TtsSession> {
  // The library reuses a single session (and the first voice's model) unless this is cleared.
  TtsSession._instance = null;
  try {
    return await TtsSession.create({ voiceId, progress, wasmPaths: wasmPaths() });
  } catch (err) {
    await forget(voiceId);
    throw err;
  } finally {
    TtsSession._instance = null;
  }
}

/**
 * The library saves whatever the server sent, even an error page, in the origin's file system under
 * piper/<file name>; delete it so a failed download isn't reused next time.
 */
async function forget(voiceId: string) {
  try {
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle("piper");
    for (const name of [`${voiceId}.onnx`, `${voiceId}.onnx.json`]) await dir.removeEntry(name).catch(() => {});
  } catch {
    // Nothing saved.
  }
}
