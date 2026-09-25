// The AI models Navi can use, what they cost, and how much they can think.
// Prices are USD per million tokens. Check them against the vendor pages before
// quoting numbers: GPT-6 figures came from launch coverage, not OpenAI's own page.

export type Provider = "anthropic" | "openai";

/** How much the model reasons before answering. "none" = no reasoning at all. */
export type Effort = "none" | "low" | "medium" | "high";

export type Role = "agent" | "router";

export interface ModelInfo {
  id: string;
  label: string;
  provider: Provider;
  roles: Role[];
  /** Reasoning levels the model accepts, lowest first. */
  efforts: Effort[];
  price: { input: number; cachedInput: number; cacheWrite: number; output: number };
  priceNote: string;
}

export const MODEL_CATALOG: ModelInfo[] = [
  {
    id: "claude-opus-5-5",
    label: "Claude Opus 5.5",
    provider: "anthropic",
    roles: ["agent"],
    efforts: ["low", "medium", "high"],
    price: { input: 4, cachedInput: 0.4, cacheWrite: 5, output: 20 },
    priceNote: "Anthropic pricing page (Sep 2026)",
  },
  {
    id: "gpt-6-astra",
    label: "GPT-6 Astra",
    provider: "openai",
    roles: ["agent"],
    efforts: ["low", "medium", "high"],
    price: { input: 10, cachedInput: 1, cacheWrite: 10, output: 50 },
    priceNote: "launch coverage (unverified); cached input assumed 10%",
  },
  {
    id: "gpt-6-sol",
    label: "GPT-6 Sol",
    provider: "openai",
    roles: ["agent", "router"],
    efforts: ["none", "low", "medium", "high"],
    price: { input: 2, cachedInput: 0.2, cacheWrite: 2, output: 10 },
    priceNote: "launch coverage (unverified); cached input assumed 10%",
  },
  {
    id: "gpt-6-luna",
    label: "GPT-6 Luna",
    provider: "openai",
    roles: ["agent", "router"],
    efforts: ["none", "low", "medium", "high"],
    price: { input: 0.1, cachedInput: 0.01, cacheWrite: 0.1, output: 0.5 },
    priceNote: "launch coverage (unverified); cached input assumed 10%",
  },
  {
    id: "claude-sonnet-5",
    label: "Claude Sonnet 5",
    provider: "anthropic",
    roles: ["router"],
    efforts: ["none", "low", "medium", "high"],
    price: { input: 2, cachedInput: 0.2, cacheWrite: 2.5, output: 10 },
    priceNote: "Anthropic models page (Sep 2026)",
  },
  {
    id: "claude-haiku-4-5",
    label: "Claude Haiku 4.5",
    provider: "anthropic",
    roles: ["router"],
    // Haiku 4.5 doesn't reason unless asked to, and takes no effort setting.
    efforts: ["none"],
    price: { input: 1, cachedInput: 0.1, cacheWrite: 1.25, output: 5 },
    priceNote: "Anthropic pricing page",
  },
];

export function modelInfo(id: string): ModelInfo {
  const known = MODEL_CATALOG.find((m) => m.id === id);
  if (known) return known;
  // A model we don't list (e.g. typed into the benchmark): infer the provider, price unknown.
  const provider: Provider = /^(gpt|o\d|chatgpt)/.test(id) ? "openai" : "anthropic";
  const nan = Number.NaN;
  return {
    id,
    label: id,
    provider,
    roles: ["agent", "router"],
    efforts: ["none", "low", "medium", "high"],
    price: { input: nan, cachedInput: nan, cacheWrite: nan, output: nan },
    priceNote: "unknown",
  };
}

/** The requested effort if the model supports it, otherwise the nearest level it does. */
export function effortFor(id: string, wanted: Effort): Effort {
  const { efforts } = modelInfo(id);
  if (efforts.includes(wanted)) return wanted;
  const order: Effort[] = ["none", "low", "medium", "high"];
  const rank = order.indexOf(wanted);
  return efforts.find((e) => order.indexOf(e) >= rank) ?? efforts[efforts.length - 1];
}

/** Token counts for one or more model calls. `input` excludes cached and cache-write tokens. */
export interface Usage {
  input: number;
  cachedInput: number;
  cacheWrite: number;
  output: number;
}

export const NO_USAGE: Usage = { input: 0, cachedInput: 0, cacheWrite: 0, output: 0 };

export function addUsage(a: Usage, b: Usage): Usage {
  return {
    input: a.input + b.input,
    cachedInput: a.cachedInput + b.cachedInput,
    cacheWrite: a.cacheWrite + b.cacheWrite,
    output: a.output + b.output,
  };
}

/** Dollar cost of the given usage (NaN if the model's price is unknown). */
export function costOf(id: string, u: Usage): number {
  const p = modelInfo(id).price;
  return (u.input * p.input + u.cachedInput * p.cachedInput + u.cacheWrite * p.cacheWrite + u.output * p.output) / 1e6;
}

export function formatCost(usd: number | undefined): string {
  if (usd === undefined || Number.isNaN(usd)) return "$?";
  if (usd === 0) return "$0";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(usd < 1 ? 3 : 2)}`;
}
