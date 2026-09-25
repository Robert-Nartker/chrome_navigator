// Minimal OpenAI Responses API client (fetch only, so it runs in the side panel).
// store:false keeps responses out of OpenAI's 30-day conversation storage; Navi keeps
// the conversation itself and sends it back each step.

import type { Usage } from "./models";

const URL = "https://api.openai.com/v1/responses";

export interface FunctionCallItem {
  type: "function_call";
  id?: string;
  call_id: string;
  name: string;
  arguments: string;
}

export interface OutputMessageItem {
  type: "message";
  role: "assistant";
  content: ({ type: "output_text"; text: string } | { type: "refusal"; refusal: string })[];
}

/** Items Navi sends or receives; anything else (e.g. reasoning) is passed back as-is. */
export type ResponseItem =
  | FunctionCallItem
  | OutputMessageItem
  | { type: "function_call_output"; call_id: string; output: string }
  | {
      type?: "message";
      role: "user";
      content: string | ({ type: "input_text"; text: string } | { type: "input_image"; image_url: string })[];
    }
  | { type: string; [key: string]: unknown };

export interface OpenAIResponse {
  status?: string;
  output: ResponseItem[];
  incomplete_details?: { reason?: string } | null;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    input_tokens_details?: { cached_tokens?: number };
  };
}

export class OpenAIError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function createResponse(
  apiKey: string,
  body: Record<string, unknown>,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<OpenAIResponse> {
  const res = await fetch(URL, {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ store: false, ...body }),
    signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
  });
  if (!res.ok) {
    const detail = ((await res.json().catch(() => null)) as { error?: { message?: string; code?: string } } | null)?.error;
    if (res.status === 401) throw new OpenAIError("OpenAI rejected the API key. Check it in Navi's settings.", 401);
    if (detail?.code === "insufficient_quota") throw new OpenAIError("Your OpenAI account is out of credit.", 429);
    throw new OpenAIError(`OpenAI error ${res.status}: ${detail?.message ?? res.statusText}`, res.status);
  }
  return (await res.json()) as OpenAIResponse;
}

export function usageOf(response: OpenAIResponse): Usage {
  const total = response.usage?.input_tokens ?? 0;
  const cached = response.usage?.input_tokens_details?.cached_tokens ?? 0;
  return { input: total - cached, cachedInput: cached, cacheWrite: 0, output: response.usage?.output_tokens ?? 0 };
}

/** The assistant's text, and whether it refused. */
export function outputText(response: OpenAIResponse): { text: string; refused: boolean } {
  let text = "";
  let refused = false;
  for (const item of response.output) {
    if (item.type !== "message") continue;
    for (const part of (item as OutputMessageItem).content) {
      if (part.type === "output_text") text += part.text;
      else if (part.type === "refusal") refused = true;
    }
  }
  return { text: text.trim(), refused };
}

export function functionCalls(response: OpenAIResponse): FunctionCallItem[] {
  return response.output.filter((item): item is FunctionCallItem => item.type === "function_call");
}
