// Matching by sound: what the recognizer wrote down ("clothes tab", "go bag") against the commands it
// sounds like ("close tab", "go back"). Spelling-based matching misses these: the letters differ, the
// sounds don't. Used only as a last resort, for short phrases, and only when one command is clearly closest.

/** A rough sound key for an English word: consonants that sound alike merge, vowels drop. */
export function soundKey(word: string): string {
  let w = word.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!w || /^\d+$/.test(w)) return w;
  // Endings the recognizer adds or drops ("stopped", "refreshed", "scrolling").
  if (w.length > 4) w = w.replace(/(?:ing|ed)$/, "");
  w = w
    .replace(/x/g, "ks")
    .replace(/^kn/, "n")
    .replace(/^wr/, "r")
    .replace(/^ps/, "s")
    .replace(/^gh/, "g")
    .replace(/gh/g, "")
    .replace(/ph/g, "f")
    .replace(/sch/g, "sk")
    .replace(/tch|ch|sh/g, "x")
    .replace(/th/g, "t")
    .replace(/wh/g, "w")
    .replace(/w(?![aeiouy])/g, "")
    .replace(/que$/, "k")
    .replace(/qu/g, "kw")
    .replace(/ck/g, "k")
    .replace(/c(?=[eiy])/g, "s")
    .replace(/[cq]/g, "k")
    .replace(/z/g, "s")
    // Voiced and voiceless pairs are what recognizers swap most ("bag"/"back", "tab"/"tap").
    .replace(/b/g, "p")
    .replace(/d/g, "t")
    .replace(/g/g, "k")
    .replace(/v/g, "f")
    .replace(/j/g, "x");
  const first = /^[aeiouy]/.test(w) ? "A" : "";
  const consonants = w.replace(/^[aeiouy]+/, "").replace(/(?!^)h/g, "").replace(/[aeiouy]/g, "");
  return (first + consonants.toUpperCase()).replace(/(.)\1+/g, "$1");
}

/** Whether two words sound alike, allowing `slack` differences in their sound keys. */
export function soundsClose(a: string, b: string, slack = 0): boolean {
  return distance(soundKey(a), soundKey(b)) <= slack;
}

function distance(a: string, b: string): number {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

/** How far apart two phrases sound (same number of words), or Infinity if not close word by word. */
function soundDistance(said: string[], phrase: string[]): number {
  if (said.length !== phrase.length) return Infinity;
  let cost = 0;
  for (let i = 0; i < said.length; i++) {
    const a = soundKey(said[i]);
    const b = soundKey(phrase[i]);
    // An added or dropped "s" ("goes back") is free in a phrase; one word on its own must match
    // ("flag" in a mail app isn't "flags").
    const d = said.length > 1 && a.replace(/S$/, "") === b.replace(/S$/, "") ? 0 : distance(a, b);
    if (d > 1) return Infinity;
    cost += d;
  }
  return cost;
}

/**
 * The command phrase `text` sounds like, if exactly one is close enough: a one-word command must sound
 * the same ("paws" for "pause", but not "hello" for "help"); longer ones may be off by a little.
 */
export function soundsLike(text: string, phrases: readonly string[]): string | null {
  const said = text.toLowerCase().split(/\s+/).filter(Boolean);
  if (!said.length || said.length > 5) return null;
  let best: string | null = null;
  let bestCost = Infinity;
  let tie = false;
  for (const phrase of phrases) {
    const words = phrase.split(" ");
    const cost = soundDistance(said, words);
    if (cost === Infinity) continue;
    const length = words.reduce((n, w) => n + soundKey(w).length, 0);
    const allowed = words.length === 1 ? 0 : Math.floor(length / 5);
    if (cost > allowed) continue;
    if (cost < bestCost) {
      best = phrase;
      bestCost = cost;
      tie = false;
    } else if (cost === bestCost && phrase !== best) tie = true;
  }
  return tie ? null : best;
}
