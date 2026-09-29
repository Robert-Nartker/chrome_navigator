import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Packer, planPack, readHeader, splitTensors } from "../../src/asr-lab/qwen-pack";

const dir = new URL("../fixtures/qwen-pack/", import.meta.url);
const read = (path: string) => new Uint8Array(readFileSync(new URL(path, dir)));

/** Packs source files the way the tester's download does: tensors in the order their bytes arrive. */
function pack(files: Uint8Array[], reverse = false): Uint8Array {
  const sources = files.map(readHeader);
  const plan = planPack(sources);
  const out = new Uint8Array(plan.total);
  out.set(plan.head);
  const packer = new Packer(plan, (bytes, at) => out.set(bytes, at));
  const order = sources.flatMap((s, i) =>
    [...s.tensors].sort((a, b) => a[1].data_offsets[0] - b[1].data_offsets[0]).map(([name, t]) => ({ name, t, i, s })),
  );
  if (reverse) order.reverse();
  for (const { name, t, i, s } of order) {
    packer.add(name, t, files[i].slice(s.dataBase + t.data_offsets[0], s.dataBase + t.data_offsets[1]));
  }
  expect(packer.missing()).toEqual([]);
  return out;
}

describe("Qwen3-ASR packer (a port of the engine's C packer)", () => {
  it("writes the same file as the C packer from one checkpoint file", () => {
    expect(pack([read("single/model.safetensors")])).toEqual(read("single/expected.bin"));
  });

  it("gets the same tensors however a download chunks the file", () => {
    const file = read("single/model.safetensors");
    const source = readHeader(file);
    const whole = new Map(source.tensors.map(([n, t]) => [n, file.slice(source.dataBase + t.data_offsets[0], source.dataBase + t.data_offsets[1])]));
    for (const size of [1, 7, 64, 1000, file.length]) {
      const got = new Map<string, Uint8Array>();
      const split = splitTensors(source, (n) => n !== "thinker.lm_head.weight", (n, _t, bytes) => got.set(n, bytes.slice()));
      const data = file.subarray(source.dataBase);
      for (let at = 0; at < data.length; at += size) split.push(data.subarray(at, at + size));
      expect(split.done()).toBe(true);
      expect(got.size).toBe(whole.size - 1);
      for (const [n, bytes] of got) expect(bytes).toEqual(whole.get(n));
    }
    const cut = splitTensors(source, () => true, () => {});
    cut.push(file.subarray(source.dataBase, file.length - 1));
    expect(cut.done()).toBe(false);
  });

  it("matches with sharded weights, gate and up projections in different shards, in any order", () => {
    const shards = [read("sharded/model-00001-of-00002.safetensors"), read("sharded/model-00002-of-00002.safetensors")];
    expect(pack(shards)).toEqual(read("sharded/expected.bin"));
    expect(pack(shards, true)).toEqual(read("sharded/expected.bin"));
  });
});
