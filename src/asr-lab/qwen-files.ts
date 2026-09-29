// Downloads a Qwen3-ASR model once into the browser's private storage (OPFS), off the page's thread, so
// later visits load it from disk. The 1.7B is published ready-packed for the browser engine; the 0.6B
// is only published as bf16 weights, so it's packed here while it downloads (see qwen-pack.ts).

import { Packer, type SourceHeader, headerLength, planPack, readHeader, splitTensors } from "./qwen-pack";

export interface QwenFilesRequest {
  /** Folder under qwen-asr/ in the browser's private storage. */
  dir: string;
  /** Hugging Face "resolve" URL of the repo the files come from. */
  base: string;
  /** The ready-packed model's file name, or absent to pack the repo's safetensors weights. */
  packed?: string;
}

export type QwenFilesReply =
  | { type: "progress"; loaded: number; total: number }
  | { type: "done" }
  | { type: "error"; message: string };

type SyncHandle = {
  write(data: Uint8Array, opts: { at: number }): number;
  truncate(size: number): void;
  flush(): void;
  close(): void;
};
type FileHandle = FileSystemFileHandle & {
  createSyncAccessHandle(): Promise<SyncHandle>;
  move(name: string): Promise<void>;
};

const post = (reply: QwenFilesReply) => (self as unknown as { postMessage(m: unknown): void }).postMessage(reply);

async function has(dir: FileSystemDirectoryHandle, name: string) {
  try {
    await dir.getFileHandle(name);
    return true;
  } catch {
    return false;
  }
}

/** Writes a file under a temporary name and renames it when complete, so a cut-off download never looks finished. */
async function writeFile(dir: FileSystemDirectoryHandle, name: string, fill: (h: SyncHandle) => Promise<void>) {
  const part = (await dir.getFileHandle(`${name}.part`, { create: true })) as FileHandle;
  const h = await part.createSyncAccessHandle();
  try {
    h.truncate(0);
    await fill(h);
    h.flush();
  } finally {
    h.close();
  }
  await part.move(name);
}

async function get(url: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url.split("/").pop()}: HTTP ${res.status}`);
  return res;
}

/** Progress across several downloads. */
function meter(total: number) {
  let loaded = 0;
  let shown = 0;
  return (n: number) => {
    loaded += n;
    if (loaded - shown > 16 << 20 || loaded === total) {
      shown = loaded;
      post({ type: "progress", loaded, total });
    }
  };
}

async function downloadPacked(dir: FileSystemDirectoryHandle, url: string) {
  const res = await get(url);
  const total = Number(res.headers.get("content-length")) || 0;
  const tick = meter(total);
  await writeFile(dir, "model.bin", async (h) => {
    const reader = res.body!.getReader();
    let at = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      h.write(value, { at });
      at += value.length;
      tick(value.length);
    }
    if (total && at !== total) throw new Error(`The download stopped at ${at} of ${total} bytes`);
  });
}

interface Opened {
  reader: ReadableStreamDefaultReader<Uint8Array>;
  source: SourceHeader;
  /** Data bytes already read past the header. */
  leftover: Uint8Array;
  size: number;
}

/** Starts downloading a safetensors file and reads its header. */
async function open(url: string): Promise<Opened> {
  const res = await get(url);
  const reader = res.body!.getReader();
  let buf = new Uint8Array(0);
  const need = async (n: number) => {
    while (buf.length < n) {
      const { done, value } = await reader.read();
      if (done) throw new Error(`${url.split("/").pop()} ended early`);
      const next = new Uint8Array(buf.length + value.length);
      next.set(buf);
      next.set(value, buf.length);
      buf = next;
    }
  };
  await need(8);
  await need(8 + headerLength(buf));
  const source = readHeader(buf);
  return { reader, source, leftover: buf.subarray(source.dataBase), size: Number(res.headers.get("content-length")) || 0 };
}

/** Streams a file's tensors to the packer as each one's bytes arrive. */
async function feed(o: Opened, packer: Packer, tick: (n: number) => void) {
  const split = splitTensors(o.source, (name) => packer.wants(name), (name, t, bytes) => packer.add(name, t, bytes));
  tick(o.source.dataBase + o.leftover.length);
  split.push(o.leftover);
  for (;;) {
    const { done, value } = await o.reader.read();
    if (done) break;
    tick(value.length);
    split.push(value);
  }
  if (!split.done()) throw new Error("The download stopped early");
}

async function downloadAndPack(dir: FileSystemDirectoryHandle, base: string) {
  // One file, or shards listed in an index.
  let files = ["model.safetensors"];
  const index = await fetch(`${base}/model.safetensors.index.json`);
  if (index.ok) {
    const map = ((await index.json()) as { weight_map: Record<string, string> }).weight_map;
    files = [...new Set(Object.values(map))].sort();
  }
  const opened: Opened[] = [];
  for (const file of files) opened.push(await open(`${base}/${file}`));
  const plan = planPack(opened.map((o) => o.source));
  const tick = meter(opened.reduce((sum, o) => sum + o.size, 0));
  await writeFile(dir, "model.bin", async (h) => {
    h.truncate(plan.total);
    h.write(plan.head, { at: 0 });
    const packer = new Packer(plan, (bytes, at) => h.write(bytes, { at }));
    for (let i = 0; i < files.length; i++) {
      // Later shards were only opened for their headers; start them again when their turn comes.
      if (i > 0) {
        void opened[i].reader.cancel();
        opened[i] = await open(`${base}/${files[i]}`);
      }
      await feed(opened[i], packer, tick);
    }
    const missing = packer.missing();
    if (missing.length) throw new Error(`The weights are missing ${missing[0]}`);
  });
}

self.onmessage = async ({ data }: MessageEvent<QwenFilesRequest>) => {
  try {
    const root = await navigator.storage.getDirectory();
    const dir = await (await root.getDirectoryHandle("qwen-asr", { create: true })).getDirectoryHandle(data.dir, { create: true });
    for (const name of ["vocab.json", "merges.txt"]) {
      if (await has(dir, name)) continue;
      const bytes = new Uint8Array(await (await get(`${data.base}/${name}`)).arrayBuffer());
      await writeFile(dir, name, async (h) => void h.write(bytes, { at: 0 }));
    }
    if (!(await has(dir, "model.bin"))) {
      if (data.packed) await downloadPacked(dir, `${data.base}/${data.packed}`);
      else await downloadAndPack(dir, data.base);
    }
    post({ type: "done" });
  } catch (err) {
    post({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
