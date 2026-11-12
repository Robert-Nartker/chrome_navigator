import { describe, expect, it } from "vitest";
import { parseCommand } from "../../src/lib/parser";

// How Chrome's recognizer really mishears everyday commands, and the chatter it picks up. Each
// mishearing must run the command that was meant; chatter must run nothing (it goes to the router,
// or nowhere; "hold on" stops Navi, "bye" sends it to sleep and "cool" gets a nod, by design); and no mishearing may run a different command, least of all the opposite one.

const MEANT: Record<string, string[]> = {
  "scroll down": ["scrolled down", "scroll town", "scroll dawn", "scrolldown", "school down", "stroll down", "scroll done", "scrawl down", "Scroll down!", "girl down"],
  "scroll up": ["scrolled up", "school up", "scrollup", "stroll up", "skull up", "scroll op", "scroll app"],
  "go back": ["goback", "go bag", "go buck", "go pack", "Go back!", "go bak", "go beck"],
  "close tab": ["clothes tab", "close tap", "closed tab", "close the tab", "clothes tap", "closetab", "close tub", "close top"],
  "new tab": ["newtab", "new tap", "knew tab", "new tub", "new top", "new dab"],
  "next tab": ["nexttab", "next tap", "next top", "next tub"],
  refresh: ["refreshed", "reload"],
  "zoom in": ["zoomin", "zoom inn"],
  "zoom out": ["zoomout"],
  "go to sleep": ["go to sleeps", "go too sleep", "go to slip"],
  stop: ["stopped"],
  "show flags": ["flex"],
  "hide numbers": ["hide number", "hyde numbers", "height numbers"],
  "click 5": ["click five", "clique 5", "quick 5", "clicks 5", "click on 5", "click number 5"],
  pause: ["paws"],
  mute: ["mewt", "moot"],
  "where am i": ["wear am i"],
  "scroll to the top": ["scroll to the tap"],
};

/** Things people say near the mic that aren't commands. ("Close the door" asks to close a tab named "door": harmless.) */
const CHATTER = [
  "uh huh", "mm hmm", "hello", "yellow", "okay", "cool", "nice", "yes", "yeah", "no", "nope", "wow", "what", "right", "sure",
  "thanks", "bye", "good", "great", "sorry", "oops", "wait", "come on", "oh no", "see you", "one sec", "i know", "me too",
  "love you", "how are you", "i don't know", "go team", "good job", "no way", "for sure", "not now", "my bad", "hold on",
  "the new top is nice", "i'm going back home",
];

/** Requests for the AI that a built-in command mustn't swallow. */
const TASKS = ["find me a vegetarian recipe that takes under 30 minutes", "find me a cheap flight to denver"];

const intent = (s: string) => JSON.stringify(parseCommand(s));

describe("hearing: what Chrome mishears still runs the command that was meant", () => {
  for (const [meant, heard] of Object.entries(MEANT)) {
    it(`"${meant}"`, () => {
      const want = intent(meant);
      expect(want, `"${meant}" itself must be a command`).not.toBe("null");
      for (const h of heard) expect(intent(h), `heard "${h}"`).toBe(want);
    });
  }
});

describe("hearing: chatter and tasks run no built-in command", () => {
  it("chatter at most stops Navi or gets a nod, never acts on the page or tabs", () => {
    for (const c of CHATTER) expect(["none", "ack", "stop", "sleep"], `"${c}"`).toContain(parseCommand(c)?.type ?? "none");
  });
  it("tasks for the AI", () => {
    for (const t of TASKS) expect(intent(t), `"${t}"`).toBe("null");
  });
});

describe("hearing: never the opposite", () => {
  it("an unclear word after 'scroll' never scrolls the other way", () => {
    for (const h of ["scroll op", "scroll app", "scrollup", "scroll a", "scroll uh", "scroll of"]) {
      const got = parseCommand(h);
      expect(got && "direction" in got ? got.direction : "none", `"${h}"`).not.toBe("down");
    }
  });
});

describe("hearing: everyday ways to say scroll still scroll", () => {
  it("scrolls down for phrasings without a direction word", () => {
    for (const said of ["scroll through the comments", "scroll farther", "scroll past this", "scroll ahead", "keep scrolling", "scroll a bit"]) {
      expect(parseCommand(said), `"${said}"`).toMatchObject({ type: "scroll", direction: "down" });
    }
  });
});

describe("hearing: the user's own words are kept as said", () => {
  it("run-together words are split only at the start of a command", () => {
    expect(parseCommand("search for closeup photos")).toMatchObject({ type: "search", query: "closeup photos" });
    expect(parseCommand("type closeout sale")).toMatchObject({ type: "type", text: "closeout sale" });
  });
  it("“type out of office” types all of it", () => {
    expect(parseCommand("type out of office")).toMatchObject({ type: "type", text: "out of office" });
  });
  it("“what did I say” is left to the AI", () => {
    expect(parseCommand("what did I say")).toBeNull();
  });
});

describe("hearing: typing and finding take just the words meant", () => {
  it("type in … and then hit enter", () => {
    expect(parseCommand("type in hello world and then hit enter")).toEqual({ type: "type", text: "hello world", submit: true });
  });
  it("find where it says …", () => {
    expect(parseCommand("find where it says pricing")).toEqual({ type: "find", text: "pricing" });
  });
});

describe("hearing: the wake name", async () => {
  const { WakeSession } = await import("../../src/lib/session");
  const woke = (said: string) => new WakeSession({ mode: "handsfree", wakeName: "Navi", timeoutSec: 120 }).handle(said).woke;
  it("wakes for the ways Chrome writes “Hey Navi” down", () => {
    const heard = [
      "hey navi scroll down", "Hey Navi.", "hey navy", "hey Navy, open YouTube", "hey nabi", "hey novi", "hey navie", "hey navvy",
      "a navy", "hay navy", "hey nevi", "hey knavey", "hey nobby", "hey nadi", "hey nafi", "hey navid", "hey nervy", "hey navi's",
      "okay navi", "ok navy", "yo navi", "heynavi", "hey Navigator", "hey navigate", "hey navigation", "hey navigators", "hi navi",
      "Navi, scroll down", "hey Mavi", "hey davi", "hey nah v", "hey Nabby", "hey Nabil", "hey Nevie",
    ];
    for (const h of heard) expect(woke(h), `"${h}"`).toBe(true);
  });
  it("keeps nothing said before the name", () => {
    const session = new WakeSession({ mode: "handsfree", wakeName: "Navi", timeoutSec: 120 });
    expect(session.fromName("so anyway tiktok hey navi open youtube")).toBe("hey navi open youtube");
    expect(session.fromName("um wake up")).toBe("wake up");
    expect(session.fromName("scroll down")).toBe("scroll down");
  });
  it("doesn't wake for everyday talk", () => {
    const talk = [
      "hey nancy can you pass the salt", "hey there", "hey man", "hey buddy", "hey Google", "hey Siri", "hey mom", "I joined the navy",
      "okay", "navigate to the store", "the navy seals", "hey now", "hey babe", "hey honey", "hey Nate", "have a nice day", "hey look at this", "hey Nick",
      "I need a knife", "take a nap", "a nephew of mine", "grab a knife and fork",
    ];
    for (const t of talk) expect(woke(t), `"${t}"`).toBe(false);
  });
});

describe("moving through a page by its structure", () => {
  const cases: Record<string, object> = {
    "next heading": { type: "structure", what: "heading", action: "next" },
    "prev heading": { type: "structure", what: "heading", action: "previous" },
    "next text box": { type: "structure", what: "field", action: "next" },
    "last link": { type: "structure", what: "link", action: "last" },
    "next region": { type: "structure", what: "landmark", action: "next" },
    "what links are on this page": { type: "structure", what: "link", action: "list" },
    "read the headings": { type: "structure", what: "heading", action: "list" },
    "go to the pricing section": { type: "structure", what: "heading", action: "jump", name: "pricing" },
    "go to the email field": { type: "structure", what: "field", action: "jump", name: "email" },
    "skip to content": { type: "structure", what: "landmark", action: "jump", name: "main" },
    "read this section": { type: "structure", what: "heading", action: "readSection" },
  };
  it("understands the ways people ask", () => {
    for (const [said, want] of Object.entries(cases)) expect(parseCommand(said), `"${said}"`).toEqual(want);
  });
  it("leaves the commands it looks like alone", () => {
    expect(parseCommand("next tab")).toEqual({ type: "nextTab" });
    expect(parseCommand("next page")).toEqual({ type: "nextPage" });
    expect(parseCommand("read this page")).toEqual({ type: "readPage" });
    expect(parseCommand("go to youtube")).toMatchObject({ type: "open" });
  });
});

describe("hovering by voice", () => {
  it("by name or by flag number", () => {
    expect(parseCommand("hover over account")).toEqual({ type: "hover", text: "account" });
    expect(parseCommand("mouse over the help menu")).toEqual({ type: "hover", text: "help" });
    expect(parseCommand("hover 5")).toEqual({ type: "hover", n: 5 });
    expect(parseCommand("hover over number twelve")).toEqual({ type: "hover", n: 12 });
    expect(parseCommand("put the mouse on sign in")).toEqual({ type: "hover", text: "sign in" });
  });
});
