// Local usage log: one row per command (path, latency, steps). Useful for the
// evaluation section of the project; stays in this browser unless exported.

/** How a spoken command came through the recognizer: for tuning speech recognition with real use. */
export interface Hearing {
  /** What the recognizer wrote down, before the wake name was taken off. */
  heard: string;
  /** Its other guesses, best first. */
  alternatives?: string[];
  confidence?: number;
  /** Which recognizer heard it. */
  recognizer?: "chrome" | "parakeet" | "whisper";
  /** Who ended the phrase: Chrome finished it, Navi ran words Chrome held unfinished, the session ended, or (Parakeet) a pause. */
  ending?: "chrome" | "held" | "ended" | "pause";
  /** From the first word to the last change of words. */
  speechMs?: number;
  /** From the last change of words to running it. */
  waitMs?: number;
}

export interface CommandMetric {
  t: string;
  command: string;
  /**
   * "fast" = handled without AI, "ai" = the AI (GPT, Claude, or Navi Free's Gemini Nano), "background" =
   * AI work Navi did on its own, like updating its memory (not a command; its cost still counts).
   */
  path: "fast" | "ai" | "error" | "cancelled" | "ignored" | "background";
  intent?: string;
  ms: number;
  modelMs?: number;
  steps?: number;
  model?: string;
  /** Time the router model took to interpret an unrecognized command. */
  routerMs?: number;
  /** API cost of this command (router + main model), in USD. */
  costUsd?: number;
  tokensIn?: number;
  tokensOut?: number;
  error?: string;
  /** Spoken commands: what the recognizer heard (see Hearing). */
  heard?: string;
  recognizer?: Hearing["recognizer"];
  alternatives?: string;
  confidence?: number;
  ending?: Hearing["ending"];
  speechMs?: number;
  waitMs?: number;
  /** The user said it wasn't what they said ("that's not what I said"). */
  misheard?: boolean;
}

/** The usage-log columns for how a spoken command was heard. */
export function hearingColumns(hearing: Hearing | undefined): Partial<CommandMetric> {
  if (!hearing) return {};
  return {
    heard: hearing.heard,
    recognizer: hearing.recognizer,
    alternatives: hearing.alternatives?.length ? hearing.alternatives.join(" | ") : undefined,
    confidence: hearing.confidence ? Math.round(hearing.confidence * 100) / 100 : undefined,
    ending: hearing.ending,
    speechMs: hearing.speechMs,
    waitMs: hearing.waitMs,
  };
}

/** Marks the last spoken command as misheard. Returns what was heard, if there was one. */
export function markLastMisheard(): Promise<CommandMetric | undefined> {
  return update((rows) => {
    const last = [...rows].reverse().find((r) => r.heard !== undefined && !r.misheard && r.intent !== "misheard" && r.intent !== "whatHeard");
    if (last) last.misheard = true;
    return last;
  });
}

const KEY = "metrics";
const MAX_ROWS = 2000;

/** Writes to the log one at a time, so two at once can't drop a row or undo a change. */
let writes: Promise<unknown> = Promise.resolve();
function update<T>(change: (rows: CommandMetric[]) => T): Promise<T> {
  const next = writes.then(async () => {
    const stored = await chrome.storage.local.get(KEY);
    const rows = (stored[KEY] as CommandMetric[] | undefined) ?? [];
    const result = change(rows);
    await chrome.storage.local.set({ [KEY]: rows.slice(-MAX_ROWS) });
    return result;
  });
  writes = next.catch(() => undefined);
  return next;
}

export function recordMetric(metric: CommandMetric): Promise<void> {
  return update((rows) => void rows.push(metric));
}

export async function loadMetrics(): Promise<CommandMetric[]> {
  const stored = await chrome.storage.local.get(KEY);
  return (stored[KEY] as CommandMetric[] | undefined) ?? [];
}

export async function clearMetrics() {
  await chrome.storage.local.remove(KEY);
}

export function toCsv(rows: CommandMetric[]): string {
  const cols: (keyof CommandMetric)[] = [
    "t", "command", "path", "intent", "ms", "routerMs", "modelMs", "steps", "model", "costUsd", "tokensIn", "tokensOut", "error",
    "heard", "recognizer", "alternatives", "confidence", "ending", "speechMs", "waitMs", "misheard",
  ];
  const cell = (v: unknown) => {
    const s = v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(","), ...rows.map((r) => cols.map((c) => cell(r[c])).join(","))].join("\n");
}

export function summarize(rows: CommandMetric[]) {
  const median = (xs: number[]) => {
    if (!xs.length) return 0;
    const s = [...xs].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  };
  const commands = rows.filter((r) => r.path !== "background");
  const fast = rows.filter((r) => r.path === "fast");
  const ai = rows.filter((r) => r.path === "ai");
  return {
    total: commands.length,
    fast: fast.length,
    ai: ai.length,
    errors: rows.filter((r) => r.path === "error").length,
    fastMedianMs: median(fast.map((r) => r.ms)),
    aiMedianMs: median(ai.map((r) => r.ms)),
    aiMedianSteps: median(ai.map((r) => r.steps ?? 0)),
    costUsd: rows.reduce((sum, r) => sum + (Number.isFinite(r.costUsd) ? (r.costUsd as number) : 0), 0),
  };
}
