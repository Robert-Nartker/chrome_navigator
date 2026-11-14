// Which Parakeet model hears which language. Its own module, so Navi's background page can check without
// loading Parakeet's libraries.

/** Parakeet v3's languages (NVIDIA's list); v2 is English only, and more accurate at it. */
const V3_LANGS = "bg hr cs da nl en et fi fr de el hu it lv lt mt pl pt ro sk sl es sv ru uk".split(" ");

/** The Parakeet model for a language like "en-US", or undefined if Parakeet doesn't speak it. */
export function parakeetModelFor(lang: string): string | undefined {
  const base = lang.toLowerCase().split("-")[0];
  if (base === "en") return "parakeet-tdt-0.6b-v2";
  return V3_LANGS.includes(base) ? "parakeet-tdt-0.6b-v3" : undefined;
}

/** The recognizers that run as a model on this computer (Chrome's own is the other choice). */
export type ModelRecognizer = "parakeet" | "whisper";

export const RECOGNIZER_NAMES: Record<ModelRecognizer, string> = { parakeet: "Parakeet", whisper: "Whisper" };

/**
 * OpenAI's Whisper small (via Transformers.js): English-only for English (more accurate at it), the
 * multilingual one otherwise. On real people's single words through a Bluetooth headset it got far more
 * right than Parakeet (bench/asr): 78% against 62%, and never came back empty.
 */
export function whisperModelFor(lang: string): string {
  return lang.toLowerCase().startsWith("en") ? "Xenova/whisper-small.en" : "Xenova/whisper-small";
}

/** The model a recognizer uses for a language, or undefined if it doesn't speak it. */
export function modelFor(kind: ModelRecognizer, lang: string): string | undefined {
  return kind === "parakeet" ? parakeetModelFor(lang) : whisperModelFor(lang);
}

/** What Whisper writes for noise or silence, from the videos it learned on: never something said to Navi. */
const HALLUCINATED = /^(?:you|thanks for watching|thank you for watching|thank you so much for watching|please subscribe|subscribe)[.!]?$/i;

/**
 * What a model wrote, minus what isn't words: Whisper labels sounds ("[BLANK_AUDIO]", "(static)",
 * "*buzzing*", "♪"), sometimes cut off ("[BLANK_AUD"), writes "you" or "thanks for watching" for noise,
 * and on very short audio can loop a word ("stop stop stop stop"), which is one "stop".
 */
export function cleanTranscript(text: string): string {
  const words = text
    .replace(/\[[^\]]*\]|\([^)]*\)|\*[^*]*\*|[♪♫]/g, " ")
    .replace(/[[(*][^\])*]*$/, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (HALLUCINATED.test(words)) return "";
  const loop = /^(\S+?)[.,!?]?(?:\s+\1[.,!?]?){2,}$/i.exec(words);
  return loop ? loop[1] : words;
}
