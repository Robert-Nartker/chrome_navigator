// Formatting and ratings helpers for the voice lab (kept free of browser APIs for unit tests).

export function formatMs(ms: number | null | undefined): string {
  if (ms == null) return "—";
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${Math.round(bytes / 1e6)} MB`;
  return `${Math.max(1, Math.round(bytes / 1e3))} KB`;
}

/** Synthesis time divided by audio length: under 1 means faster than real time. */
export function realTimeFactor(synthMs: number | null, audioSec: number | null): string {
  if (synthMs == null || !audioSec) return "—";
  return `${(synthMs / 1000 / audioSec).toFixed(2)}×`;
}

/** Stored under "ttsLabRatings" in chrome.storage.local, keyed by voice ("kokoro:af_heart"). */
export type Ratings = Record<string, { rating: number; label: string }>;

/** Rated voices, best first (ties keep a stable order by name). */
export function topRated(ratings: Ratings, limit = 5): { key: string; rating: number; label: string }[] {
  return Object.entries(ratings)
    .filter(([, r]) => r.rating >= 1)
    .map(([key, r]) => ({ key, ...r }))
    .sort((a, b) => b.rating - a.rating || a.label.localeCompare(b.label))
    .slice(0, limit);
}

/** "Voice A", "Voice B", … for blind listening. */
export const blindName = (index: number) => `Voice ${index < 26 ? String.fromCharCode(65 + index) : index + 1}`;

export function shuffle<T>(items: T[], random = Math.random): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
