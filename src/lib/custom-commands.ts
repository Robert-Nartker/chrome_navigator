// Personal voice commands ("open wordle", "study mode", "play {song} on spotify").
// Created by asking the AI or from the settings page; stored in chrome.storage.sync
// so they follow you to every computer signed into the same Chrome profile.
//
// A command is a list of steps, and each step is either "open this URL" or
// "run this spoken command". So a custom command can only do what you could
// already say out loud: no settings, no scripts, no access to anything else.

import { normalize, parseCommand } from "./parser";

export type Step = { type: "open"; url: string; newTab: boolean } | { type: "run"; command: string };

export interface CustomCommand {
  id: string;
  phrases: string[];
  steps: Step[];
  description: string;
  updatedAt: string;
}

export interface CommandInput {
  phrases: string[];
  steps: Step[];
  description?: string;
}

const KEY_PREFIX = "cmd:";
const MAX_STEPS = 10;
export const MAX_DEPTH = 3;

/** Built-ins that must always work, whatever the user defines. */
const PROTECTED_INTENTS = new Set(["stop", "sleep", "help"]);
/** Specific built-ins a custom phrase may not shadow (generic ones like "open X" or "click X" can be customized). */
const RESERVED_INTENTS = new Set([
  "scroll", "back", "forward", "reload", "newTab", "closeTab", "nextTab", "prevTab", "reopenTab", "switchTab",
  "listTabs", "clickNumber", "showNumbers", "hideNumbers", "pressKey", "media", "zoom", "muteTab", "readPage", "whereAmI",
  "showGrid", "hideGrid", "repeat", "ack", "voice", "autoScroll", "fasterSlower", "siteHome", "backN", "nextPage",
  "newWindow", "closeOtherTabs", "duplicateTab", "pinTab", "switchBack", "edit", "print", "time", "date",
]);
const LIST_PHRASES = /^(?:what are my commands|list (?:my )?(?:custom )?commands|my commands|show (?:my )?commands)$/;

export function isListCommandsRequest(text: string): boolean {
  return LIST_PHRASES.test(normalize(text));
}

function normalizePhrase(phrase: string): string {
  // Keep {placeholders} intact while normalizing the rest like spoken input.
  const slots: string[] = [];
  const masked = phrase.replace(/\{\s*([a-z][a-z0-9_]*)\s*\}/gi, (_m, name: string) => {
    slots.push(name.toLowerCase());
    return `slot${slots.length - 1}x`;
  });
  return normalize(masked).replace(/slot(\d+)x/g, (_m, i: string) => `{${slots[Number(i)]}}`);
}

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function phraseRegex(phrase: string): { re: RegExp; names: string[] } {
  const names: string[] = [];
  const pattern = phrase
    .split(/(\{[a-z0-9_]+\})/)
    .map((part) => {
      const m = part.match(/^\{([a-z0-9_]+)\}$/);
      if (m) {
        names.push(m[1]);
        return "(.+?)";
      }
      return escapeRegExp(part);
    })
    .join("");
  return { re: new RegExp(`^${pattern}$`), names };
}

export interface CommandMatch {
  command: CustomCommand;
  params: Record<string, string>;
}

/** Finds the custom command for an utterance. Exact phrases win over ones with placeholders. */
export function matchCommand(text: string, commands: CustomCommand[]): CommandMatch | null {
  const t = normalize(text);
  if (!t) return null;
  let best: CommandMatch | null = null;
  for (const command of commands) {
    for (const phrase of command.phrases) {
      const { re, names } = phraseRegex(phrase);
      const m = t.match(re);
      if (!m) continue;
      const params = Object.fromEntries(names.map((n, i) => [n, m[i + 1]]));
      if (names.length === 0) return { command, params };
      best ??= { command, params };
    }
  }
  return best;
}

/** Fills {placeholders} in a step. URL values are URL-encoded. */
export function fillStep(step: Step, params: Record<string, string>): Step {
  const fill = (s: string, encode: boolean) =>
    s.replace(/\{([a-z0-9_]+)\}/gi, (_m, name: string) => {
      const value = params[name.toLowerCase()] ?? "";
      return encode ? encodeURIComponent(value) : value;
    });
  return step.type === "open"
    ? { ...step, url: fill(step.url, true) }
    : { ...step, command: fill(step.command, false) };
}

export function describeStep(step: Step): string {
  return step.type === "open" ? `open ${step.url}${step.newTab ? " in a new tab" : ""}` : `“${step.command}”`;
}

export function describeCommand(c: CustomCommand): string {
  return `“${c.phrases.join("” / “")}” → ${c.steps.map(describeStep).join(", then ")}`;
}

/** Checks a command before saving. Returns the cleaned command or throws with a user-facing reason. */
export function validateCommand(input: CommandInput, existing: CustomCommand[], replacingId?: string): CommandInput {
  const phrases = [...new Set(input.phrases.map(normalizePhrase).filter(Boolean))];
  if (phrases.length === 0) throw new Error("A command needs at least one phrase to say.");
  for (const phrase of phrases) {
    const sample = phrase.replace(/\{[a-z0-9_]+\}/g, "something");
    const builtIn = parseCommand(sample);
    if (builtIn && PROTECTED_INTENTS.has(builtIn.type)) {
      throw new Error(`“${phrase}” is a core command and can't be changed.`);
    }
    if (builtIn && RESERVED_INTENTS.has(builtIn.type)) {
      throw new Error(`“${phrase}” is already a built-in command. Pick a different phrase.`);
    }
    if (isListCommandsRequest(sample)) throw new Error(`“${phrase}” is reserved for listing your commands.`);
    const owner = existing.find((c) => c.id !== replacingId && c.phrases.includes(phrase));
    if (owner) throw new Error(`“${phrase}” is already used by another command (${describeCommand(owner)}).`);
  }
  const steps = input.steps.slice(0, MAX_STEPS).map((step): Step => {
    if (step.type === "open") {
      const url = step.url.trim();
      if (!/^https?:\/\/[^\s]+$/i.test(url.replace(/\{[a-z0-9_]+\}/gi, "x"))) {
        throw new Error(`“${url}” isn't a web address (it must start with http:// or https://).`);
      }
      return { type: "open", url, newTab: !!step.newTab };
    }
    const command = step.command.trim();
    if (!command) throw new Error("A step is empty.");
    return { type: "run", command };
  });
  if (steps.length === 0) throw new Error("A command needs at least one step.");
  return { phrases, steps, description: input.description?.trim() ?? "" };
}

export async function loadCommands(): Promise<CustomCommand[]> {
  const all = await chrome.storage.sync.get(null);
  return Object.entries(all)
    .filter(([key]) => key.startsWith(KEY_PREFIX))
    .map(([, value]) => value as CustomCommand)
    .sort((a, b) => a.phrases[0].localeCompare(b.phrases[0]));
}

/** Creates a command, or replaces the one that already uses any of these phrases. */
export async function saveCommand(input: CommandInput): Promise<{ command: CustomCommand; replaced: boolean }> {
  const existing = await loadCommands();
  const wanted = input.phrases.map(normalizePhrase);
  const previous = existing.find((c) => c.phrases.some((p) => wanted.includes(p)));
  const clean = validateCommand(input, existing, previous?.id);
  const command: CustomCommand = {
    id: previous?.id ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    phrases: clean.phrases,
    steps: clean.steps,
    description: clean.description ?? "",
    updatedAt: new Date().toISOString(),
  };
  await chrome.storage.sync.set({ [KEY_PREFIX + command.id]: command });
  return { command, replaced: !!previous };
}

export async function deleteCommand(phraseOrId: string): Promise<CustomCommand | null> {
  const existing = await loadCommands();
  const target = normalizePhrase(phraseOrId);
  const found =
    existing.find((c) => c.id === phraseOrId) ??
    existing.find((c) => c.phrases.includes(target)) ??
    (() => {
      const m = matchCommand(phraseOrId, existing);
      return m?.command;
    })();
  if (!found) return null;
  await chrome.storage.sync.remove(KEY_PREFIX + found.id);
  return found;
}

export function onCommandsChanged(callback: () => void) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "sync" && Object.keys(changes).some((k) => k.startsWith(KEY_PREFIX))) callback();
  });
}
