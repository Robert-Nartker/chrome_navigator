// One quick question to a small model with reasoning off: the router's "what was that?", and the
// background job that keeps Navi's memory up to date. OpenAI, Claude, or Navi Free's on-device model.

import Anthropic from "@anthropic-ai/sdk";
import { NO_USAGE, type Usage, claudeReasoning, claudeUsage, costOf, effortFor, modelInfo } from "./models";
import { askNano } from "./nano";
import { createResponse, outputText, usageOf } from "./openai";
import { keyFor, type Settings } from "./settings";

export interface QuickRequest {
  model: string;
  /** Instructions: the same on every call, so providers can cache them. */
  system: string;
  text: string;
  /** A JSON schema for the reply (named `schemaName`), or plain text without one. */
  schema?: Record<string, unknown>;
  schemaName?: string;
  maxTokens: number;
  timeoutMs: number;
  /** OpenAI's prompt cache key (calls with the same instructions share it). */
  cacheKey: string;
  settings: Settings;
  signal: AbortSignal;
}

export interface QuickReply {
  text: string;
  usage: Usage;
  costUsd: number;
}

export async function askQuick(req: QuickRequest): Promise<QuickReply> {
  const { provider } = modelInfo(req.model);
  const { text, usage } =
    provider === "chrome"
      ? { text: await askNano({ system: req.system, text: req.text, schema: req.schema }), usage: NO_USAGE }
      : provider === "openai"
        ? await askOpenAI(req)
        : await askClaude(req);
  return { text, usage, costUsd: costOf(req.model, usage) };
}

async function askClaude(req: QuickRequest) {
  const client = new Anthropic({ apiKey: keyFor(req.settings, req.model), dangerouslyAllowBrowser: true, maxRetries: 0, timeout: req.timeoutMs });
  // No thinking where the model allows it (Sonnet 5.5 does).
  const { thinking, effort } = claudeReasoning(req.model, "none");
  const response = await client.messages.create(
    {
      model: req.model,
      max_tokens: req.maxTokens,
      // The SDK's types don't list Sonnet 5.5's thinking-off mode yet.
      ...(thinking ? { thinking: thinking as unknown as Anthropic.ThinkingConfigParam } : {}),
      system: req.system,
      cache_control: { type: "ephemeral" },
      output_config: { effort, ...(req.schema ? { format: { type: "json_schema", schema: req.schema } } : {}) },
      messages: [{ role: "user", content: req.text }],
    },
    { signal: req.signal },
  );
  return {
    text: response.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text ?? "",
    usage: claudeUsage(response.usage),
  };
}

async function askOpenAI(req: QuickRequest) {
  const response = await createResponse(
    keyFor(req.settings, req.model),
    {
      model: req.model,
      instructions: req.system,
      input: req.text,
      // The lowest reasoning the model allows.
      reasoning: { effort: effortFor(req.model, "none") },
      ...(req.schema ? { text: { format: { type: "json_schema", name: req.schemaName ?? "reply", schema: req.schema, strict: true } } } : {}),
      max_output_tokens: req.maxTokens,
      prompt_cache_key: req.cacheKey,
    },
    req.signal,
    req.timeoutMs,
  );
  return { text: outputText(response).text, usage: usageOf(response) };
}
