// Router: a small fast model looks at speech the fast path didn't recognize and
// decides, in well under a second, whether it's (a) a built-in or personal
// command in other words ("Havi go to sleep", "scroll down a smidge more"),
// (b) a real task for the main AI, or (c) noise to ignore silently.

import Anthropic from "@anthropic-ai/sdk";
import type { Settings } from "./settings";

export type RouteDecision =
  | { route: "command"; command: string }
  | { route: "agent" }
  | { route: "ignore" };

const SYSTEM_PROMPT = `You route voice input for Navi, a hands-free browser assistant. The text comes from speech recognition, so it may be misheard, cut off, or not meant for Navi at all. Decide what it is:

"command": it's one of Navi's commands below, possibly misheard or phrased loosely. Put the exact command text to run in "command", with any details filled in (e.g. "search youtube for lofi beats", "open github.com", "click sign in", "type hello world", "switch to tab 2"). Personal commands are listed in the message; return their phrase with any {placeholders} filled in.
"agent": a genuine request that needs understanding the page, several steps, writing, or answering a question (e.g. "open google docs and write a workout plan", "reply to Sarah that I'm running late", "what's this article about", "add the cheapest one to my cart", "add a command that opens wordle").
"ignore": not a request to Navi: noise transcribed as words ("tiktok tiktok", "click click"), filler, fragments, song lyrics or video audio, or someone talking to another person.

Built-in commands:
scroll down / up / to the top / to the bottom (optionally "a little", "a lot"); page up / page down
go back; go forward; refresh
new tab; close tab; next tab; previous tab; reopen closed tab; switch to tab <n>; switch to <site or title>; what tabs are open
open <site or URL> (optionally "in a new tab"); search for <query>; search <youtube|amazon|wikipedia|reddit|github|maps|spotify|images> for <query>; search this site for <query>
show numbers; hide numbers; click <number>; click <button or link name>
show grid; hide grid
type <text>; type <text> and press enter; press enter; escape
pause; play; skip ahead <n> seconds; rewind <n> seconds; mute; unmute; full screen
zoom in; zoom out; reset zoom
read this page; where am I; what can I say
go to sleep; stop

Prefer "command" when the intent clearly matches one. Prefer "ignore" over guessing when the text doesn't sound like an instruction.`;

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
): Promise<RouteDecision> {
  const client = new Anthropic({ apiKey: settings.apiKey, dangerouslyAllowBrowser: true, maxRetries: 0, timeout: 5000 });
  const personal = context.personalPhrases.length ? context.personalPhrases.join("; ") : "(none)";
  const response = await client.messages.create(
    {
      model: settings.routerModel,
      max_tokens: 256,
      system: SYSTEM_PROMPT,
      output_config: { format: { type: "json_schema", schema: SCHEMA } },
      messages: [
        {
          role: "user",
          content: `Personal commands: ${personal}\nCurrent page: ${context.title ?? "unknown"}\nHeard: "${utterance}"`,
        },
      ],
    },
    { signal },
  );
  const text = response.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text ?? "";
  try {
    const parsed = JSON.parse(text) as { route?: string; command?: string };
    if (parsed.route === "command" && parsed.command?.trim()) return { route: "command", command: parsed.command.trim() };
    if (parsed.route === "ignore") return { route: "ignore" };
  } catch {
    // Unreadable answer: let the main AI handle it.
  }
  return { route: "agent" };
}
