// Local usage log: one row per command (path, latency, steps). Useful for the
// evaluation section of the project; stays in this browser unless exported.

export interface CommandMetric {
  t: string;
  command: string;
  /** "fast" = handled without AI, "ai" = Claude agent. */
  path: "fast" | "ai" | "error" | "cancelled" | "ignored";
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
}

const KEY = "metrics";
const MAX_ROWS = 2000;

export async function recordMetric(metric: CommandMetric) {
  const stored = await chrome.storage.local.get(KEY);
  const rows = ((stored[KEY] as CommandMetric[] | undefined) ?? []).concat(metric).slice(-MAX_ROWS);
  await chrome.storage.local.set({ [KEY]: rows });
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
  const fast = rows.filter((r) => r.path === "fast");
  const ai = rows.filter((r) => r.path === "ai");
  return {
    total: rows.length,
    fast: fast.length,
    ai: ai.length,
    errors: rows.filter((r) => r.path === "error").length,
    fastMedianMs: median(fast.map((r) => r.ms)),
    aiMedianMs: median(ai.map((r) => r.ms)),
    aiMedianSteps: median(ai.map((r) => r.steps ?? 0)),
    costUsd: rows.reduce((sum, r) => sum + (Number.isFinite(r.costUsd) ? (r.costUsd as number) : 0), 0),
  };
}
