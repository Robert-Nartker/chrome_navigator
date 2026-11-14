import { describe, expect, it } from "vitest";
import { isCommandStart, parseCommand } from "../../src/lib/parser";

// How Chrome's recognizer really mishears everyday commands, and the chatter it picks up. Each
// mishearing must run the command that was meant; chatter must run nothing (it goes to the router,
// or nowhere; "hold on" stops Navi, "bye" sends it to sleep and "cool" gets a nod, by design); and no mishearing may run a different command, least of all the opposite one.

const MEANT: Record<string, string[]> = {
  "scroll down": ["scrolled down", "scroll town", "scroll dawn", "scrolldown", "school down", "stroll down", "scroll done", "scrawl down", "Scroll down!", "girl down"],
  "scroll up": ["scrolled up", "school up", "scrollup", "stroll up", "skull up", "scroll op", "scroll app"],
  "go back": ["goback", "go bag", "go buck", "go pack", "Go back!", "go bak", "go beck"],
  "close tab": ["clothes tab", "close tap", "closed tab", "close the tab", "clothes tap", "closetab", "close tub", "close top"],
  "new tab": ["newtab", "new tap", "knew tab", "new tub", "new top", "new dab", "new tabs"],
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
  "pause the video": ["paws the video", "how's the video", "pause video", "paused the video", "pauses the video"],
  // From the speech benchmark (bench/asr): a stray word in front, a plural at the end, a sound-alike.
  play: ["a play", "oh play"],
  "unmute": ["the unmute"],
  louder: ["lauder", "it's louder"],
  "delete the last word": ["delete the lost word"],
  "read this section": ["raid this section"],
  "go to main content": ["go to maine content", "go to main contents"],
  "full screen": ["a full screen"],
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
  const woke = (said: string) => new WakeSession({ stayAwake: false, wakeName: "Navi", timeoutSec: 120 }).handle(said).woke;
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
    const session = new WakeSession({ stayAwake: false, wakeName: "Navi", timeoutSec: 120 });
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
    expect(parseCommand("mouse click on sign in")?.type).not.toBe("hover");
  });
});

describe("switching recognizers by voice", () => {
  it("understands the ways people ask", () => {
    expect(parseCommand("use parakeet")).toEqual({ type: "recognizer", to: "parakeet" });
    expect(parseCommand("switch to Parakeet")).toEqual({ type: "recognizer", to: "parakeet" });
    expect(parseCommand("switch back to chrome's recognizer")).toEqual({ type: "recognizer", to: "chrome" });
    expect(parseCommand("use chrome")).toEqual({ type: "recognizer", to: "chrome" });
    expect(parseCommand("which recognizer are you using")).toEqual({ type: "recognizer" });
  });
});

describe("answering a helper's question by voice", () => {
  it("reads it, answers it by option or in your own words, or cancels it", () => {
    expect(parseCommand("what does the helper want")).toEqual({ type: "helperQuestion", action: "read" });
    expect(parseCommand("what's the question")).toEqual({ type: "helperQuestion", action: "read" });
    expect(parseCommand("option 2")).toEqual({ type: "helperQuestion", action: "answer", option: 2, helper: undefined });
    expect(parseCommand("helper 3, option one")).toEqual({ type: "helperQuestion", action: "answer", option: 1, helper: 3 });
    expect(parseCommand("the second one")).toEqual({ type: "helperQuestion", action: "answer", option: 2 });
    expect(parseCommand("tell the helper the blue one")).toEqual({ type: "helperQuestion", action: "answer", text: "the blue one", helper: undefined });
    expect(parseCommand("the answer is next tuesday")).toMatchObject({ type: "helperQuestion", action: "answer", text: "next tuesday" });
    expect(parseCommand("cancel the question")).toEqual({ type: "helperQuestion", action: "cancel" });
  });
  it("leaves AI tasks that start with “answer” alone", () => {
    expect(parseCommand("answer this email saying thanks")?.type).not.toBe("helperQuestion");
  });
});

describe("on, off, awake and asleep by voice", () => {
  it("Stay awake on and off", () => {
    for (const said of ["stay awake", "keep listening", "don't fall asleep", "don't go to sleep", "open mic", "turn on open mic", "caffeine mode", "stay on"]) {
      expect(parseCommand(said), `"${said}"`).toEqual({ type: "stayAwake", on: true });
    }
    for (const said of ["you can sleep when I'm quiet", "fall asleep on your own", "stop staying awake", "stay awake off", "turn off stay awake", "turn off open mic"]) {
      expect(parseCommand(said), `"${said}"`).toEqual({ type: "stayAwake", on: false });
    }
  });
  it("what Navi does when Chrome opens", () => {
    for (const said of ["start when chrome opens", "listen when chrome starts", "start with chrome", "always start listening when chrome opens", "start asleep"]) {
      expect(parseCommand(said), `"${said}"`).toEqual({ type: "startOnLaunch", on: true });
    }
    for (const said of ["start off when chrome opens", "don't start when chrome opens", "don't listen when chrome starts", "don't start with chrome"]) {
      expect(parseCommand(said), `"${said}"`).toEqual({ type: "startOnLaunch", on: false });
    }
  });
  it("turn on, wake up, and the commands they're close to", () => {
    expect(parseCommand("turn on")).toEqual({ type: "turnOn" });
    expect(parseCommand("start listening")).toEqual({ type: "turnOn" });
    expect(parseCommand("wake up")).toEqual({ type: "wake" });
    expect(parseCommand("hey wake up navi")).toEqual({ type: "wake" });
    expect(parseCommand("go to sleep")).toEqual({ type: "sleep" });
    expect(parseCommand("turn off")).toEqual({ type: "turnOff" });
    expect(parseCommand("stay in this window")).toMatchObject({ type: "pinWindow", on: true });
    expect(parseCommand("keep scrolling")).toMatchObject({ type: "scroll" });
  });
});

describe("the first words of a command wait for the rest", () => {
  it("knows a command that isn't finished yet", () => {
    for (const said of ["close", "scroll to the", "go to", "next"]) expect(isCommandStart(said), `"${said}"`).toBe(true);
    for (const said of ["close tab", "scroll down", "pause", "so I told my friend", "hello"]) expect(isCommandStart(said), `"${said}"`).toBe(false);
  });
});

describe("a Bluetooth headset's mic is noticed (it records at phone-call quality)", async () => {
  const { isHeadsetMic } = await import("../../src/ears/ears");
  it("by the names Windows and macOS give it", () => {
    for (const label of ["Headset (Robert's AirPods Pro Hands-Free AG Audio)", "Default - Headset (AirPods)", "Robert's AirPods Pro", "Galaxy Buds2 Pro", "WH-1000XM5 Hands-Free", "Jabra Elite 75t"]) {
      expect(isHeadsetMic(label), label).toBe(true);
    }
    for (const label of ["Microphone Array (Realtek(R) Audio)", "MacBook Pro Microphone", "Blue Yeti (USB)", "Default - Microphone (Realtek High Definition Audio)", "Jabra Speak 510 USB"]) {
      expect(isHeadsetMic(label), label).toBe(false);
    }
  });
});

describe("Whisper as a recognizer", async () => {
  const { cleanTranscript, modelFor } = await import("../../src/voice/parakeet-langs");
  it("is chosen by voice", () => {
    expect(parseCommand("use whisper")).toEqual({ type: "recognizer", to: "whisper" });
    expect(parseCommand("switch to whisper")).toEqual({ type: "recognizer", to: "whisper" });
  });
  it("uses Whisper small, English-only for English", () => {
    expect(modelFor("whisper", "en-US")).toBe("Xenova/whisper-small.en");
    expect(modelFor("whisper", "fr-FR")).toBe("Xenova/whisper-small");
    expect(modelFor("parakeet", "en-GB")).toBe("parakeet-tdt-0.6b-v2");
    expect(modelFor("parakeet", "ja-JP")).toBeUndefined();
  });
  it("drops the sounds Whisper labels and the word loops it falls into", () => {
    expect(cleanTranscript("[BLANK_AUDIO]")).toBe("");
    expect(cleanTranscript(" (static) ")).toBe("");
    expect(cleanTranscript("*buzzing* Scroll down.")).toBe("Scroll down.");
    expect(cleanTranscript("stop stop stop stop stop stop")).toBe("stop");
    expect(cleanTranscript("Stop. Stop. Stop.")).toBe("Stop");
    expect(cleanTranscript("go go")).toBe("go go");
    expect(cleanTranscript("Pause the video.")).toBe("Pause the video.");
  });
});

describe("more of what the speech benchmark heard (bench/asr)", () => {
  it("a near-miss on a known site still opens it, but only a clear one", () => {
    for (const said of ["open youtuber", "open you tube"]) expect(parseCommand(said), said).toMatchObject({ type: "open", url: "https://www.youtube.com" });
    expect(parseCommand("open redit")).toMatchObject({ url: "https://www.reddit.com" });
    expect(parseCommand("open the news")).toBeNull();
  });
  it("“tab” as recognizers hear it after “switch to”", () => {
    for (const said of ["switch to top 3", "switch to taba 3", "switch to top three"]) expect(parseCommand(said), said).toEqual({ type: "switchTab", index: 3 });
  });
  it("British spelling", () => {
    expect(parseCommand("which recogniser are you using")).toEqual({ type: "recognizer" });
  });
  it("a stray “it's” or “he's” is dropped only for media and stop: the rest is people talking", () => {
    expect(parseCommand("it's louder")).toEqual({ type: "voice", change: "louder" });
    expect(parseCommand("it's pause")).toEqual({ type: "media", action: "pause" });
    for (const said of ["it's up", "he's back", "she's down", "it's enter", "that's back", "its back", "hes up"]) expect(parseCommand(said), said).toBeNull();
  });
  it("a real site one letter from a listed one opens itself (“canva” isn't “canvas”)", () => {
    expect(parseCommand("open canva")).toMatchObject({ url: "https://www.canva.com" });
  });
  it("said in passing, a stray word before back, forward or help, or a lone plural, stays talk", () => {
    for (const said of ["oh back", "oh help", "ups", "downs"]) expect(parseCommand(said), said).toBeNull();
    expect(parseCommand("a play")).toEqual({ type: "media", action: "play" });
    expect(parseCommand("new tabs")).toEqual({ type: "newTab" });
  });
  it("what a noisy headset made of a few commands", () => {
    expect(parseCommand("help me")).toEqual({ type: "help" });
    expect(parseCommand("give ahead 30 seconds")).toEqual({ type: "media", action: "forward", seconds: 30 });
    expect(parseCommand("volume app")).toEqual({ type: "media", action: "volumeUp" });
    expect(parseCommand("roll up")).toEqual({ type: "scroll", direction: "up", amount: "page" });
    expect(parseCommand("open gmail in a new topic")).toMatchObject({ type: "open", url: "https://mail.google.com", newTab: true });
    expect(parseCommand("go to gmail in a new top")).toMatchObject({ type: "open", newTab: true });
    // Still not commands: these are someone talking.
    for (const said of ["help me find a recipe", "give me a second", "keep ahead of the game"]) {
      const intent = parseCommand(said);
      expect(intent === null || !["help", "media"].includes(intent.type), said).toBe(true);
    }
  });
});
