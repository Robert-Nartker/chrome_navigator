// Matches "click sign in" against element labels. Only a confident, unambiguous
// match is clicked directly; anything fuzzier is handed to the AI.

import type { ElementInfo } from "./protocol";

const STOP_WORDS = new Set(["the", "a", "an", "on", "button", "link", "icon", "tab", "that", "this", "says"]);

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w && !STOP_WORDS.has(w));
}

export function scoreLabel(target: string, label: string): number {
  const t = words(target).join(" ");
  const l = words(label).join(" ");
  if (!t || !l) return 0;
  if (t === l) return 1;
  if (l.startsWith(`${t} `) || l.endsWith(` ${t}`)) return 0.9;
  if (` ${l} `.includes(` ${t} `)) return 0.8;
  const tw = new Set(t.split(" "));
  const lw = new Set(l.split(" "));
  let shared = 0;
  tw.forEach((w) => lw.has(w) && shared++);
  const jaccard = shared / (tw.size + lw.size - shared);
  return shared === tw.size ? Math.max(0.7, jaccard) : jaccard * 0.8;
}

export interface MatchResult {
  element: ElementInfo;
  score: number;
}

/** Returns the single best element if it's a confident, clear winner; otherwise null. */
export function bestMatch(target: string, elements: ElementInfo[]): MatchResult | null {
  const scored = elements
    .map((element) => ({
      element,
      // Prefer what the user can see.
      score: scoreLabel(target, element.name) * (element.inViewport ? 1 : 0.9),
    }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score);
  const [best, second] = scored;
  if (!best || best.score < 0.8) return null;
  const exactWins = best.score === 1 && (second?.score ?? 0) < 1;
  if (second && !exactWins && best.score - second.score < 0.1 && second.element.name !== best.element.name) {
    return null;
  }
  return best;
}
