/*
 * loader.js - the model-loading helpers from the Qwen3-ASR WebAssembly demo (wasm/demo/app.js in
 * github.com/ainoya/qwen-asr, commit 5f80f45, MIT licensed; see LICENSE). app.js is a UI script that
 * runs against the demo's own page at import time, so these functions are copied out of it unchanged,
 * minus its log() calls and debug counters.
 */

import { freshHeap } from "./heap.js";
import { tick } from "./tick.js";

const isMobileDevice = (typeof navigator !== "undefined" &&
  (/iPad|iPhone|iPod/.test(navigator.userAgent) ||
   (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)));
const P = (ptr) => ptr >>> 0;
const f32idx = (ptr) => P(ptr) / 4;

const DROP_RE = /^thinker\.model\.layers\.\d+\.(self_attn\.(q|k|v|o)_proj|mlp\.(gate_up|down_proj))\.weight\.q8s?$|^thinker\.model\.embed_tokens\.weight\.q8s?$|^thinker\.audio_tower\./;

/* Direct streaming model loader: weights stream directly to WebGPU storage buffers
 * and a 0.5 MB reduced norm image in WASM linear memory. No transient 2.18 GB
 * array is held in JS memory, keeping peak host memory < 100 MB. */

/**
 * Phase 1: Reads the initial safetensors header from the stream reader.
 * Accumulates only until dataBase (8 + hlen ~ 122,688 bytes) is reached.
 * Returns the parsed header, dataBase offset, and any excess bytes from the chunk.
 */
async function parseSafetensorsHeaderStream(reader) {
  let chunks = [];
  let totalBytes = 0;

  while (totalBytes < 8) {
    const { done, value } = await reader.read();
    if (done) throw new Error("Stream closed before reading safetensors header length");
    chunks.push(value);
    totalBytes += value.length;
  }

  let buf = new Uint8Array(totalBytes);
  let off = 0;
  for (const c of chunks) {
    buf.set(c, off);
    off += c.length;
  }
  chunks = [buf];

  const headerLen = Number(new DataView(buf.buffer, buf.byteOffset, 8).getBigUint64(0, true));
  if (headerLen <= 0 || headerLen > 50 * 1024 * 1024) {
    throw new Error(`Invalid safetensors header length: ${headerLen}`);
  }

  const headerEnd = 8 + headerLen;

  while (totalBytes < headerEnd) {
    const { done, value } = await reader.read();
    if (done) throw new Error(`Stream closed while reading safetensors header (${totalBytes}/${headerEnd} bytes)`);
    chunks.push(value);
    totalBytes += value.length;
  }

  buf = new Uint8Array(totalBytes);
  off = 0;
  for (const c of chunks) {
    buf.set(c, off);
    off += c.length;
  }

  const headerJsonBytes = buf.subarray(8, headerEnd);
  const headerJsonStr = new TextDecoder("utf-8").decode(headerJsonBytes);
  const header = JSON.parse(headerJsonStr);

  const dataBase = headerEnd;
  const leftover = buf.subarray(headerEnd);

  return { header, headerLen, dataBase, leftover };
}

/**
 * Phase 1b: Builds the reduced safetensors metadata (113 norm tensors) and allocates WASM buffer.
 */
function prepareWasmReducedImage(header, Module) {
  const kept = Object.entries(header)
    .filter(([name]) => name !== "__metadata__" && !DROP_RE.test(name))
    .sort((a, b) => a[1].data_offsets[0] - b[1].data_offsets[0]);

  const newHeader = {};
  let dataOff = 0;
  for (const [name, t] of kept) {
    const size = t.data_offsets[1] - t.data_offsets[0];
    dataOff = Math.ceil(dataOff / 64) * 64;
    newHeader[name] = { dtype: t.dtype, shape: t.shape, data_offsets: [dataOff, dataOff + size] };
    dataOff += size;
  }

  let hjson = new TextEncoder().encode(JSON.stringify(newHeader));
  const hpad = Math.ceil(hjson.length / 64) * 64; // keep the data 64-aligned
  const paddedHjson = new Uint8Array(hpad).fill(0x20); // ASCII space padding
  paddedHjson.set(hjson);

  const reducedLen = 8 + paddedHjson.length + dataOff;
  const reducedPtr = P(Module._qwen_wasm_alloc(reducedLen));
  if (!reducedPtr) throw new Error(`Could not allocate ${reducedLen} bytes in WASM memory`);

  // Write 8-byte header size (little-endian uint64)
  new DataView(freshHeap(Module).HEAPU8.buffer, reducedPtr, 8)
    .setBigUint64(0, BigInt(paddedHjson.length), true);

  // Write padded JSON header bytes
  freshHeap(Module).HEAPU8.set(paddedHjson, reducedPtr + 8);

  const wasmDataBase = reducedPtr + 8 + paddedHjson.length;
  const wasmNormMap = new Map();
  for (const [name, t] of kept) {
    wasmNormMap.set(name, wasmDataBase + newHeader[name].data_offsets[0]);
  }

  return { reducedPtr, reducedLen, kept, newHeader, wasmNormMap };
}

/**
 * Extracts Q8 and vector descriptors from safetensors header.
 */
function extractModelDescriptorsFromHeader(header, dataBase) {
  const abs = (t) => dataBase + t.data_offsets[0];
  const MATS = ["self_attn.q_proj", "self_attn.k_proj", "self_attn.v_proj",
                "self_attn.o_proj", "mlp.gate_up", "mlp.down_proj"];
  let decLayers = 0;
  while (header[`thinker.model.layers.${decLayers}.self_attn.q_proj.weight.q8`]) decLayers++;
  if (!decLayers) throw new Error("no decoder layers in the model header");

  const decEntries = [];
  for (let l = 0; l < decLayers; l++) {
    for (let kind = 0; kind < 6; kind++) {
      const base = `thinker.model.layers.${l}.${MATS[kind]}.weight`;
      const q = header[`${base}.q8`], sc = header[`${base}.q8s`];
      if (!q || !sc) throw new Error(`missing ${base}.q8 in the model header`);
      decEntries.push({ kind, layer: l, rows: q.shape[0], cols: q.shape[1],
                        qoff: abs(q), soff: abs(sc) });
    }
  }
  const emb = header["thinker.model.embed_tokens.weight.q8"];
  const embS = header["thinker.model.embed_tokens.weight.q8s"];
  if (!emb || !embS) throw new Error("missing embed_tokens.q8 in the model header");
  decEntries.push({ kind: 6, layer: 0, rows: emb.shape[0], cols: emb.shape[1],
                    qoff: abs(emb), soff: abs(embS) });

  const T = "thinker.audio_tower.";
  const need = (n) => {
    const t = header[n];
    if (!t) throw new Error(`missing ${n} in the model header`);
    return t;
  };
  const numel = (t) => t.shape.reduce((a, b) => a * b, 1);
  let ek = 0;
  const encEntries = [];
  const vec = (name) => { const t = need(name);
    encEntries.push({ kind: ek++, layer: 0, count: numel(t), foff: abs(t) }); };
  const mat = (name) => { const q = need(name + ".q8"), sc = need(name + ".q8s");
    encEntries.push({ kind: ek++, layer: 0, rows: q.shape[0], cols: q.shape[1],
                      qoff: abs(q), soff: abs(sc) }); };
  vec(T + "conv2d1.weight"); vec(T + "conv2d1.bias");
  vec(T + "conv2d2.weight"); vec(T + "conv2d2.bias");
  vec(T + "conv2d3.weight"); vec(T + "conv2d3.bias");
  mat(T + "conv_out.weight");
  let encLayers = 0;
  while (header[`${T}layers.${encLayers}.self_attn.q_proj.weight.q8`]) encLayers++;
  if (!encLayers) throw new Error("no encoder layers in the model header");
  for (let l = 0; l < encLayers; l++) {
    const L = `${T}layers.${l}.`;
    ek = 7;
    const lv = (name) => { const t = need(name);
      encEntries.push({ kind: ek++, layer: l, count: numel(t), foff: abs(t) }); };
    const lm = (name) => { const q = need(name + ".q8"), sc = need(name + ".q8s");
      encEntries.push({ kind: ek++, layer: l, rows: q.shape[0], cols: q.shape[1],
                        qoff: abs(q), soff: abs(sc) }); };
    lv(L + "self_attn_layer_norm.weight"); lv(L + "self_attn_layer_norm.bias");
    lm(L + "self_attn.q_proj.weight"); lv(L + "self_attn.q_proj.bias");
    lm(L + "self_attn.k_proj.weight"); lv(L + "self_attn.k_proj.bias");
    lm(L + "self_attn.v_proj.weight"); lv(L + "self_attn.v_proj.bias");
    lm(L + "self_attn.out_proj.weight"); lv(L + "self_attn.out_proj.bias");
    lv(L + "final_layer_norm.weight"); lv(L + "final_layer_norm.bias");
    lm(L + "fc1.weight"); lv(L + "fc1.bias");
    lm(L + "fc2.weight"); lv(L + "fc2.bias");
  }
  ek = 23;
  vec(T + "ln_post.weight"); vec(T + "ln_post.bias");
  mat(T + "proj1.weight"); vec(T + "proj1.bias");
  mat(T + "proj2.weight"); vec(T + "proj2.bias");

  return { decEntries, encEntries, decLayers, encLayers };
}

/**
 * Builds the contiguous interval dispatch table mapping each file byte range [start, end)
 * directly to its destination WebGPU buffer or WASM linear memory offset.
 */
function buildIntervalDispatchTable(header, dataBase, decoder, encoder, wasmNormMap) {
  const intervals = [];

  // 1. Audio Tower (Encoder)
  for (const ent of encoder.entries) {
    if (ent.qoff != null) {
      const qSize = ent.rows * ent.cols;
      intervals.push({
        start: ent.qoff,
        end: ent.qoff + qSize,
        target: {
          gpuBuffer: encoder.bufQuants[ent.shard],
          gpuOffset: ent.wordBase * 4,
        },
      });
      const sSize = ent.rows * (ent.cols / 64) * 4;
      intervals.push({
        start: ent.soff,
        end: ent.soff + sSize,
        target: {
          gpuBuffer: encoder.bufScales,
          gpuOffset: ent.scaleBase * 4,
        },
      });
    } else if (ent.foff != null) {
      const fSize = ent.count * 4;
      intervals.push({
        start: ent.foff,
        end: ent.foff + fSize,
        target: {
          gpuBuffer: encoder.bufVecs,
          gpuOffset: ent.vecBase * 4,
        },
      });
    }
  }

  // 2. Decoder Layers & Tied Embedding
  for (const w of decoder.wmap.values()) {
    if (w.pieces) {
      for (const p of w.pieces) {
        intervals.push({
          start: p.qoff,
          end: p.qoff + p.nq,
          target: {
            gpuBuffer: decoder.bufQuants[p.shard],
            gpuOffset: p.wordBase * 4,
          },
        });
      }
    } else {
      intervals.push({
        start: w.qoff,
        end: w.qoff + w.nq,
        target: {
          gpuBuffer: decoder.bufQuants[w.shard],
          gpuOffset: w.wordBase * 4,
        },
      });
    }
    const sSize = (w.nq / 64) * 4;
    intervals.push({
      start: w.soff,
      end: w.soff + sSize,
      target: {
        gpuBuffer: decoder.bufScale,
        gpuOffset: w.scaleBase * 4,
      },
    });
  }

  // 3. Norm Weights (Dual target: WebGPU bufNorm + WASM Reduced Image)
  for (const [key, n] of decoder.nmap.entries()) {
    const [kindStr, layerStr] = key.split(":");
    const kind = Number(kindStr), layer = Number(layerStr);
    let normName;
    if (kind === 4) {
      normName = "thinker.model.norm.weight";
    } else {
      const suffixes = [
        "input_layernorm.weight",
        "post_attention_layernorm.weight",
        "self_attn.q_norm.weight",
        "self_attn.k_norm.weight",
      ];
      normName = `thinker.model.layers.${layer}.${suffixes[kind]}`;
    }

    const t = header[normName];
    if (!t) throw new Error(`Norm tensor missing from header: ${normName}`);
    const start = dataBase + t.data_offsets[0];
    const end = dataBase + t.data_offsets[1];
    const wasmPtr = wasmNormMap ? wasmNormMap.get(normName) : undefined;

    intervals.push({
      start,
      end,
      target: {
        gpuBuffer: decoder.bufNorm,
        gpuOffset: n.base * 4,
        wasmPtr,
      },
    });
  }

  intervals.sort((a, b) => a.start - b.start);
  return intervals;
}

/**
 * High-performance streaming interval dispatcher.
 */
class IntervalDispatcher {
  constructor(intervals, device, Module) {
    this.intervals = intervals;
    this.device = device;
    this.Module = Module;
    this.currentIndex = 0;
    this.bytesWritten = 0;
  }

  dispatch(chunk, chunkStart) {
    const chunkEnd = chunkStart + chunk.length;
    let i = this.currentIndex;

    while (i < this.intervals.length && this.intervals[i].end <= chunkStart) {
      i++;
    }
    this.currentIndex = i;

    while (i < this.intervals.length && this.intervals[i].start < chunkEnd) {
      const inv = this.intervals[i];
      const overlapStart = Math.max(chunkStart, inv.start);
      const overlapEnd = Math.min(chunkEnd, inv.end);
      const overlapLen = overlapEnd - overlapStart;

      if (overlapLen > 0) {
        const chunkOffset = overlapStart - chunkStart;
        const slice = chunk.subarray(chunkOffset, chunkOffset + overlapLen);
        const targetOffset = overlapStart - inv.start;

        const t = inv.target;
        if (t.gpuBuffer) {
          this.device.queue.writeBuffer(
            t.gpuBuffer,
            t.gpuOffset + targetOffset,
            slice
          );
        }
        if (t.wasmPtr != null) {
          freshHeap(this.Module).HEAPU8.set(slice, t.wasmPtr + targetOffset);
        }
        this.bytesWritten += overlapLen;
      }
      i++;
    }
  }
}

/**
 * Phase 2: Streams all remaining chunks directly into WebGPU and WASM target buffers.
 */
async function streamChunksToTargets({
  reader,
  dispatcher,
  initialFileOffset,
  totalBytes,
  device,
  excessChunk,
  reportProgress = () => {},
}) {
  const isMobile = isMobileDevice;
  let fileOffset = initialFileOffset;
  let bytesSinceSync = 0;
  // On mobile (iOS Safari), use a 4 MB sync interval with a 15ms pause to allow
  // the iOS kernel vm_compressor to compress inactive pages and WebKit to purge staging buffers.
  const SYNC_INTERVAL = isMobile ? (4 * 1024 * 1024) : (32 * 1024 * 1024);

  let alignRemainder = null; // Cross-chunk remainder scratchpad (< 4 bytes)

  async function processAlignedChunk(rawChunk) {
    let chunk = rawChunk;
    if (alignRemainder !== null) {
      const merged = new Uint8Array(alignRemainder.length + rawChunk.length);
      merged.set(alignRemainder, 0);
      merged.set(rawChunk, alignRemainder.length);
      chunk = merged;
      alignRemainder = null;
    }

    const unalignedTail = chunk.length % 4;
    let alignedChunk = chunk;
    if (unalignedTail !== 0) {
      const alignedLen = chunk.length - unalignedTail;
      alignRemainder = chunk.slice(alignedLen);
      alignedChunk = chunk.subarray(0, alignedLen);
    }

    if (alignedChunk.length > 0) {
      dispatcher.dispatch(alignedChunk, fileOffset);
      fileOffset += alignedChunk.length;
      bytesSinceSync += alignedChunk.length;
    }

    if (bytesSinceSync >= SYNC_INTERVAL) {
      bytesSinceSync = 0;
      reportProgress(fileOffset, totalBytes);
      await device.queue.onSubmittedWorkDone();
      // On mobile / Safari, yielding via setTimeout(..., 15) gives the native
      // Cocoa / WebKit CFRunLoop and iOS vm_compressor time to compress cold pages,
      // drain the @autoreleasepool, flush IPC buffers, and sweep JS garbage.
      if (isMobile) {
        await new Promise((r) => setTimeout(r, 15));
      } else {
        await tick();
      }
    }
  }

  // 1. Process any excess bytes read during Phase 1
  if (excessChunk && excessChunk.length > 0) {
    await processAlignedChunk(excessChunk);
    excessChunk = null;
  }

  // 2. Stream loop
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    await processAlignedChunk(value);
  }

  // 3. Final validation and staging flush
  if (alignRemainder && alignRemainder.length > 0) {
    throw new Error(`Model stream truncated with ${alignRemainder.length} unaligned bytes`);
  }
  if (fileOffset !== totalBytes) {
    throw new Error(`Model stream truncated: received ${fileOffset} of ${totalBytes} bytes`);
  }

  await device.queue.onSubmittedWorkDone();
  if (isMobile) {
    await new Promise((r) => setTimeout(r, 0));
  }
  reportProgress(totalBytes, totalBytes);
}

/**
 * Installs WebGPU hooks for embedding lookup, audio tower encoding, and decode loop.
 */
function setupGpuHooks(gpu, encoder, Module) {
  gpu.prepareEmbeddingLookup();
  const embedCache = new Map();
  const EMBED_CACHE_ROWS = 256;
  Module.__gpuEmbedMany = async (idsPtr, n, dst, dim, req) => {
    try {
      idsPtr = idsPtr >>> 0;
      dst = dst >>> 0;
      const ids = new Int32Array(freshHeap(Module).HEAPU8.buffer, idsPtr, n).slice();
      const missing = [];
      const seen = new Set();
      for (const id of ids) {
        if (!embedCache.has(id) && !seen.has(id)) {
          seen.add(id);
          missing.push(id);
        }
      }
      const fresh = new Map();
      if (missing.length) {
        const rows = await gpu.readTokenEmbeddings(missing);
        if (rows.length !== missing.length * dim)
          throw new Error(`embedding batch width ${rows.length}, expected ${missing.length * dim}`);
        for (let i = 0; i < missing.length; i++)
          fresh.set(missing[i], rows.slice(i * dim, (i + 1) * dim));
      }
      const base = f32idx(dst);
      for (let i = 0; i < ids.length; i++) {
        const id = ids[i];
        const row = embedCache.get(id) || fresh.get(id);
        if (!row) throw new Error(`embedding row ${id} unavailable`);
        freshHeap(Module).HEAPF32.set(row, base + i * dim);
        if (embedCache.has(id)) embedCache.delete(id);
        embedCache.set(id, row);
        if (embedCache.size > EMBED_CACHE_ROWS)
          embedCache.delete(embedCache.keys().next().value);
      }
      Module._qwen_wasm_embed_hook_done(req, 1);
    } catch (err) {
      console.error("gpu embedding hook:", err);
      Module._qwen_wasm_embed_hook_done(req, 0);
    }
  };
  Module._qwen_wasm_set_gpu_embedder(1);

  if (encoder) {
    Module.__gpuEncode = async (melPtr, frames) => {
      try {
        encoder.hookCalls = (encoder.hookCalls || 0) + 1;
        const out = await encoder.runFromMel(melPtr, frames);
        const p = P(Module._qwen_wasm_alloc(out.byteLength));
        if (!p) throw new Error("out of wasm memory for the encoder output");
        freshHeap(Module).HEAPF32.set(out, f32idx(p));
        Module._qwen_wasm_enc_hook_done(p, encoder.tokens);
      } catch (err) {
        encoder.hookFails = (encoder.hookFails || 0) + 1;
        console.error("gpu encoder hook:", err);
        Module._qwen_wasm_enc_hook_done(0, 0);
      }
    };
  }

  Module.__gpuDecode = async (embedsPtr, totalSeq, reuseLen, maxNew) => {
    try {
      if (!gpu) throw new Error("no GPU decoder");
      embedsPtr = embedsPtr >>> 0;
      const r = reuseLen > 0
        ? await gpu.prefillSuffixAndGenerate(embedsPtr, totalSeq, reuseLen, maxNew - 1, null)
        : await gpu.prefillAndGenerate(embedsPtr, totalSeq, maxNew - 1, null);
      const ids = (r.ids || []).slice(0, maxNew);
      const p = P(Module._qwen_wasm_alloc(Math.max(ids.length, 1) * 4));
      if (!p) throw new Error("out of wasm memory for the token ids");
      new Int32Array(freshHeap(Module).HEAPU8.buffer, p, ids.length).set(ids);
      Module._qwen_wasm_dec_hook_done(p, ids.length);
      Module._qwen_wasm_release(p);
    } catch (err) {
      console.error("gpu decode hook:", err);
      gpu && (gpu.hookFails = (gpu.hookFails || 0) + 1);
      Module._qwen_wasm_dec_hook_done(0, -1);
    }
  };
}

export {
  parseSafetensorsHeaderStream,
  prepareWasmReducedImage,
  extractModelDescriptorsFromHeader,
  buildIntervalDispatchTable,
  IntervalDispatcher,
  streamChunksToTargets,
  setupGpuHooks,
};
