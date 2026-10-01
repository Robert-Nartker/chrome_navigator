// Checks an AI provider key before Navi relies on it, using the provider's free model list: the key
// works, and the models Navi would use are on the account.

import Anthropic from "@anthropic-ai/sdk";
import { type ApiProvider, PROVIDER_DEFAULTS } from "./models";

export interface KeyCheck {
  ok: boolean;
  /** Why the key didn't work, in words the user can act on. */
  message: string;
  /** Wanted models the account doesn't list (the key still works). */
  missing: string[];
}

/** Which provider a pasted key belongs to, when its prefix says so. */
export function providerOfKey(key: string): ApiProvider | undefined {
  if (key.startsWith("sk-ant-")) return "anthropic";
  if (key.startsWith("sk-")) return "openai";
  return undefined;
}

export async function checkKey(provider: ApiProvider, key: string, wanted: string[]): Promise<KeyCheck> {
  const name = PROVIDER_DEFAULTS[provider].name;
  let ids: string[];
  try {
    ids = provider === "openai" ? await openaiModels(key) : await anthropicModels(key);
  } catch (err) {
    const status = (err as { status?: number }).status;
    const message =
      status === 401 || status === 403
        ? `${name} rejected that key. Check that you copied all of it.`
        : status === 429
          ? `${name} says the account is out of credit or rate-limited. Check billing at ${name}, then try again.`
          : status
            ? `${name} returned an error (${status}). Try again in a moment.`
            : `Couldn't reach ${name}. Check your internet connection.`;
    return { ok: false, message, missing: [] };
  }
  // Accounts may list a dated ID (model-20260101) for an alias that works (model).
  const listed = (m: string) => ids.includes(m) || ids.some((id) => id.startsWith(`${m}-`));
  return { ok: true, message: "", missing: wanted.filter((m) => !listed(m)) };
}

async function openaiModels(key: string): Promise<string[]> {
  const res = await fetch("https://api.openai.com/v1/models", { headers: { authorization: `Bearer ${key}` } });
  if (!res.ok) throw Object.assign(new Error(`OpenAI ${res.status}`), { status: res.status });
  const body = (await res.json()) as { data?: { id: string }[] };
  return (body.data ?? []).map((m) => m.id);
}

async function anthropicModels(key: string): Promise<string[]> {
  const client = new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true, maxRetries: 0, timeout: 15_000 });
  const ids: string[] = [];
  for await (const model of client.models.list()) ids.push(model.id);
  return ids;
}
