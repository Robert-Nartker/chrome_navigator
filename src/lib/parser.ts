// Fast path: turns common spoken commands into actions with no AI call, so they
// feel instant. Anything this doesn't recognize goes to the AI agent.

import type { EditAction, Key, MediaAction, ScrollAmount, ScrollDirection } from "./protocol";
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
  | { type: "closeNamedTab"; query: string; saidTab: boolean }
  | { type: "nextTab" }
  | { type: "prevTab" }
  | { type: "reopenTab" }
  | { type: "switchTab"; index?: number; query?: string }
  | { type: "listTabs" }
  // newTab: said "in a new tab" (true) or "here" / "in this tab" (false); otherwise Navi decides.
  | { type: "open"; url: string; newTab?: boolean; label: string }
  | { type: "search"; url: string; query: string; engine: string; newTab?: boolean; onSite?: boolean }
  | { type: "siteSearch"; query: string }
  | { type: "clickNumber"; n: number }
  | { type: "clickText"; text: string }
  | { type: "showNumbers" }
  | { type: "hideNumbers" }
  | { type: "type"; text: string; target?: number; submit: boolean }
  | { type: "pressKey"; key: Key }
  | { type: "media"; action: MediaAction; seconds?: number; volume?: number }
  | { type: "zoom"; direction: "in" | "out" | "reset" }
  | { type: "muteTab"; muted: boolean }
  | { type: "readPage" }
  | { type: "whereAmI" }
  | { type: "showGrid" }
  | { type: "hideGrid" }
  | { type: "repeat" }
  | { type: "ack"; reply?: string }
  | { type: "voice"; change: "louder" | "quieter" | "faster" | "slower" }
  | { type: "autoScroll"; action: "start" | "stop" | "faster" | "slower" }
  | { type: "fasterSlower"; direction: "faster" | "slower" }
  | { type: "siteHome" }
  | { type: "backN"; times: number }
  | { type: "nextPage" }
  | { type: "newWindow" }
  | { type: "closeOtherTabs" }
  | { type: "duplicateTab" }
  | { type: "pinTab"; pinned: boolean }
  | { type: "switchBack" }
  | { type: "find"; text?: string }
  | { type: "edit"; action: EditAction }
  | { type: "print" }
  | { type: "time" }
  | { type: "date" };

/**
 * Commands understood while the mouse grid is showing. Cells are keypad numbers 1-9,
 * one per level: zoom [5, 3] goes into block 5, then block 3 inside it.
 */
export type GridCommand =
  | { type: "zoom"; cells: number[] }
  /** Clicks the center of the current block, or of the block the cells lead to. */
  | { type: "click" | "doubleClick" | "rightClick"; cells?: number[] }
  | { type: "back" }
  | { type: "hide" }
  | { type: "show" };

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

/**
 * Finds the wake name at the start of an utterance and strips it ("hey navi, scroll down").
 * `lenient` (used while asleep) also accepts up to three stray words before it, which speech
 * engines often add ("uh tiktok Navi open…").
 */
export function stripWakePhrase(text: string, words: WakeWords, lenient = false): { woke: boolean; rest: string } {
  const lower = text.toLowerCase().trim();
  // Recognizers that punctuate write "Hey, Navi. Open YouTube."
  const lead = lenient ? "^(?:[\\w']+[\\s,.!?]+){0,3}?" : "^";
  const patterns = [
    ...words.exact.map((w) => `${lead}(?:(?:hey|hi|ok(?:ay)?|yo)[\\s,.!]+)?${escapeRegExp(w)}\\b`),
    ...words.misheard.map((w) => `${lead}(?:hey|hi|ok(?:ay)?|yo)[\\s,.!]+${escapeRegExp(w)}\\b`),
  ];
  for (const pattern of patterns) {
    const m = lower.match(new RegExp(`${pattern}[\\s,.!?]*`, "i"));
    if (m) return { woke: true, rest: text.trim().slice(m[0].length).trim() };
  }
  return fuzzyWake(text, words.exact[0] ?? "", lenient ? 3 : 0);
}

const GREETINGS = new Set(["hey", "hi", "ok", "okay", "yo", "hay", "a"]);

/**
 * "Hey" followed by a word that sounds close to the name ("hey navvy", "hey novy", "hey nabi"),
 * or the two run together ("heynavi"). Requiring the greeting keeps ordinary words from waking Navi.
 */
function fuzzyWake(text: string, name: string, maxLead: number): { woke: boolean; rest: string } {
  const words = text.trim().split(/\s+/);
  const bare = (w: string) => w.toLowerCase().replace(/[^a-z']/g, "");
  for (let i = 0; i <= maxLead && i < words.length; i++) {
    const word = bare(words[i]);
    const merged = /^(?:hey|hay|hi|a)(.+)$/.exec(word);
    if (merged && similarity(merged[1], name) >= 0.75) return { woke: true, rest: words.slice(i + 1).join(" ") };
    if (GREETINGS.has(word) && i + 1 < words.length && similarity(bare(words[i + 1]), name) >= 0.6) {
      return { woke: true, rest: words.slice(i + 2).join(" ").replace(/^[,.!?\s]+/, "") };
    }
  }
  return { woke: false, rest: text.trim() };
}

/** Spellings speech engines produce for a wake name ("Navi" -> "navy", "navie"...). */
export function wakeAliases(name: string): WakeWords {
  const n = name.trim().toLowerCase();
  const misheard =
    n === "navi" ? ["navy", "navie", "navvy", "nabi", "nav e", "nave", "novi", "nobby", "knavey", "havi", "havey", "nevi"] : [];
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
  [/^(?:stop|cancel|never ?mind|shut up|be quiet|quiet|stop talking|stop reading|hush|silence|wait|hold on|hang on|one sec(?:ond)?|shh+|enough|forget it|scratch that|stop it|stop that)$/, () => ({ type: "stop" })],
  [/^(?:stop|pause|quit) (?:the )?(?:auto ?)?scroll(?:ing)?$/, () => ({ type: "autoScroll", action: "stop" })],

  // Talking with Navi
  [/^(?:what did you (?:just )?say|say (?:that|it) again|repeat (?:that|it|yourself|what you said)?|come again|pardon(?: me)?|sorry what|what was that|huh|i didn'?t (?:catch|hear) (?:that|you))$/, () => ({ type: "repeat" })],
  [/^(?:thanks?|thank you|thanks navi|got it|ok(?:ay)? thanks|perfect|cool|nice|great|awesome|good job|sounds good)$/, () => ({ type: "ack" })],
  [/^(?:are you (?:there|awake|listening|on)|you there|hello|hi|hey|can you hear me)$/, () => ({ type: "ack", reply: "I'm here." })],
  [/^(?:(?:talk|speak) (?:louder|up)|louder|speak up)$/, () => ({ type: "voice", change: "louder" })],
  [/^(?:(?:talk|speak) (?:quieter|softer|more quietly)|quieter|softer|not so loud|too loud)$/, () => ({ type: "voice", change: "quieter" })],
  [/^(?:talk|speak) (?:faster|quicker)$/, () => ({ type: "voice", change: "faster" })],
  [/^(?:talk|speak) (?:slower|more slowly)$|^slow down(?: talking)?$/, () => ({ type: "voice", change: "slower" })],
  [/^what(?:'s| is) the time$|^what time is it$/, () => ({ type: "time" })],
  [/^what(?:'s| is) (?:the date|today'?s date)$|^what day is (?:it|today)$/, () => ({ type: "date" })],
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
  [/^(?:keep scrolling|scroll more|more|keep going|down|lower|go lower|further|further down|continue|next section)$/, () => ({ type: "scroll", direction: "down", amount: "page" })],
  [/^(?:a (?:bit|little) (?:more|further|lower)|little more|bit more)$/, () => ({ type: "scroll", direction: "down", amount: "small" })],
  [/^(?:up|back up|scroll back up|higher|go higher|up top)$/, () => ({ type: "scroll", direction: "up", amount: "page" })],
  [/^(?:up a (?:bit|little)|a (?:bit|little) (?:higher|up))$/, () => ({ type: "scroll", direction: "up", amount: "small" })],
  [/^(?:go (?:back )?to )?(?:the )?(?:beginning|start)(?: of (?:the )?page)?$|^back to (?:the )?top$/, () => ({ type: "scroll", direction: "top", amount: "page" })],
  [/^(?:go to )?(?:the )?end(?: of (?:the )?page)?$/, () => ({ type: "scroll", direction: "bottom", amount: "page" })],
  [/^(?:start|begin|auto) ?scroll(?:ing)?(?: (?:slowly|for me))?$|^scroll (?:slowly|automatically)$|^read mode$/, () => ({ type: "autoScroll", action: "start" })],
  [/^scroll (faster|slower)$/, (m) => ({ type: "autoScroll", action: m[1] as "faster" | "slower" })],
  [/^(faster|slower)$/, (m) => ({ type: "fasterSlower", direction: m[1] as "faster" | "slower" })],

  // Media (before "go back" so "go back 10 seconds" matches here)
  [new RegExp(`^(?:skip|fast forward|jump|go)(?: ahead| forward)?(?: by)? ${N} seconds?$`), (m) => ({ type: "media", action: "forward", seconds: parseNumber(m[1]) ?? 10 })],
  [new RegExp(`^(?:rewind|go back|jump back|back)(?: by)? ${N} seconds?$`), (m) => ({ type: "media", action: "rewind", seconds: parseNumber(m[1]) ?? 10 })],
  [/^(?:skip ahead|fast forward)$/, () => ({ type: "media", action: "forward", seconds: 10 })],
  [/^rewind$/, () => ({ type: "media", action: "rewind", seconds: 10 })],
  [/^(?:play|resume|unpause|keep playing)(?: (?:the )?(?:video|it|this|music))?$/, () => ({ type: "media", action: "play" })],
  [/^(?:pause|stop)(?: (?:the )?(?:video|it|this|music))?$|^pause$/, () => ({ type: "media", action: "pause" })],
  [/^(?:make it |go )?full ?screen$/, () => ({ type: "media", action: "fullscreen" })],
  [/^(?:exit|leave|close|get out of) (?:the )?full ?screen$/, () => ({ type: "media", action: "exitFullscreen" })],
  [/^(?:speed (?:it |the video )?up|play (?:it )?faster|faster video)$/, () => ({ type: "media", action: "faster" })],
  [/^(?:slow (?:it |the video )?down|play (?:it )?slower|slower video)$/, () => ({ type: "media", action: "slower" })],
  [/^(?:normal|regular) speed$/, () => ({ type: "media", action: "normalSpeed" })],
  [/^(?:turn (?:it |the volume |the video |the sound )?up|volume up|turn up the (?:volume|sound|video)|(?:raise|increase) the volume|louder video)(?: (?:some )?more| a (?:bit|little)(?: more)?)?$/, () => ({ type: "media", action: "volumeUp" })],
  [/^(?:turn (?:it |the volume |the video |the sound )?down|volume down|turn down the (?:volume|sound|video)|(?:lower|decrease|reduce) the volume|quieter video)(?: (?:some )?more| a (?:bit|little)(?: more)?)?$/, () => ({ type: "media", action: "volumeDown" })],
  // "volume 45", "set the volume to 45 percent", "turn it to 30"
  [new RegExp(`^(?:(?:set|turn|put|change|bring)(?: the)?(?: video)? volume (?:to |at )?|(?:the )?volume (?:to |at )?|(?:set|turn|put) (?:it|the video|the sound) (?:to|at) )${N}(?: ?%| percent)?$`), (m) => {
    // "to"/"for" sound like numbers, but "volume to" alone isn't "volume 2".
    if (/^(?:to|too|for|fore|won|ate)$/.test(m[1])) return null;
    const level = parseNumber(m[1]);
    return level === null || level > 100 ? null : { type: "media", action: "volume", volume: level };
  }],
  [/^(?:restart|replay)(?: (?:the |this )?video)?$|^(?:start (?:it )?over|play (?:it )?from the (?:beginning|start))$/, () => ({ type: "media", action: "restart" })],
  [/^(mute|unmute)(?: (?:the |this )?(?:tab|sound|audio|page))?$/, (m) => ({ type: "muteTab", muted: m[1] === "mute" })],
  [/^(mute|unmute) (?:the )?video$/, (m) => ({ type: "media", action: m[1] as MediaAction })],

  // History
  [/^(?:go )?back(?: a page)?$|^(?:go to )?(?:the )?previous page$|^(?:go to )?(?:the )?last page$/, () => ({ type: "back" })],
  [new RegExp(`^(?:go )?back ${N} (?:pages|times)$`), (m) => {
    const times = parseNumber(m[1]);
    return times && times > 1 && times < 20 ? { type: "backN", times } : null;
  }],
  [/^(?:go )?(?:to )?(?:the )?home ?page$|^go home$|^home$/, () => ({ type: "siteHome" })],
  [/^(?:go to )?(?:the )?next page(?: of results)?$|^more results$/, () => ({ type: "nextPage" })],
  [/^(?:go )?forward(?: a page)?$/, () => ({ type: "forward" })],
  [/^(?:reload|refresh)(?: (?:the |this )?page)?$/, () => ({ type: "reload" })],

  // Tabs
  // "Open your tab" is a common mishearing of "open new tab".
  [/^(?:open )?(?:a )?new tab$|^open (?:a )?(?:your|near|knew) tab$/, () => ({ type: "newTab" })],
  [/^(?:open )?(?:a )?new window$/, () => ({ type: "newWindow" })],
  [/^close (?:all )?(?:the |of the )?other tabs$|^close everything else$/, () => ({ type: "closeOtherTabs" })],
  [/^duplicate (?:this |the )?tab$/, () => ({ type: "duplicateTab" })],
  [/^(pin|unpin) (?:this |the )?tab$/, (m) => ({ type: "pinTab", pinned: m[1] === "pin" })],
  [/^(?:go to |switch to )?(?:the )?first tab$/, () => ({ type: "switchTab", index: 1 })],
  [/^(?:go to |switch to )?(?:the )?last tab$/, () => ({ type: "switchTab", index: -1 })],
  [/^switch back$|^(?:the )?other tab$|^(?:go |switch )?back to (?:the )?(?:other|previous|last) tab$/, () => ({ type: "switchBack" })],
  [/^how many tabs(?: do i have)?(?: open)?$/, () => ({ type: "listTabs" })],
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

  // Mouse grid
  [/^(?:show |open |display |turn on )?(?:the )?(?:mouse )?grid(?: on)?$/, () => ({ type: "showGrid" })],
  [/^(?:hide|close|remove|clear|turn off) (?:the )?(?:mouse )?grid$|^(?:the )?(?:mouse )?grid off$/, () => ({ type: "hideGrid" })],

  // Flags: numbered tags on everything clickable ("flags", then "click 12" or just "12")
  [/^(?:(?:show|display|turn on|put up|put on|pop up|bring up|show me) (?:the )?)?(?:flags?|numbers|labels|badges)(?: on| please)?$|^(?:show|display) (?:the )?(?:links|hints|buttons)$|^turn (?:the )?flags on$/, () => ({ type: "showNumbers" })],
  // "Unflag" is often heard as "on flag".
  [/^(?:hide|remove|clear|turn off|close|no|no more|get rid of|take off|take away) (?:the )?(?:flags?|numbers|labels|links|hints|badges)$|^(?:flags|numbers) (?:off|away)$|^turn (?:the )?flags off$|^(?:un ?flag|on flag|unflagged)(?: (?:it|them|everything|all|the page))?$/, () => ({ type: "hideNumbers" })],

  // Clicking by number: "click 12", "number 12", "flag 12", "press twelve"
  [new RegExp(`^(?:click|press|tap|select|choose|hit|open)(?: on)?(?: number| flag)? ${N}$|^flag ${N}$`), (m) => {
    const n = parseNumber(m[1] ?? m[2]);
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

  // Find text on the page, editing, printing
  [/^(?:find|look for|search (?:the |this )?page for|where does it say) (.+?)(?: on (?:the |this )?page)?$/, (m) => ({ type: "find", text: m[1] })],
  [/^(?:find (?:the )?next(?: one)?|next match|next result)$/, () => ({ type: "find" })],
  [/^select (?:all|everything)$/, () => ({ type: "edit", action: "selectAll" })],
  [/^undo(?: that)?$/, () => ({ type: "edit", action: "undo" })],
  [/^(?:clear|erase|empty) (?:the |this )?(?:box|field|text|input|search|it)$|^clear it$/, () => ({ type: "edit", action: "clear" })],
  [/^(?:new|next) (?:line|paragraph)$/, () => ({ type: "edit", action: "newline" })],
  [/^print(?: (?:this|the) page)?$/, () => ({ type: "print" })],
  [/^(?:make (?:it|the text|everything) )?(?:bigger|larger)$/, () => ({ type: "zoom", direction: "in" })],
  [/^(?:make (?:it|the text|everything) )?smaller$/, () => ({ type: "zoom", direction: "out" })],

  // Reading and orientation (no AI needed)
  [/^(?:read|read (?:this|the|it) ?(?:page|article|out loud|aloud)?|read it to me|read (?:the )?selection|read this to me)$/, () => ({ type: "readPage" })],
  [/^(?:where am i|what page (?:is this|am i on)|what(?:'s| is) this page)$/, () => ({ type: "whereAmI" })],

  // Search
  [/^search (?:this|the) (?:site|page|website|store|shop) for (.+)$|^search for (.+?) on (?:this|the) (?:site|page|website|store|shop)$/, (m) => ({
    type: "siteSearch",
    query: (m[1] ?? m[2]).trim(),
  })],
  [new RegExp(`^search (${ENGINE_NAMES}) for (.+)$`), (m) => search(m[2], m[1])],
  [new RegExp(`^(?:search|look up|google)(?: for)? (.+?) on (${ENGINE_NAMES})$`), (m) => search(m[1], m[2])],
  [/^google(?: for)? (.+)$/, (m) => search(m[1], "google")],
  // No site named: on a site Navi can search (YouTube, Amazon...), that site; otherwise Google.
  [/^(?:search|look up)(?: for| up)? (.+)$/, (m) => ({ ...search(m[1], "google"), onSite: true })],

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
  [/^(?:open|go to|navigate to|take me to|launch|pull up|visit|bring up|load)(?: up)? (.+?)( in (?:a )?new tab| (?:in )?(?:this|the same) tab| here)?$/, (m) => {
    const url = resolveSite(m[1]);
    if (!url) return null;
    return { type: "open", url, label: m[1], ...(m[2] ? { newTab: /new tab/.test(m[2]) } : {}) };
  }],
  [/^new tab (?:with |for |to )?(.+)$/, (m) => {
    const url = resolveSite(m[1]);
    return url ? { type: "open", url, newTab: true, label: m[1] } : null;
  }],

  // "close the reddit tab", "close youtube": only a tab matching the name is closed, never the current one
  // instead. Last among the "close …" phrases, so "close grid" or "close the flags" mean what they say.
  [/^close (?:the |my |that |this )?(.+?)( tabs?)?$/, (m) =>
    /^(?:it|this|that|them|everything|all|other tabs?|the other tabs?|window|this window|the window|popup|the popup|dialog|menu|ad|grid|the grid|flags|the flags)$/.test(m[1]) ||
    // "close tap" is a mishearing of "close tab", not a tab named "tap".
    (!m[2] && similarity(m[1], "tab") >= 0.6)
      ? null
      : { type: "closeNamedTab", query: m[1], saidTab: !!m[2] }],

  // Clicking by label: "click sign in". Resolved against the page before falling back to AI.
  [/^(?:click|press|tap|hit|select|choose)(?: on)?(?: the)? (.+?)(?: button| link| tab| icon)?$/, (m) => ({ type: "clickText", text: m[1] })],
];

function search(query: string, engine: string): Intent {
  const q = query.trim();
  return { type: "search", query: q, engine, url: searchUrl(q, engine) };
}

// Mouse grid: one keypad number (1-9) per level. Said on their own, the numbers
// include the words speech engines hear instead ("to" for two, "for" for four).
const CELL_WORDS = new Map(
  Object.entries({ one: 1, won: 1, two: 2, to: 2, too: 2, three: 3, four: 4, for: 4, fore: 4, five: 5, six: 6, seven: 7, eight: 8, ate: 8, nine: 9 }),
);
/** Four levels deep, plus one more number to click inside the last one. */
const MAX_GRID_CELLS = 4;

/** "5", "five three", "5 and 3", "53" -> the cells; null unless every word is a cell. */
function parseCells(text: string): number[] | null {
  const cells: number[] = [];
  for (const word of text.split(/[\s.-]+/)) {
    if (word === "and" || word === "then") continue;
    // Speech engines often merge digits said in a row: "five three" arrives as "53".
    if (/^[1-9]+$/.test(word)) cells.push(...Array.from(word, Number));
    else if (CELL_WORDS.has(word)) cells.push(CELL_WORDS.get(word)!);
    else return null;
  }
  return cells.length > 0 && cells.length <= MAX_GRID_CELLS ? cells : null;
}

const GRID_CLICK = "(?:(double|right|left)[ -]?)?(?:click|tap|press|select|choose)";
const clickType = (kind?: string) => (kind === "double" ? "doubleClick" : kind === "right" ? "rightClick" : "click");

const GRID_RULES: [RegExp, (m: RegExpMatchArray) => GridCommand | null][] = [
  // "5", "5 3", "five three seven", "53", "zoom into 3", "go to 5"
  [/^(?:zoom(?: in)?(?: (?:into|to|on))? |go (?:to )?|number |cell |block |square |box |tile )?(.+)$/, (m) => {
    const cells = parseCells(m[1]);
    return cells && { type: "zoom", cells };
  }],
  // "click", "click here", "double click", "right click"
  [new RegExp(`^${GRID_CLICK}(?: (?:on )?(?:it|here|there|that|(?:the )?(?:center|centre|middle)))?$`), (m) => ({ type: clickType(m[1]) })],
  // "click 7", "click 5 3", "double click 4". Anything else ("click sign in") isn't for the grid.
  [new RegExp(`^${GRID_CLICK}(?: on)?(?: (?:number|cell|block|square|tile|box))? (.+)$`), (m) => {
    const cells = parseCells(m[2]);
    return cells && { type: clickType(m[1]), cells };
  }],
  [/^(?:back|go back|back up|zoom out|zoom back out|out|up|go up|undo)$/, () => ({ type: "back" })],
  [
    /^(?:hide|close|cancel|exit|stop|never ?mind|done|quit|dismiss)(?: (?:the )?(?:mouse )?grid)?$|^(?:hide|close) it$|^(?:remove|clear|turn off) (?:the )?(?:mouse )?grid$|^(?:the )?(?:mouse )?grid off$/,
    () => ({ type: "hide" }),
  ],
  [/^(?:show |reset |restart |open |turn on )?(?:the )?(?:mouse )?grid(?: on)?$|^start over$/, () => ({ type: "show" })],
];

/** "12", "twelve", "number 12" -> 12 (used while number tags are showing). */
export function parseBareNumber(text: string): number | null {
  const m = normalize(text).match(new RegExp(`^(?:number |click )?${N}$`));
  return m ? parseNumber(m[1]) : null;
}

/** While the grid is showing, numbers mean grid blocks and "back" means zoom out. */
export function parseGridCommand(text: string): GridCommand | null {
  const t = normalize(text);
  for (const [re, build] of GRID_RULES) {
    const m = t.match(re);
    const command = m && build(m);
    if (command) return command;
  }
  return null;
}

function matchRules(t: string): Intent | null {
  for (const [re, build] of RULES) {
    const m = t.match(re);
    if (!m) continue;
    const intent = build(m);
    if (intent) return intent;
  }
  return null;
}

/** Words speech engines hear instead of the wake name, which people also tack onto commands ("Navi, sleep"). */
const NAME_LIKE = /^(?:navi|navy|navie|navvy|havi|havey|nabi|novi|nobby|navi's|nav)$/;

/** Handles looser phrasings of common commands ("scroll down further", "sleep navi"). */
function looseIntent(t: string): Intent | null {
  const words = t.split(" ");
  if (words.length <= 5 && /\b(?:sleep|goodnight|good night|nap)\b/.test(t) && !/\bdon'?t\b|\bnot\b/.test(t)) {
    return { type: "sleep" };
  }
  if (/\bscroll|^(?:go|move|page|keep going) (?:up|down)\b|^keep (?:scrolling|going)/.test(t) && words.length <= 8) {
    const direction: ScrollDirection = /\btop\b/.test(t)
      ? "top"
      : /\bbottom\b/.test(t)
        ? "bottom"
        : /\bup\b/.test(t)
          ? "up"
          : /\bleft\b/.test(t)
            ? "left"
            : /\bright\b/.test(t)
              ? "right"
              : "down";
    const amount: ScrollAmount = /\b(?:little|bit|slightly|tad|touch|smidge)\b/.test(t)
      ? "small"
      : /\b(?:lot|way|much|far|bunch|fast)\b/.test(t)
        ? "large"
        : "page";
    return { type: "scroll", direction, amount };
  }
  return null;
}

/** Canonical phrasings used to catch near-misses from speech recognition ("scrawl down"). */
const CANONICAL = [
  "scroll down", "scroll up", "scroll to the top", "scroll to the bottom", "page down", "page up",
  "go back", "go forward", "refresh", "new tab", "close tab", "next tab", "previous tab", "reopen closed tab",
  "show flags", "hide flags", "show numbers", "hide numbers", "show grid", "hide grid", "go to sleep", "help", "where am i",
  "read this page", "zoom in", "zoom out", "reset zoom", "pause", "play", "mute", "unmute",
  "what tabs are open", "press enter", "escape",
];

export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  const m = a.length;
  const n = b.length;
  if (!m || !n) return 0;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return 1 - prev[n] / Math.max(m, n);
}

/** The closest phrase from a list, if it's a near-certain match. */
export function closestPhrase(t: string, phrases: string[], threshold = 0.8): string | null {
  let best: string | null = null;
  let bestScore = threshold;
  for (const phrase of phrases) {
    if (Math.abs(phrase.length - t.length) > Math.max(3, phrase.length * 0.3)) continue;
    const score = similarity(t, phrase);
    if (score >= bestScore) {
      best = phrase;
      bestScore = score;
    }
  }
  return best;
}

const IN_NEW_TAB = / (?:in|on) (?:a )?new tab$/;
const IN_THIS_TAB = / (?:(?:in|on) )?(?:this|the same) tab$| here$/;

export function parseCommand(text: string): Intent | null {
  const t = normalize(text);
  if (!t) return null;
  // "search youtube for lofi in a new tab" (opening sites handles this in its own rule).
  for (const [suffix, newTab] of [[IN_NEW_TAB, true], [IN_THIS_TAB, false]] as const) {
    const m = suffix.exec(t);
    if (!m) continue;
    const base = matchRules(t.slice(0, m.index));
    if (base?.type === "search") return { ...base, newTab };
  }
  const exact = matchRules(t);
  if (exact) return exact;
  // "Navi, sleep" / "scroll down navi": drop a name-like word at either end.
  const words = t.split(" ");
  const trimmed = words
    .slice(NAME_LIKE.test(words[0]) ? 1 : 0, NAME_LIKE.test(words[words.length - 1]) && words.length > 1 ? -1 : undefined)
    .join(" ");
  if (trimmed && trimmed !== t) {
    const intent = matchRules(trimmed);
    if (intent) return intent;
  }
  const target = trimmed || t;
  const loose = looseIntent(target);
  if (loose) return loose;
  const near = closestPhrase(target, CANONICAL);
  return near ? matchRules(near) : null;
}
