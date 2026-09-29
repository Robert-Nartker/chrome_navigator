// Stand-ins for Kokoro's files on Hugging Face: a tiny model (tests/fixtures/tts/kokoro-tone.onnx) that
// outputs a tone, with a matching tokenizer and voice. They run through the real kokoro-js, ONNX Runtime
// and worker, so tests cover everything but the real 90-330 MB download.

import { readFile } from "node:fs/promises";
import path from "node:path";

export const KOKORO = "https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main/";

const MODELS = path.resolve("tests/fixtures/tts");

/** Kokoro-style tokenizer: one token per character, wrapped in "$". */
function kokoroTokenizer() {
  const vocab: Record<string, number> = { $: 0 };
  for (const ch of " .,!?abcdefghijklmnopqrstuvwxyzæðŋɑɔəɛɪʃʊʌʒˈˌː") vocab[ch] = Object.keys(vocab).length;
  const $ = { SpecialToken: { id: "$", type_id: 0 } };
  return {
    version: "1.0",
    added_tokens: [{ id: 0, content: "$", single_word: false, lstrip: false, rstrip: false, normalized: false, special: true }],
    normalizer: null,
    pre_tokenizer: { type: "Split", pattern: { Regex: "" }, behavior: "Isolated", invert: false },
    post_processor: {
      type: "TemplateProcessing",
      single: [$, { Sequence: { id: "A", type_id: 0 } }, $],
      pair: [],
      special_tokens: { $: { id: "$", ids: [0], tokens: ["$"] } },
    },
    decoder: null,
    model: { vocab },
  };
}

/** File URL → body. (The 8-bit model, which Kokoro uses without a graphics chip.) */
export const KOKORO_STAND_INS: Record<string, () => Promise<Buffer> | Buffer | string> = {
  [`${KOKORO}config.json`]: () => JSON.stringify({ model_type: "style_text_to_speech_2" }),
  [`${KOKORO}tokenizer.json`]: () => JSON.stringify(kokoroTokenizer()),
  [`${KOKORO}tokenizer_config.json`]: () => JSON.stringify({ model_max_length: 512, unk_token: "$", pad_token: "$" }),
  [`${KOKORO}onnx/model_quantized.onnx`]: () => readFile(path.join(MODELS, "kokoro-tone.onnx")),
  // One 256-value style vector per input length.
  [`${KOKORO}voices/af_heart.bin`]: () => Buffer.alloc(510 * 256 * 4),
};
