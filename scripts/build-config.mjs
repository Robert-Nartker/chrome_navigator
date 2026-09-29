// Shared esbuild setup for `npm run build` (production) and `npm run dev` (live reload).
import { cp } from "node:fs/promises";

export const entryPoints = {
  background: "src/background.ts",
  content: "src/content/index.ts",
  sidepanel: "src/sidepanel/main.ts",
  setup: "src/setup/main.ts",
  options: "src/options/main.ts",
  "pcm-worklet": "src/audio/pcm-worklet.ts",
  offscreen: "src/offscreen/main.ts",
};

const staticFiles = [
  ["src/manifest.json", "manifest.json"],
  ["src/sidepanel/index.html", "sidepanel.html"],
  ["src/sidepanel/styles.css", "sidepanel.css"],
  ["src/setup/index.html", "setup.html"],
  ["src/options/index.html", "options.html"],
  ["src/offscreen/index.html", "offscreen.html"],
  ["src/tts-lab/index.html", "tts-lab.html"],
  ["src/shared.css", "shared.css"],
  ["src/icons", "icons"],
];

// Runtimes for the voice lab's on-device speech engines. Chrome extensions can't load code from a CDN,
// so the WebAssembly builds these libraries would normally fetch are copied in from node_modules.
// The folder names are referenced in src/tts-lab/ and the versions are pinned in package.json.
const vendorFiles = [
  // Kokoro (transformers.js): the ONNX Runtime build transformers.js was compiled against.
  ["node_modules/@huggingface/transformers/dist/ort-wasm-simd-threaded.jsep.wasm", "vendor/transformers/ort-wasm-simd-threaded.jsep.wasm"],
  ["node_modules/@huggingface/transformers/dist/ort-wasm-simd-threaded.jsep.mjs", "vendor/transformers/ort-wasm-simd-threaded.jsep.mjs"],
  // Pocket TTS: its worker imports ONNX Runtime 1.20.0's ort.min.mjs from ortBaseUrl at runtime. It only uses
  // the WebAssembly backend, so it gets the WebAssembly-only build under that name: the full build's WebGL
  // model parser tries eval(), which the extension's CSP blocks.
  ["node_modules/pocket-tts-js/src", "vendor/pocket-tts"],
  ["node_modules/onnxruntime-web-1-20/dist/ort.wasm.min.mjs", "vendor/ort-1.20.0/ort.min.mjs"],
  ["node_modules/onnxruntime-web-1-20/dist/ort-wasm-simd-threaded.mjs", "vendor/ort-1.20.0/ort-wasm-simd-threaded.mjs"],
  ["node_modules/onnxruntime-web-1-20/dist/ort-wasm-simd-threaded.wasm", "vendor/ort-1.20.0/ort-wasm-simd-threaded.wasm"],
  // Piper: ONNX Runtime 1.18.0 (single-threaded SIMD build) plus the espeak-ng phonemizer.
  ["node_modules/onnxruntime-web/dist/ort-wasm-simd.wasm", "vendor/ort-1.18.0/ort-wasm-simd.wasm"],
  ["node_modules/@diffusionstudio/piper-wasm/build/piper_phonemize.wasm", "vendor/piper/piper_phonemize.wasm"],
  ["node_modules/@diffusionstudio/piper-wasm/build/piper_phonemize.data", "vendor/piper/piper_phonemize.data"],
];

export async function copyStatic(outdir) {
  for (const [from, to] of staticFiles) {
    await cp(from, `${outdir}/${to}`, { recursive: true });
  }
  for (const [from, to] of vendorFiles) {
    // Copied once per build folder (both scripts start from an empty one), so dev rebuilds stay fast.
    // (Skips the type declarations next to Pocket TTS's scripts.)
    await cp(from, `${outdir}/${to}`, { recursive: true, force: false, filter: (src) => !src.endsWith(".d.ts") });
  }
}

export function esbuildOptions({ outdir, dev = false }) {
  return {
    entryPoints,
    outdir,
    bundle: true,
    format: "iife",
    target: "chrome120",
    sourcemap: "linked",
    minify: !dev,
    define: { __DEV__: JSON.stringify(dev) },
    logLevel: dev ? "warning" : "info",
  };
}

/**
 * The voice lab is a separate ES-module build with code splitting, so each speech engine (several MB of
 * JavaScript) loads only when you try it, and never enters the other pages' bundles. Kokoro runs in its
 * own worker module. Navi's own on-device voice shares these engines.
 */
export function labEsbuildOptions({ outdir, dev = false }) {
  return {
    ...esbuildOptions({ outdir, dev }),
    entryPoints: {
      "tts-lab": "src/tts-lab/main.ts",
      "lab/kokoro-worker": "src/tts-lab/kokoro-worker.ts",
      // Navi's on-device voice, which its background page imports when it first speaks.
      "voice/neural": "src/voice/neural.ts",
    },
    format: "esm",
    splitting: true,
    chunkNames: "lab/[name]-[hash]",
    plugins: [nodeOnlyModules],
  };
}

/** Node.js built-ins the speech libraries only use when running under Node; empty in the browser. */
const nodeOnlyModules = {
  name: "node-only-modules",
  setup(build) {
    build.onResolve({ filter: /^(fs|fs\/promises|path)$/ }, (args) => ({ path: args.path, namespace: "node-only" }));
    build.onLoad({ filter: /.*/, namespace: "node-only" }, () => ({ contents: "export default {};" }));
  },
};
