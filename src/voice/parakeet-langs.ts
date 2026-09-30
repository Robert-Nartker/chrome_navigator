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
