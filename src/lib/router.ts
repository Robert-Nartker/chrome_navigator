// Router: a small fast model looks at speech the fast path didn't recognize and
// decides, in well under a second, whether it's (a) a built-in or personal
// command in other words ("Havi go to sleep", "scroll down a smidge more"),
// (b) a real task for the main AI, or (c) noise to ignore silently.

import type { Usage } from "./models";
import { askQuick } from "./quick-model";
import type { Settings } from "./settings";

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

/** Everything Navi does without an AI, one family per line (also what Navi Free can run). */
export const BUILT_IN_COMMANDS = `scroll down / up / to the top / to the bottom (optionally "a little", "a lot"); page up / page down
start scrolling (auto-scroll); stop scrolling; scroll faster; scroll slower
go back; go back <n> pages; go forward; refresh; go home (site home page); next page (pagination)
new tab; new window; close tab (the current one); close <site or title> tab; close other tabs; duplicate tab; pin tab; next tab; previous tab; first tab; last tab; switch back; reopen closed tab; switch to tab <n>; switch to <site or title>; what tabs are open
find <text> (on this page); find next; select all; undo; clear it; new line; print
what did you say; talk louder; talk quieter; talk faster; talk slower; what time is it; what's the date
open <site or URL> (opens it in a new tab); go to <site or URL> (in this tab); search for <query>; search <youtube|amazon|wikipedia|reddit|github|maps|spotify|images> for <query> (optionally "in a new tab"); search this site for <query>
flags (numbered tags on everything clickable); hide flags; click <number>; click <button or link name>
show grid; hide grid
type <text>; type <text> and press enter; press enter; escape
pause; play; skip ahead <n> seconds; rewind <n> seconds; mute; unmute; full screen; exit full screen; speed up; slow down; normal speed; volume up; volume down; volume <0-100>; restart the video
zoom in; zoom out; reset zoom
read this page; where am I; what can I say
new thread (a separate conversation; optionally "new thread about <topic>"); switch to the <name> thread; previous thread; list threads; rename this thread to <name>
pin Navi to this window (Navi then works only there, even while the user uses another window); unpin Navi
go to sleep; turn off (stops listening until turned back on); stop`;

/** One of the last few commands and what came of it: "ran", "AI task", "ignored", "failed", "cancelled". */
export interface RecentCommand {
  said: string;
  outcome: string;
  /** What Navi said back, if anything. */
  reply?: string;
}

export interface RouteContext {
  title?: string;
  personalPhrases: string[];
  /** The last few commands, oldest first (at most 3 are sent). */
  recent?: RecentCommand[];
}

/** What the router model gets besides its instructions (kept short: routing must stay fast). */
export function routerMessage(utterance: string, context: RouteContext): string {
  const lines = [
    `Personal commands: ${context.personalPhrases.length ? context.personalPhrases.join("; ") : "(none)"}`,
    `Current page: ${context.title ?? "unknown"}`,
  ];
  const recent = (context.recent ?? []).slice(-3);
  if (recent.length) {
    const one = (r: RecentCommand) =>
      `"${r.said.slice(0, 60)}" (${r.outcome}${r.reply ? `; Navi said "${r.reply.replace(/\s+/g, " ").slice(0, 100)}"` : ""})`;
    lines.push(`Before this: ${recent.map(one).join("; ")}`);
  }
  lines.push(`Heard: "${utterance}"`);
  return lines.join("\n");
}

export const SYSTEM_PROMPT = `You route voice input for Navi, a hands-free browser assistant. The text comes from speech recognition, so it may be misheard, cut off, or not meant for Navi at all. Decide what it is:

"command": it's one of Navi's commands below, possibly misheard or phrased loosely. Put the exact command text to run in "command", with any details filled in (e.g. "search youtube for lofi beats", "open github.com", "click sign in", "type hello world", "switch to tab 2"). Personal commands are listed in the message; return their phrase with any {placeholders} filled in.
"agent": a genuine request that needs understanding the page, several steps, writing, or answering a question (e.g. "open google docs and write a workout plan", "reply to Sarah that I'm running late", "what's this article about", "add the cheapest one to my cart", "add a command that opens wordle").
"ignore": not a request to Navi: noise transcribed as words ("tiktok tiktok", "click click"), filler, fragments, song lyrics or video audio, or someone talking to another person.

Built-in commands:
${BUILT_IN_COMMANDS}

Choose "command" only when that one command does the whole request, keeping its details (e.g. "in a new tab") and the user's verb: "open" opens a new tab, "go to" stays in this one. If the request needs more than one step, such as searching and then opening, playing, or picking a result ("play a funny video", "open the first result", "find a recipe and save it"), choose "agent". Never drop words that say which thing to act on ("close the recipe tab" is "close recipe tab", not "close tab"). A short request that refers to something on the page ("click the blue one", "open the second article") is "agent": the main AI sees the page. Text that doesn't read as a request to Navi (noise, fragments, someone else talking) is "ignore", unless it sounds like one of the commands.

Speech recognition swaps words that sound alike, so read the text by its sound, not its spelling, and when it sounds like a command, it's that command: "open new tube" is "open youtube", "open your tab" is "new tab", "close the tap" is "close tab", "flex" is "flags", "go bag" is "go back", "scroll dawn" is "scroll down".

"Before this" lists the last few commands, what came of them, and what Navi said. Short phrases like "turn it up", "turn it to 30", "more" or "the next one" mean something only in that context: use it to decide ("the next one" after "next tab" is "next tab"; "now search for lofi" after opening YouTube is "search youtube for lofi"; "turn it to 30" or "turn out more" after a volume change is "volume 30" or "volume down"; "unflag" after "flags" is "hide flags"). When the context is something else ("turn it to 30" after asking about a game's difficulty setting), or there's no context, choose "agent": it sees the page and the conversation. Judge the new text on its own: resembling an earlier command doesn't make it one.

A correction of the last command is a request, never noise, even when it's short or starts with "no": "on YouTube" or "no, on YouTube" after "search for lofi" is "search youtube for lofi"; "Mr Beast, not Mr Feast" after "search youtube for mr feast" is "search youtube for mr beast". When one command does the corrected request, return it; otherwise ("no, the other one", "that's the wrong video") choose "agent".`;

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
  context: RouteContext,
  settings: Settings,
  signal: AbortSignal,
): Promise<RouteResult> {
  const model = settings.routerModel;
  const reply = await askQuick({
    model,
    system: SYSTEM_PROMPT,
    text: routerMessage(utterance, context),
    schema: SCHEMA,
    schemaName: "route",
    // Routing must answer in well under a second.
    maxTokens: 256,
    timeoutMs: TIMEOUT_MS,
    cacheKey: "navi-router",
    settings,
    signal,
  });
  return { decision: parseDecision(reply.text), usage: reply.usage, costUsd: reply.costUsd };
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
