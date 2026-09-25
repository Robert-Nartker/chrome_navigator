// Router: a small fast model looks at speech the fast path didn't recognize and
// decides, in well under a second, whether it's (a) a built-in or personal
// command in other words ("Havi go to sleep", "scroll down a smidge more"),
// (b) a real task for the main AI, or (c) noise to ignore silently.

import Anthropic from "@anthropic-ai/sdk";
import { type Usage, costOf, effortFor, modelInfo } from "./models";
import { createResponse, outputText, usageOf } from "./openai";
import { keyFor, type Settings } from "./settings";

export type RouteDecision =
  | { route: "command"; command: string }
  | { route: "agent" }
  | { route: "ignore" };

export interface RouteResult {
  decision: RouteDecision;
  usage: Usage;
  costUsd: number;
}

const TIMEOUT_MS = 5000;

const SYSTEM_PROMPT = `You route voice input for Navi, a hands-free browser assistant. The text comes from speech recognition, so it may be misheard, cut off, or not meant for Navi at all. Decide what it is:

"command": it's one of Navi's commands below, possibly misheard or phrased loosely. Put the exact command text to run in "command", with any details filled in (e.g. "search youtube for lofi beats", "open github.com", "click sign in", "type hello world", "switch to tab 2"). Personal commands are listed in the message; return their phrase with any {placeholders} filled in.
"agent": a genuine request that needs understanding the page, several steps, writing, or answering a question (e.g. "open google docs and write a workout plan", "reply to Sarah that I'm running late", "what's this article about", "add the cheapest one to my cart", "add a command that opens wordle").
"ignore": not a request to Navi: noise transcribed as words ("tiktok tiktok", "click click"), filler, fragments, song lyrics or video audio, or someone talking to another person.

Built-in commands:
scroll down / up / to the top / to the bottom (optionally "a little", "a lot"); page up / page down
start scrolling (auto-scroll); stop scrolling; scroll faster; scroll slower
go back; go back <n> pages; go forward; refresh; go home (site home page); next page (pagination)
new tab; new window; close tab; close other tabs; duplicate tab; pin tab; next tab; previous tab; first tab; last tab; switch back; reopen closed tab; switch to tab <n>; switch to <site or title>; what tabs are open
find <text> (on this page); find next; select all; undo; clear it; new line; print
what did you say; talk louder; talk quieter; talk faster; talk slower; what time is it; what's the date
open <site or URL> (optionally "in a new tab"); search for <query>; search <youtube|amazon|wikipedia|reddit|github|maps|spotify|images> for <query> (optionally "in a new tab"); search this site for <query>
show numbers; hide numbers; click <number>; click <button or link name>
show grid; hide grid
type <text>; type <text> and press enter; press enter; escape
pause; play; skip ahead <n> seconds; rewind <n> seconds; mute; unmute; full screen; exit full screen; speed up; slow down; normal speed; volume up; volume down; restart the video
zoom in; zoom out; reset zoom
read this page; where am I; what can I say
go to sleep; stop

Choose "command" only when that one command does the whole request, keeping its details (e.g. "in a new tab"). If the request needs more than one step, such as searching and then opening, playing, or picking a result ("play a funny video", "open the first result", "find a recipe and save it"), choose "agent". Prefer "ignore" over guessing when the text doesn't sound like an instruction.`;

const SCHEMA = {
  type: "object",
  properties: {
    route: { type: "string", enum: ["command", "agent", "ignore"] },
    command: { type: "string", description: "The command to run when route is command; otherwise empty." },
  },
  required: ["route", "command"],
  additionalProperties: false,
};

export async function routeUtterance(
  utterance: string,
  context: { title?: string; personalPhrases: string[] },
  settings: Settings,
  signal: AbortSignal,
): Promise<RouteResult> {
  const model = settings.routerModel;
  const personal = context.personalPhrases.length ? context.personalPhrases.join("; ") : "(none)";
  const message = `Personal commands: ${personal}\nCurrent page: ${context.title ?? "unknown"}\nHeard: "${utterance}"`;
  const { text, usage } =
    modelInfo(model).provider === "openai"
      ? await askOpenAI(model, message, settings, signal)
      : await askClaude(model, message, settings, signal);
  return { decision: parseDecision(text), usage, costUsd: costOf(model, usage) };
}

async function askClaude(model: string, message: string, settings: Settings, signal: AbortSignal) {
  const client = new Anthropic({ apiKey: keyFor(settings, model), dangerouslyAllowBrowser: true, maxRetries: 0, timeout: TIMEOUT_MS });
  const response = await client.messages.create(
    {
      model,
      max_tokens: 256,
      // Routing is a quick classification: skip extended thinking where the model allows it.
      ...(model.startsWith("claude-sonnet-5") ? { thinking: { type: "disabled" as const } } : {}),
      system: SYSTEM_PROMPT,
      output_config: { format: { type: "json_schema", schema: SCHEMA } },
      messages: [{ role: "user", content: message }],
    },
    { signal },
  );
  return {
    text: response.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text ?? "",
    usage: {
      input: response.usage.input_tokens,
      cachedInput: response.usage.cache_read_input_tokens ?? 0,
      cacheWrite: response.usage.cache_creation_input_tokens ?? 0,
      output: response.usage.output_tokens,
    },
  };
}

async function askOpenAI(model: string, message: string, settings: Settings, signal: AbortSignal) {
  const response = await createResponse(
    keyFor(settings, model),
    {
      model,
      instructions: SYSTEM_PROMPT,
      input: message,
      // The lowest reasoning the model allows: routing must answer in well under a second.
      reasoning: { effort: effortFor(model, "none") },
      text: { format: { type: "json_schema", name: "route", schema: SCHEMA, strict: true } },
      max_output_tokens: 256,
      prompt_cache_key: "navi-router",
    },
    signal,
    TIMEOUT_MS,
  );
  return { text: outputText(response).text, usage: usageOf(response) };
}

/** Anything unreadable goes to the main AI. */
export function parseDecision(text: string): RouteDecision {
  try {
    const parsed = JSON.parse(text) as { route?: string; command?: string };
    if (parsed.route === "command" && parsed.command?.trim()) return { route: "command", command: parsed.command.trim() };
    if (parsed.route === "ignore") return { route: "ignore" };
  } catch {
    // Fall through.
  }
  return { route: "agent" };
}
