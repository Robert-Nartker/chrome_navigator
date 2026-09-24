// Fast path: turns common spoken commands into actions with no AI call, so they
// feel instant. Anything this doesn't recognize goes to the AI agent.

import type { Key, MediaAction, ScrollAmount, ScrollDirection } from "./protocol";
import { NUMBER_PATTERN, parseNumber } from "./numbers";
import { SEARCH_ENGINES, resolveSite, searchUrl } from "./sites";

export type Intent =
  | { type: "stop" }
  | { type: "sleep" }
  | { type: "help" }
  | { type: "scroll"; direction: ScrollDirection; amount: ScrollAmount }
  | { type: "back" }
  | { type: "forward" }
  | { type: "reload" }
  | { type: "newTab" }
  | { type: "closeTab" }
  | { type: "nextTab" }
  | { type: "prevTab" }
  | { type: "reopenTab" }
  | { type: "switchTab"; index?: number; query?: string }
  | { type: "listTabs" }
  | { type: "open"; url: string; newTab: boolean; label: string }
  | { type: "search"; url: string; query: string; engine: string; newTab: boolean }
  | { type: "clickNumber"; n: number }
  | { type: "clickText"; text: string }
  | { type: "showNumbers" }
  | { type: "hideNumbers" }
  | { type: "type"; text: string; target?: number; submit: boolean }
  | { type: "pressKey"; key: Key }
  | { type: "media"; action: MediaAction; seconds?: number }
  | { type: "zoom"; direction: "in" | "out" | "reset" }
  | { type: "muteTab"; muted: boolean }
  | { type: "readPage" }
  | { type: "whereAmI" };

const LEADING_FILLER =
  /^(?:(?:ok(?:ay)?|hey|so|um+|uh+|please|now|and|then|alright|all right|can you|could you|would you|will you|i want to|i'd like to|i would like to|let's|lets|go ahead and|just)\s+)+/;
const TRAILING_FILLER = /\s+(?:please|for me|now|thanks|thank you)$/;

export function normalize(text: string): string {
  let t = text
    .toLowerCase()
    .replace(/[“”"]/g, "")
    .replace(/[.!?,;]+$/g, "")
    .replace(/,/g, "")
    .replace(/\s+/g, " ")
    .trim();
  let prev = "";
  while (prev !== t) {
    prev = t;
    t = t.replace(LEADING_FILLER, "").replace(TRAILING_FILLER, "").trim();
  }
  return t;
}

export interface WakeWords {
  /** The name itself: "Navi, scroll down" works without "hey". */
  exact: string[];
  /** Likely mishearings ("navy"): only count after "hey"/"ok", since they're real words. */
  misheard: string[];
}

/** Strips the wake phrase ("hey navi", "navi,") from the start of an utterance. */
export function stripWakePhrase(text: string, words: WakeWords): { woke: boolean; rest: string } {
  const lower = text.toLowerCase().trim();
  const patterns = [
    ...words.exact.map((w) => `^(?:(?:hey|hi|ok(?:ay)?|yo)\\s+)?${escapeRegExp(w)}\\b`),
    ...words.misheard.map((w) => `^(?:hey|hi|ok(?:ay)?|yo)\\s+${escapeRegExp(w)}\\b`),
  ];
  for (const pattern of patterns) {
    const m = lower.match(new RegExp(`${pattern}[\\s,.!?]*`, "i"));
    if (m) return { woke: true, rest: text.trim().slice(m[0].length).trim() };
  }
  return { woke: false, rest: text.trim() };
}

/** Spellings speech engines produce for a wake name ("Navi" -> "navy", "navie"...). */
export function wakeAliases(name: string): WakeWords {
  const n = name.trim().toLowerCase();
  const misheard = n === "navi" ? ["navy", "navie", "navvy", "nabi", "nav e", "nave", "novi", "nobby", "knavey"] : [];
  return { exact: [n], misheard: misheard.sort((a, b) => b.length - a.length) };
}

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const N = NUMBER_PATTERN;
const ENGINE_NAMES = Object.keys(SEARCH_ENGINES)
  .sort((a, b) => b.length - a.length)
  .map(escapeRegExp)
  .join("|");

type Rule = [RegExp, (m: RegExpMatchArray) => Intent | null];

const RULES: Rule[] = [
  [/^(?:stop|cancel|never ?mind|shut up|be quiet|quiet|stop talking|stop reading|hush|silence)$/, () => ({ type: "stop" })],
  [
    /^(?:go to sleep|sleep|stop listening|that's all|that is all|goodbye|good bye|bye|(?:thanks|thank you) that's all|dismiss|pause listening)$/,
    () => ({ type: "sleep" }),
  ],
  [/^(?:help|what can (?:i|you) (?:say|do)|what are the commands|commands)$/, () => ({ type: "help" })],

  // Scrolling
  [/^(?:scroll |go )?(?:to )?(?:the )?(top|bottom)(?: of (?:the )?page)?$/, (m) => ({ type: "scroll", direction: m[1] as ScrollDirection, amount: "page" })],
  [/^scroll (?:all the way )?(?:up|down) to (?:the )?(top|bottom)$/, (m) => ({ type: "scroll", direction: m[1] as ScrollDirection, amount: "page" })],
  [/^page (up|down)$/, (m) => ({ type: "scroll", direction: m[1] as ScrollDirection, amount: "page" })],
  [
    /^(?:scroll|move|go)(?: (up|down|left|right))?(?: (a little|a little bit|a bit|slightly|a lot|way|more|a page|one page|down))?$/,
    (m) => {
      if (m[0].startsWith("go") && !m[1]) return null;
      const size = m[2] ?? "";
      const amount: ScrollAmount = /little|bit|slightly/.test(size) ? "small" : /lot|way/.test(size) ? "large" : "page";
      return { type: "scroll", direction: (m[1] ?? "down") as ScrollDirection, amount };
    },
  ],
  [/^(?:keep scrolling|scroll more|more|keep going|down)$/, () => ({ type: "scroll", direction: "down", amount: "page" })],
  [/^up$/, () => ({ type: "scroll", direction: "up", amount: "page" })],

  // Media (before "go back" so "go back 10 seconds" matches here)
  [new RegExp(`^(?:skip|fast forward|jump|go)(?: ahead| forward)?(?: by)? ${N} seconds?$`), (m) => ({ type: "media", action: "forward", seconds: parseNumber(m[1]) ?? 10 })],
  [new RegExp(`^(?:rewind|go back|jump back|back)(?: by)? ${N} seconds?$`), (m) => ({ type: "media", action: "rewind", seconds: parseNumber(m[1]) ?? 10 })],
  [/^(?:skip ahead|fast forward)$/, () => ({ type: "media", action: "forward", seconds: 10 })],
  [/^rewind$/, () => ({ type: "media", action: "rewind", seconds: 10 })],
  [/^(?:play|resume|unpause)(?: (?:the )?(?:video|it|this))?$/, () => ({ type: "media", action: "play" })],
  [/^pause(?: (?:the )?(?:video|it|this))?$/, () => ({ type: "media", action: "pause" })],
  [/^(?:make it )?full ?screen$/, () => ({ type: "media", action: "fullscreen" })],
  [/^(mute|unmute)(?: (?:the |this )?(?:tab|sound|audio|page))?$/, (m) => ({ type: "muteTab", muted: m[1] === "mute" })],
  [/^(mute|unmute) (?:the )?video$/, (m) => ({ type: "media", action: m[1] as MediaAction })],

  // History
  [/^(?:go )?back(?: a page)?$|^(?:go to )?(?:the )?previous page$/, () => ({ type: "back" })],
  [/^(?:go )?forward(?: a page)?$/, () => ({ type: "forward" })],
  [/^(?:reload|refresh)(?: (?:the |this )?page)?$/, () => ({ type: "reload" })],

  // Tabs
  [/^(?:open )?(?:a )?new tab$/, () => ({ type: "newTab" })],
  [/^close (?:this |the |current )?tab$/, () => ({ type: "closeTab" })],
  [/^(?:go to |switch to )?(?:the )?(?:next|right) tab$/, () => ({ type: "nextTab" })],
  [/^(?:go to |switch to )?(?:the )?(?:previous|left) tab$/, () => ({ type: "prevTab" })],
  [/^(?:reopen|restore|undo close|bring back)(?: (?:the )?(?:last |closed |last closed )?tab)?$/, () => ({ type: "reopenTab" })],
  [new RegExp(`^(?:go to |switch to )?tab (?:number )?${N}$`), (m) => {
    const index = parseNumber(m[1]);
    return index === null ? null : { type: "switchTab", index };
  }],
  [/^(?:switch|go back|jump) to (?:the )?(.+?)(?: tab)?$/, (m) => ({ type: "switchTab", query: m[1] })],
  [/^(?:what|which) tabs (?:are|do i have) open$|^list (?:my |the )?tabs$|^read (?:me )?(?:my |the )?tabs$/, () => ({ type: "listTabs" })],

  // Badges
  [/^(?:show|display) (?:the )?(?:numbers|labels|links|hints|badges|buttons)$|^numbers$/, () => ({ type: "showNumbers" })],
  [/^(?:hide|remove|clear) (?:the )?(?:numbers|labels|links|hints|badges)$/, () => ({ type: "hideNumbers" })],

  // Clicking by number: "click 12", "number 12", "press twelve"
  [new RegExp(`^(?:click|press|tap|select|choose|hit|open)(?: on)?(?: number)? ${N}$`), (m) => {
    const n = parseNumber(m[1]);
    return n === null ? null : { type: "clickNumber", n };
  }],
  [new RegExp(`^number ${N}$`), (m) => {
    const n = parseNumber(m[1]);
    return n === null ? null : { type: "clickNumber", n };
  }],

  // Keys
  [/^(?:press|hit) (enter|return|escape|tab|space|backspace|up|down|left|right|page up|page down)(?: key)?$/, (m) => {
    const keys: Record<string, Key> = {
      enter: "Enter", return: "Enter", escape: "Escape", tab: "Tab", space: "Space", backspace: "Backspace",
      up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight", "page up": "PageUp", "page down": "PageDown",
    };
    return { type: "pressKey", key: keys[m[1]] };
  }],
  [/^(?:submit|enter)$/, () => ({ type: "pressKey", key: "Enter" })],
  [/^(?:escape|close (?:the |this )?(?:popup|pop up|dialog|menu|modal))$/, () => ({ type: "pressKey", key: "Escape" })],

  // Zoom
  [/^zoom (in|out)$/, (m) => ({ type: "zoom", direction: m[1] as "in" | "out" })],
  [/^(?:reset (?:the )?zoom|zoom reset|normal size|actual size)$/, () => ({ type: "zoom", direction: "reset" })],

  // Reading and orientation (no AI needed)
  [/^(?:read|read (?:this|the|it) ?(?:page|article|out loud|aloud)?|read it to me|read (?:the )?selection|read this to me)$/, () => ({ type: "readPage" })],
  [/^(?:where am i|what page (?:is this|am i on)|what(?:'s| is) this page)$/, () => ({ type: "whereAmI" })],

  // Search
  [new RegExp(`^search (${ENGINE_NAMES}) for (.+)$`), (m) => search(m[2], m[1])],
  [new RegExp(`^(?:search|look up|google)(?: for)? (.+?) on (${ENGINE_NAMES})$`), (m) => search(m[1], m[2])],
  [/^(?:search|google|look up)(?: for| up)? (.+)$/, (m) => search(m[1], "google")],

  // Typing into the focused field or a numbered one
  [new RegExp(`^type (.+?) (?:in|into|on) (?:number |box |field )?${N}(?: and (?:press enter|submit|search|send))?$`), (m) => {
    const target = parseNumber(m[2]);
    return target === null ? null : { type: "type", text: m[1], target, submit: / and (?:press enter|submit|search|send)$/.test(m[0]) };
  }],
  [/^(?:type|dictate) (.+?)(?: and (press enter|submit|search|send))?$/, (m) => {
    // "type hello in the search box" names a target by description: let the AI find it.
    if (/ (?:in|into) (?:the |this )?\w+(?: \w+)? (?:box|field|bar|input)$/.test(m[1])) return null;
    return { type: "type", text: m[1], submit: !!m[2] };
  }],

  // Opening sites: only when we can resolve the destination, otherwise the AI decides
  [/^(?:open|go to|navigate to|take me to|launch|pull up|visit|bring up|load)(?: up)? (.+?)( in (?:a )?new tab)?$/, (m) => {
    const url = resolveSite(m[1]);
    return url ? { type: "open", url, newTab: !!m[2], label: m[1] } : null;
  }],
  [/^new tab (?:with |for |to )?(.+)$/, (m) => {
    const url = resolveSite(m[1]);
    return url ? { type: "open", url, newTab: true, label: m[1] } : null;
  }],

  // Clicking by label: "click sign in". Resolved against the page before falling back to AI.
  [/^(?:click|press|tap|hit|select|choose)(?: on)?(?: the)? (.+?)(?: button| link| tab| icon)?$/, (m) => ({ type: "clickText", text: m[1] })],
];

function search(query: string, engine: string): Intent {
  const q = query.trim();
  return { type: "search", query: q, engine, url: searchUrl(q, engine), newTab: false };
}

export function parseCommand(text: string): Intent | null {
  const t = normalize(text);
  if (!t) return null;
  for (const [re, build] of RULES) {
    const m = t.match(re);
    if (!m) continue;
    const intent = build(m);
    if (intent) return intent;
  }
  return null;
}
