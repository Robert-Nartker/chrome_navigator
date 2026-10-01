// The AI models Navi can use, what they cost, and how much they can think.
// Prices are USD per million tokens. Check them against the vendor pages before
// quoting numbers: GPT-6 figures came from launch coverage, not OpenAI's own page.

/** Providers reached with the user's own API key. */
export type ApiProvider = "anthropic" | "openai";
/** "chrome": Chrome's built-in on-device model (Navi Free). */
export type Provider = ApiProvider | "chrome";

/** How much the model reasons before answering. "none" = no reasoning at all. */
export type Effort = "none" | "low" | "medium" | "high" | "xhigh" | "max";

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

// Current-generation models only. Menus list them in this order (each provider's defaults first).
export const MODEL_CATALOG: ModelInfo[] = [
  {
    id: "gpt-6.1-sol",
    label: "GPT-6.1 Sol",
    provider: "openai",
    roles: ["agent", "router"],
    // Unlike GPT-6 Sol it can't turn reasoning off; "low" is the least.
    efforts: ["low", "medium", "high", "xhigh", "max"],
    price: { input: 2, cachedInput: 0.1, cacheWrite: 2, output: 10 },
    priceNote: "launch coverage (unverified)",
  },
  {
    id: "gpt-6-luna",
    label: "GPT-6 Luna",
    provider: "openai",
    roles: ["router", "agent"],
    efforts: ["none", "low", "medium", "high", "xhigh", "max"],
    price: { input: 0.1, cachedInput: 0.01, cacheWrite: 0.1, output: 0.5 },
    priceNote: "launch coverage (unverified); cached input assumed 10%",
  },
  {
    id: "claude-sonnet-5-5",
    label: "Claude Sonnet 5.5",
    provider: "anthropic",
    roles: ["agent", "router"],
    // "none" turns thinking off (Anthropic's lowest setting, "between_tools", allowed at high effort or below).
    efforts: ["none", "low", "medium", "high", "xhigh", "max"],
    price: { input: 2, cachedInput: 0.2, cacheWrite: 2.5, output: 10 },
    priceNote: "Anthropic pricing (Sep 2026)",
  },
  {
    id: "claude-opus-5-5",
    label: "Claude Opus 5.5",
    provider: "anthropic",
    roles: ["agent"],
    // Always thinks; "low" is the least.
    efforts: ["low", "medium", "high", "xhigh", "max"],
    price: { input: 4, cachedInput: 0.2, cacheWrite: 5, output: 20 },
    priceNote: "Anthropic pricing (Sep 2026)",
  },
  {
    // Navi Free: Chrome's built-in model, on this computer. Not in the model menus; the Free/Pro switch picks it.
    id: "gemini-nano",
    label: "Gemini Nano (on-device)",
    provider: "chrome",
    roles: [],
    efforts: ["none"],
    price: { input: 0, cachedInput: 0, cacheWrite: 0, output: 0 },
    priceNote: "free: runs on this computer",
  },
  {
    id: "gpt-6-astra",
    label: "GPT-6 Astra",
    provider: "openai",
    roles: ["agent"],
    efforts: ["low", "medium", "high", "xhigh", "max"],
    price: { input: 10, cachedInput: 1, cacheWrite: 10, output: 50 },
    priceNote: "launch coverage (unverified); cached input assumed 10%",
  },
];

/** What Navi uses with each provider's key: a thinking-off model for quick checks, a low-reasoning one for tasks. */
export const PROVIDER_DEFAULTS: Record<ApiProvider, { name: string; model: string; effort: Effort; routerModel: string }> = {
  openai: { name: "OpenAI", model: "gpt-6.1-sol", effort: "low", routerModel: "gpt-6-luna" },
  anthropic: { name: "Anthropic", model: "claude-sonnet-5-5", effort: "low", routerModel: "claude-sonnet-5-5" },
};

/** Models Navi no longer offers, and what replaces them in saved settings. */
export const RETIRED_MODELS: Record<string, string> = {
  "gpt-6-sol": "gpt-6.1-sol",
  "claude-sonnet-5": "claude-sonnet-5-5",
  "claude-haiku-4-5": "claude-sonnet-5-5",
};

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
  const order: Effort[] = ["none", "low", "medium", "high", "xhigh", "max"];
  const rank = order.indexOf(wanted);
  return efforts.find((e) => order.indexOf(e) >= rank) ?? efforts[efforts.length - 1];
}

/**
 * Claude request settings for a reasoning level. "none" is Sonnet 5.5's thinking-off mode
 * ("between_tools", at low effort); other levels keep adaptive thinking at that effort.
 */
export function claudeReasoning(id: string, wanted: Effort): { thinking?: { type: "between_tools" }; effort: Exclude<Effort, "none"> } {
  const effort = effortFor(id, wanted);
  return effort === "none" ? { thinking: { type: "between_tools" }, effort: "low" } : { effort };
}

/** Token counts for one or more model calls. `input` excludes cached and cache-write tokens. */
export interface Usage {
  input: number;
  cachedInput: number;
  cacheWrite: number;
  output: number;
}

export const NO_USAGE: Usage = { input: 0, cachedInput: 0, cacheWrite: 0, output: 0 };

/** Token counts from a Claude response's usage. */
export function claudeUsage(u: {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}): Usage {
  return { input: u.input_tokens, cachedInput: u.cache_read_input_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0, output: u.output_tokens };
}

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
