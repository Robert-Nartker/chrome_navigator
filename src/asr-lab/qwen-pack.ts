// Turns Qwen3-ASR's published weights (bf16 safetensors) into the packed 8-bit file its browser engine
// loads, so a model nobody hosts in that form (the 0.6B) can still be tried. A port of qwen_pack_q8() in
// github.com/ainoya/qwen-asr (qwen_asr_pack.c) that writes the same bytes:
//   - every 2-D matrix whose width is a multiple of 64 becomes NAME.q8 (int8) + NAME.q8s (one f32 scale
//     per block of 64),
//   - each layer's MLP gate and up projections are fused into one interleaved NAME.gate_up matrix,
//   - lm_head is dropped (it's tied to the embedding), and everything else is stored as f32.

const BLOCK = 64;
const ALIGN = 64;

export interface TensorInfo {
  dtype: string;
  shape: number[];
  data_offsets: [number, number];
}
export type Header = Record<string, TensorInfo>;

/** The tensors of one safetensors file, in header order, plus where its data starts. */
export interface SourceHeader {
  tensors: [string, TensorInfo][];
  dataBase: number;
}

/** Parses a safetensors header from the file's first bytes (at least 8 + the header length). */
export function readHeader(bytes: Uint8Array): SourceHeader {
  const len = headerLength(bytes);
  const json = JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + len))) as Header & { __metadata__?: unknown };
  const tensors = Object.entries(json).filter(([name]) => name !== "__metadata__") as [string, TensorInfo][];
  return { tensors, dataBase: 8 + len };
}

export function headerLength(bytes: Uint8Array): number {
  const len = Number(new DataView(bytes.buffer, bytes.byteOffset, 8).getBigUint64(0, true));
  if (len <= 0 || len > 100 << 20) throw new Error(`Not a safetensors file (header length ${len})`);
  return len;
}

/**
 * Cuts a safetensors file's data section, arriving in chunks of any size, into whole tensors. Tensors
 * `wants` rejects are skipped without being held in memory.
 */
export function splitTensors(
  source: SourceHeader,
  wants: (name: string) => boolean,
  onTensor: (name: string, info: TensorInfo, bytes: Uint8Array) => void,
) {
  const order = [...source.tensors].sort((a, b) => a[1].data_offsets[0] - b[1].data_offsets[0]);
  let k = 0;
  let pos = 0;
  let buf: Uint8Array | null = null;
  const settle = () => {
    // Emits every tensor that is complete (including empty ones) at the current position.
    while (k < order.length && pos >= order[k][1].data_offsets[1] && pos >= order[k][1].data_offsets[0]) {
      const [name, t] = order[k];
      if (wants(name)) onTensor(name, t, buf ?? new Uint8Array(0));
      buf = null;
      k++;
    }
  };
  return {
    push(chunk: Uint8Array) {
      let off = 0;
      settle();
      while (off < chunk.length && k < order.length) {
        const [name, t] = order[k];
        const [start, end] = t.data_offsets;
        if (pos < start) {
          const n = Math.min(start - pos, chunk.length - off);
          pos += n;
          off += n;
        } else {
          const n = Math.min(end - pos, chunk.length - off);
          if (wants(name)) {
            buf ??= new Uint8Array(end - start);
            buf.set(chunk.subarray(off, off + n), pos - start);
          }
          pos += n;
          off += n;
        }
        settle();
      }
    },
    /** Whether every tensor has arrived. */
    done: () => (settle(), k === order.length),
  };
}

interface Entry {
  name: string;
  kind: "f32" | "quants" | "scales";
  shape: number[];
  nbytes: number;
  offset: number;
  /** Source tensor(s): gate_up takes its rows alternately from gate (a) and up (b). */
  a: string;
  b?: string;
  cols: number;
}

export interface PackPlan {
  entries: Entry[];
  /** The packed file's first bytes: header length, then the JSON header padded to 64 bytes. */
  head: Uint8Array;
  /** The packed file's size. */
  total: number;
}

const endsWith = (s: string, suffix: string) => s.endsWith(suffix);

/** Lays out the packed file, from the source files' headers (shards in file name order). */
export function planPack(sources: SourceHeader[]): PackPlan {
  const entries: Entry[] = [];
  const quantPair = (base: string, rows: number, cols: number, a: string, b?: string) => {
    entries.push({ name: `${base}.q8`, kind: "quants", shape: [rows, cols], nbytes: rows * cols, offset: 0, a, b, cols });
    entries.push({ name: `${base}.q8s`, kind: "scales", shape: [rows, cols / BLOCK], nbytes: rows * (cols / BLOCK) * 4, offset: 0, a, b, cols });
  };
  for (const source of sources) {
    for (const [name, t] of source.tensors) {
      if (name === "thinker.lm_head.weight") continue;
      if (endsWith(name, ".mlp.up_proj.weight")) continue;
      if (endsWith(name, ".mlp.gate_proj.weight")) {
        const stem = name.slice(0, -"gate_proj.weight".length);
        quantPair(`${stem}gate_up.weight`, t.shape[0] * 2, t.shape[1], name, `${stem}up_proj.weight`);
        continue;
      }
      if (t.shape.length === 2 && t.shape[1] % BLOCK === 0) {
        quantPair(name, t.shape[0], t.shape[1], name);
        continue;
      }
      const numel = t.shape.reduce((x, y) => x * y, 1);
      entries.push({ name, kind: "f32", shape: t.shape, nbytes: numel * 4, offset: 0, a: name, cols: 0 });
    }
  }
  let off = 0;
  for (const e of entries) {
    e.offset = off;
    off = Math.ceil((off + e.nbytes) / ALIGN) * ALIGN;
  }
  const json = `{${entries
    .map((e) => `"${e.name}":{"dtype":"${e.kind === "quants" ? "I8" : "F32"}","shape":[${e.shape.join(",")}],"data_offsets":[${e.offset},${e.offset + e.nbytes}]}`)
    .join(",")}}`;
  const jsonBytes = new TextEncoder().encode(json);
  const padded = Math.ceil((8 + jsonBytes.length) / ALIGN) * ALIGN - 8;
  const head = new Uint8Array(8 + padded).fill(0x20);
  new DataView(head.buffer).setBigUint64(0, BigInt(padded), true);
  head.set(jsonBytes, 8);
  return { entries, head, total: head.length + off };
}

/**
 * Receives source tensors in any order (as a download delivers them) and writes each packed tensor to
 * its place in the output. Gate and up projections wait for each other.
 */
export class Packer {
  private readonly byName = new Map<string, Entry[]>();
  private readonly held = new Map<string, Uint16Array>();
  private readonly done = new Set<Entry>();

  constructor(
    private readonly plan: PackPlan,
    private readonly write: (bytes: Uint8Array, at: number) => void,
  ) {
    for (const e of plan.entries) {
      for (const src of [e.a, e.b]) {
        if (src) this.byName.set(src, [...(this.byName.get(src) ?? []), e]);
      }
    }
  }

  /** Whether the plan uses this source tensor (so a download can skip the rest). */
  wants(name: string): boolean {
    return this.byName.has(name);
  }

  add(name: string, info: TensorInfo, bytes: Uint8Array) {
    const entries = this.byName.get(name);
    if (!entries) return;
    const first = entries[0];
    if (first.kind === "f32") return this.put(first, toF32(info, bytes, name));
    const bf16 = asBf16(info, bytes, name);
    const quants = entries.find((e) => e.kind === "quants")!;
    const scales = entries.find((e) => e.kind === "scales")!;
    let a = bf16;
    let b: Uint16Array | undefined;
    if (quants.b) {
      this.held.set(name, bf16);
      const ga = this.held.get(quants.a);
      const gb = this.held.get(quants.b);
      if (!ga || !gb) return;
      this.held.delete(quants.a);
      this.held.delete(quants.b);
      a = ga;
      b = gb;
    }
    const rows = quants.shape[0];
    const q = new Int8Array(rows * quants.cols);
    const s = new Float32Array(rows * (quants.cols / BLOCK));
    quantizeRows(q, s, rows, quants.cols, a, b);
    this.put(quants, new Uint8Array(q.buffer));
    this.put(scales, new Uint8Array(s.buffer));
  }

  /** Output tensors not written yet (empty once the file is complete). */
  missing(): string[] {
    return this.plan.entries.filter((e) => !this.done.has(e)).map((e) => e.name);
  }

  private put(e: Entry, bytes: Uint8Array) {
    if (bytes.length !== e.nbytes) throw new Error(`${e.name}: expected ${e.nbytes} bytes, got ${bytes.length}`);
    this.write(bytes, this.plan.head.length + e.offset);
    this.done.add(e);
  }
}

function asBf16(info: TensorInfo, bytes: Uint8Array, name: string): Uint16Array {
  if (info.dtype !== "BF16") throw new Error(`${name}: expected BF16 weights, found ${info.dtype}`);
  const aligned = bytes.byteOffset % 2 ? bytes.slice() : bytes;
  return new Uint16Array(aligned.buffer, aligned.byteOffset, aligned.length / 2);
}

function toF32(info: TensorInfo, bytes: Uint8Array, name: string): Uint8Array {
  if (info.dtype === "F32") return bytes;
  const src = asBf16(info, bytes, name);
  const out = new Uint32Array(src.length);
  for (let i = 0; i < src.length; i++) out[i] = src[i] << 16;
  return new Uint8Array(out.buffer);
}

/**
 * Blocks of 64 bf16 values to int8 with one f32 scale each: scale = max|w| / 127, q = round(w / scale)
 * (half away from zero), in f32 arithmetic like the C. With `b`, rows alternate a0, b0, a1, b1, ...
 */
function quantizeRows(q: Int8Array, s: Float32Array, rows: number, cols: number, a: Uint16Array, b?: Uint16Array) {
  const bits = new Uint32Array(cols);
  const w = new Float32Array(bits.buffer);
  const fround = Math.fround;
  // The C is built with -ffast-math, which turns `amax / 127.0f` into a multiply by 1/127.
  const inv127 = fround(1 / 127);
  const perRow = cols / BLOCK;
  for (let r = 0; r < rows; r++) {
    const src = b ? (r & 1 ? b : a) : a;
    const from = (b ? r >> 1 : r) * cols;
    for (let i = 0; i < cols; i++) bits[i] = src[from + i] << 16;
    for (let blk = 0; blk < perRow; blk++) {
      const start = blk * BLOCK;
      let amax = 0;
      for (let i = start; i < start + BLOCK; i++) {
        const v = w[i] < 0 ? -w[i] : w[i];
        if (v > amax) amax = v;
      }
      const scale = fround(amax * inv127);
      const inv = scale > 0 ? fround(1 / scale) : 0;
      s[r * perRow + blk] = scale;
      const out = r * cols;
      for (let i = start; i < start + BLOCK; i++) {
        const v = fround(w[i] * inv);
        let qi = Math.trunc(v < 0 ? fround(v - 0.5) : fround(v + 0.5));
        if (qi > 127) qi = 127;
        if (qi < -127) qi = -127;
        q[out + i] = qi;
      }
    }
  }
}
