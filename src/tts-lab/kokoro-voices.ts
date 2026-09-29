// Kokoro's English voices, in their own module so settings pages can list them without the voice lab's
// engines (and their libraries) coming along.

import type { LabVoice } from "./engines";

export const KOKORO_VOICES: LabVoice[] = [
  ["af_heart", "Heart", "US English · female · rated A by Kokoro's authors"],
  ["af_bella", "Bella", "US English · female · rated A-"],
  ["af_nicole", "Nicole", "US English · female, soft · rated B-"],
  ["bf_emma", "Emma", "British English · female · rated B-"],
  ["af_sarah", "Sarah", "US English · female · rated C+"],
  ["af_aoede", "Aoede", "US English · female · rated C+"],
  ["af_kore", "Kore", "US English · female · rated C+"],
  ["af_sky", "Sky", "US English · female · rated C-"],
  ["bf_isabella", "Isabella", "British English · female · rated C"],
  ["am_michael", "Michael", "US English · male · rated C+"],
  ["am_fenrir", "Fenrir", "US English · male · rated C+"],
  ["bm_george", "George", "British English · male · rated C"],
].map(([id, name, detail]) => ({ key: `kokoro:${id}`, engine: "kokoro", id, name, detail }));
