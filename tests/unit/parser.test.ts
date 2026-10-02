import { describe, expect, it } from "vitest";
import { normalize, parseCommand, parseGridCommand, stripWakePhrase, wakeAliases } from "../../src/lib/parser";

describe("normalize", () => {
  it("strips filler and punctuation", () => {
    expect(normalize("Okay, can you scroll down please.")).toBe("scroll down");
    expect(normalize("Um, go back!")).toBe("go back");
  });
});

describe("parseCommand fast path", () => {
  const cases: [string, object | null][] = [
    ["scroll down", { type: "scroll", direction: "down", amount: "page" }],
    ["Scroll up a little", { type: "scroll", direction: "up", amount: "small" }],
    ["scroll down a lot", { type: "scroll", direction: "down", amount: "large" }],
    ["go to the top", { type: "scroll", direction: "top", amount: "page" }],
    ["scroll to the bottom of the page", { type: "scroll", direction: "bottom", amount: "page" }],
    ["page down", { type: "scroll", direction: "down", amount: "page" }],
    ["keep scrolling", { type: "scroll", direction: "down", amount: "page" }],
    ["go back", { type: "back" }],
    ["back", { type: "back" }],
    ["go forward", { type: "forward" }],
    ["refresh the page", { type: "reload" }],
    ["open a new tab", { type: "newTab" }],
    ["close this tab", { type: "closeTab" }],
    ["next tab", { type: "nextTab" }],
    ["previous tab", { type: "prevTab" }],
    ["reopen closed tab", { type: "reopenTab" }],
    ["switch to tab 3", { type: "switchTab", index: 3 }],
    ["tab two", { type: "switchTab", index: 2 }],
    ["switch to youtube", { type: "switchTab", query: "youtube" }],
    ["what tabs are open", { type: "listTabs" }],
    ["click 12", { type: "clickNumber", n: 12 }],
    ["Click twelve.", { type: "clickNumber", n: 12 }],
    ["click on number twenty-one", { type: "clickNumber", n: 21 }],
    ["number 7", { type: "clickNumber", n: 7 }],
    ["click to", { type: "clickNumber", n: 2 }],
    ["show numbers", { type: "showNumbers" }],
    ["flags", { type: "showNumbers" }],
    ["show flags", { type: "showNumbers" }],
    ["flags on", { type: "showNumbers" }],
    ["hide flags", { type: "hideNumbers" }],
    ["flags off", { type: "hideNumbers" }],
    ["no flags", { type: "hideNumbers" }],
    ["flag 12", { type: "clickNumber", n: 12 }],
    ["click flag seven", { type: "clickNumber", n: 7 }],
    ["hide numbers", { type: "hideNumbers" }],
    ["press enter", { type: "pressKey", key: "Enter" }],
    ["hit escape", { type: "pressKey", key: "Escape" }],
    ["close the popup", { type: "pressKey", key: "Escape" }],
    ["pause", { type: "media", action: "pause" }],
    ["play the video", { type: "media", action: "play" }],
    ["skip ahead 30 seconds", { type: "media", action: "forward", seconds: 30 }],
    ["go back ten seconds", { type: "media", action: "rewind", seconds: 10 }],
    ["mute", { type: "muteTab", muted: true }],
    ["zoom in", { type: "zoom", direction: "in" }],
    ["read this page", { type: "readPage" }],
    ["where am I", { type: "whereAmI" }],
    ["stop", { type: "stop" }],
    ["never mind", { type: "stop" }],
    ["go to sleep", { type: "sleep" }],
    ["that's all", { type: "sleep" }],
    ["what can I say", { type: "help" }],
  ];
  it.each(cases)("%s", (text, expected) => {
    expect(parseCommand(text)).toEqual(expected);
  });

  it("opens known sites and spoken domains", () => {
    expect(parseCommand("open YouTube")).toMatchObject({ type: "open", url: "https://www.youtube.com", newTab: true });
    expect(parseCommand("go to github dot com")).toMatchObject({ type: "open", url: "https://github.com" });
    expect(parseCommand("take me to docs.python.org")).toMatchObject({ type: "open", url: "https://docs.python.org" });
    expect(parseCommand("open gmail in a new tab")).toMatchObject({ type: "open", url: "https://mail.google.com", newTab: true });
    expect(parseCommand("search youtube for lofi beats in a new tab")).toMatchObject({
      type: "search",
      engine: "youtube",
      query: "lofi beats",
      newTab: true,
    });
    expect(parseCommand("search for cats")).toMatchObject({ type: "search", query: "cats", newTab: false });
    expect(parseCommand("pull up my email")).toMatchObject({ type: "open", url: "https://mail.google.com" });
  });

  it("searches, including site-specific search", () => {
    expect(parseCommand("search for pizza near me")).toMatchObject({
      type: "search",
      engine: "google",
      url: "https://www.google.com/search?q=pizza%20near%20me",
    });
    expect(parseCommand("search youtube for lofi beats")).toMatchObject({
      type: "search",
      engine: "youtube",
      query: "lofi beats",
    });
    expect(parseCommand("look up airpods on amazon")).toMatchObject({ type: "search", engine: "amazon", query: "airpods" });
  });

  it("sets the video's volume when the phrase names the volume", () => {
    for (const said of ["volume 45", "set the volume to 45", "Turn volume to 45.", "set volume to 45 percent"]) {
      expect(parseCommand(said), said).toEqual({ type: "media", action: "volume", volume: 45 });
    }
    expect(parseCommand("volume 0")).toEqual({ type: "media", action: "volume", volume: 0 });
    // "to" sounds like "two", but a cut-off phrase isn't a volume of 2%.
    expect(parseCommand("turn the volume to")).toBeNull();
    expect(parseCommand("volume 450")).toBeNull();
    expect(parseCommand("lower the volume")).toEqual({ type: "media", action: "volumeDown" });
    expect(parseCommand("turn the volume up a bit")).toEqual({ type: "media", action: "volumeUp" });
  });

  it("turns Navi off (not just asleep) when asked", () => {
    for (const said of ["turn off", "turn yourself off", "turn off navi", "navi off", "turn the mic off", "turn off the microphone", "shut down"]) {
      expect(parseCommand(said), said).toEqual({ type: "turnOff" });
    }
    expect(parseCommand("go to sleep")).toEqual({ type: "sleep" });
    expect(parseCommand("turn off autoplay")).not.toEqual({ type: "turnOff" });
  });

  it("leaves phrases that depend on what was just said to the router and AI", () => {
    // "Turn it to 30" after asking about a game's difficulty isn't the volume; "unflag" in a mail app isn't the flags.
    for (const said of ["turn it to 30", "turn it up", "turn down", "turn it down more", "unflag", "on flag", "flag", "open your tab"]) {
      expect(parseCommand(said), said).toBeNull();
    }
  });

  it("shows and hides flags when the phrase names them", () => {
    for (const said of ["flags", "show me the flags", "turn the flags on", "flags please"]) {
      expect(parseCommand(said), said).toEqual({ type: "showNumbers" });
    }
    for (const said of ["hide flags", "turn off the flags", "turn the flags off", "no more flags", "flags away"]) {
      expect(parseCommand(said), said).toEqual({ type: "hideNumbers" });
    }
  });

  it("the verb decides the tab: open means a new tab, go to means this one", () => {
    for (const said of ["open youtube", "launch youtube", "pull up youtube", "go to youtube in a new tab"]) {
      expect(parseCommand(said), said).toMatchObject({ type: "open", url: "https://www.youtube.com", newTab: true });
    }
    for (const said of ["go to youtube", "take me to youtube", "visit youtube", "open youtube here", "open youtube in this tab"]) {
      expect(parseCommand(said), said).toMatchObject({ type: "open", url: "https://www.youtube.com", newTab: false });
    }
    expect(parseCommand("search for lofi")).toMatchObject({ newTab: false });
    expect(parseCommand("search youtube for lofi in a new tab")).toMatchObject({ newTab: true });
  });

  it("marks a plain search so it can stay on the current site, but not an explicit Google search", () => {
    expect(parseCommand("search for mrwhosetheboss")).toMatchObject({ type: "search", engine: "google", onSite: true });
    expect(parseCommand("look up lofi beats")).toMatchObject({ type: "search", onSite: true });
    expect(parseCommand("google mrwhosetheboss")).toMatchObject({ type: "search", engine: "google", query: "mrwhosetheboss" });
    expect(parseCommand("google mrwhosetheboss")).not.toHaveProperty("onSite");
    expect(parseCommand("search youtube for lofi beats")).not.toHaveProperty("onSite");
  });

  it("searches the current site's own search box", () => {
    expect(parseCommand("search this site for airpods")).toEqual({ type: "siteSearch", query: "airpods" });
    expect(parseCommand("search for backpacks on this store")).toEqual({ type: "siteSearch", query: "backpacks" });
  });

  it("types into the focused field or a numbered one", () => {
    expect(parseCommand("type hello world")).toEqual({ type: "type", text: "hello world", submit: false });
    expect(parseCommand("type cats and press enter")).toEqual({ type: "type", text: "cats", submit: true });
    expect(parseCommand("type hello into 5")).toEqual({ type: "type", text: "hello", target: 5, submit: false });
  });

  it("clicks by label", () => {
    expect(parseCommand("click sign in")).toEqual({ type: "clickText", text: "sign in" });
    expect(parseCommand("click the subscribe button")).toEqual({ type: "clickText", text: "subscribe" });
  });

  it("leaves open-ended requests to the AI", () => {
    for (const text of [
      "open the first video",
      "reply to Sarah saying I'll be late",
      "what's on this page",
      "summarize this article",
      "type hello in the search box",
      "write an email to my professor",
      "like this post",
      "send it",
    ]) {
      expect(parseCommand(text), text).toBeNull();
    }
  });
});

describe("wake phrase", () => {
  const aliases = wakeAliases("Navi");
  it("detects and strips the wake phrase, including common mishearings", () => {
    expect(stripWakePhrase("Hey Navi, scroll down", aliases)).toEqual({ woke: true, rest: "scroll down" });
    expect(stripWakePhrase("hey navy open youtube", aliases)).toEqual({ woke: true, rest: "open youtube" });
    expect(stripWakePhrase("Navi", aliases)).toEqual({ woke: true, rest: "" });
    // "Navigator", Navi's full name, wakes it too: recognizers spell a dictionary word reliably.
    expect(stripWakePhrase("Hey Navigator, open YouTube", aliases)).toEqual({ woke: true, rest: "open YouTube" });
    expect(stripWakePhrase("navigator scroll down", aliases)).toEqual({ woke: true, rest: "scroll down" });
    expect(stripWakePhrase("hey navvy scroll down", aliases)).toEqual({ woke: true, rest: "scroll down" });
    // Parakeet punctuates.
    expect(stripWakePhrase("Hey, Navi. Open YouTube.", aliases)).toEqual({ woke: true, rest: "Open YouTube." });
    expect(stripWakePhrase("So, hey, Navi, scroll down.", aliases, true)).toEqual({ woke: true, rest: "scroll down." });
    expect(stripWakePhrase("okay navi go back", aliases)).toEqual({ woke: true, rest: "go back" });
  });
  it("ignores speech without the wake phrase", () => {
    expect(stripWakePhrase("scroll down", aliases).woke).toBe(false);
    expect(stripWakePhrase("the navy seals", aliases).woke).toBe(false);
    // Misheard spellings are real words, so they only count after "hey"/"ok".
    expect(stripWakePhrase("navy blue shirts", aliases).woke).toBe(false);
    expect(stripWakePhrase("Navi, go back", aliases)).toEqual({ woke: true, rest: "go back" });
  });
  it("supports custom names", () => {
    expect(stripWakePhrase("hey jarvis close tab", wakeAliases("Jarvis"))).toEqual({ woke: true, rest: "close tab" });
  });
});

describe("mouse grid commands", () => {
  it("shows and hides the grid", () => {
    expect(parseCommand("show grid")).toEqual({ type: "showGrid" });
    expect(parseCommand("grid")).toEqual({ type: "showGrid" });
    expect(parseCommand("hide the grid")).toEqual({ type: "hideGrid" });
  });
  it("treats numbers as blocks while the grid is up", () => {
    expect(parseGridCommand("5")).toEqual({ type: "zoom", cells: [5] });
    expect(parseGridCommand("seven")).toEqual({ type: "zoom", cells: [7] });
    expect(parseGridCommand("zoom into 3")).toEqual({ type: "zoom", cells: [3] });
    expect(parseGridCommand("click")).toEqual({ type: "click" });
    expect(parseGridCommand("click 9")).toEqual({ type: "click", cells: [9] });
    expect(parseGridCommand("click here")).toEqual({ type: "click" });
    expect(parseGridCommand("go back")).toEqual({ type: "back" });
    expect(parseGridCommand("cancel")).toEqual({ type: "hide" });
    expect(parseGridCommand("10")).toBeNull();
    expect(parseGridCommand("scroll down")).toBeNull();
  });
});

describe("forgiving matching (real-world phrasing and mishearings)", () => {
  it("understands looser scroll phrasing", () => {
    expect(parseCommand("scroll down further")).toEqual({ type: "scroll", direction: "down", amount: "page" });
    expect(parseCommand("can you scroll up just a little bit more")).toEqual({ type: "scroll", direction: "up", amount: "small" });
    expect(parseCommand("scroll way down")).toEqual({ type: "scroll", direction: "down", amount: "large" });
    expect(parseCommand("keep scrolling down")).toEqual({ type: "scroll", direction: "down", amount: "page" });
    expect(parseCommand("scroll all the way to the top")).toMatchObject({ type: "scroll", direction: "top" });
  });
  it("handles the name tacked onto commands and misheard names", () => {
    expect(parseCommand("Navi sleep")).toEqual({ type: "sleep" });
    expect(parseCommand("Havi sleep")).toEqual({ type: "sleep" });
    expect(parseCommand("sleep navi")).toEqual({ type: "sleep" });
    expect(parseCommand("goodnight")).toEqual({ type: "sleep" });
    expect(parseCommand("scroll down navi")).toMatchObject({ type: "scroll", direction: "down" });
    expect(parseCommand("don't go to sleep yet, open youtube")).not.toEqual({ type: "sleep" });
  });
  it("corrects near-miss transcriptions", () => {
    expect(parseCommand("scrawl down")).toMatchObject({ type: "scroll", direction: "down" });
    expect(parseCommand("show nombers")).toEqual({ type: "showNumbers" });
    expect(parseCommand("close tap")).toEqual({ type: "closeTab" });
  });
});

describe("everyday phrasings", () => {
  const cases: [string, object][] = [
    ["what did you say", { type: "repeat" }],
    ["say that again", { type: "repeat" }],
    ["sorry what", { type: "repeat" }],
    ["thanks", { type: "ack" }],
    ["are you there", { type: "ack", reply: "I'm here." }],
    ["hold on", { type: "stop" }],
    ["shh", { type: "stop" }],
    ["talk louder", { type: "voice", change: "louder" }],
    ["too loud", { type: "voice", change: "quieter" }],
    ["speak slower", { type: "voice", change: "slower" }],
    ["keep scrolling", { type: "scroll", direction: "down", amount: "page" }],
    ["a little more", { type: "scroll", direction: "down", amount: "small" }],
    ["back up", { type: "scroll", direction: "up", amount: "page" }],
    ["back to the top", { type: "scroll", direction: "top", amount: "page" }],
    ["start scrolling", { type: "autoScroll", action: "start" }],
    ["stop scrolling", { type: "autoScroll", action: "stop" }],
    ["scroll faster", { type: "autoScroll", action: "faster" }],
    ["slower", { type: "fasterSlower", direction: "slower" }],
    ["go back three pages", { type: "backN", times: 3 }],
    ["go home", { type: "siteHome" }],
    ["next page", { type: "nextPage" }],
    ["close all the other tabs", { type: "closeOtherTabs" }],
    ["duplicate this tab", { type: "duplicateTab" }],
    ["pin this tab", { type: "pinTab", pinned: true }],
    ["last tab", { type: "switchTab", index: -1 }],
    ["switch back", { type: "switchBack" }],
    ["go back to the other tab", { type: "switchBack" }],
    ["find recipes", { type: "find", text: "recipes" }],
    ["search this page for price", { type: "find", text: "price" }],
    ["next match", { type: "find" }],
    ["select all", { type: "edit", action: "selectAll" }],
    ["undo that", { type: "edit", action: "undo" }],
    ["clear the box", { type: "edit", action: "clear" }],
    ["new line", { type: "edit", action: "newline" }],
    ["make it bigger", { type: "zoom", direction: "in" }],
    ["what time is it", { type: "time" }],
    ["what day is it", { type: "date" }],
    ["stop the video", { type: "media", action: "pause" }],
    ["exit full screen", { type: "media", action: "exitFullscreen" }],
    ["speed it up", { type: "media", action: "faster" }],
    ["normal speed", { type: "media", action: "normalSpeed" }],
    ["turn the volume up", { type: "media", action: "volumeUp" }],
    ["start over", { type: "media", action: "restart" }],
  ];
  it.each(cases)("%s", (text, expected) => {
    expect(parseCommand(text)).toEqual(expected);
  });
  it("still sends real requests onward", () => {
    for (const text of ["open the first result", "reply to this email saying thanks", "what's on this page"]) {
      expect(parseCommand(text), text).toBeNull();
    }
  });
});

describe("wake phrase with stray words", () => {
  const words = wakeAliases("Navi");
  it("tolerates up to three stray words before the name only when asked (asleep)", () => {
    expect(stripWakePhrase("I tiktok tiktok Navi open wikipedia", words, true)).toEqual({ woke: true, rest: "open wikipedia" });
    expect(stripWakePhrase("uh hey navi scroll down", words, true)).toEqual({ woke: true, rest: "scroll down" });
    expect(stripWakePhrase("I tiktok tiktok Navi open wikipedia", words).woke).toBe(false);
    expect(stripWakePhrase("one two three four navi scroll down", words, true).woke).toBe(false);
  });
  it("leaves the name alone mid-command once awake", () => {
    expect(stripWakePhrase("open navi settings", words)).toEqual({ woke: false, rest: "open navi settings" });
  });
});

describe("fuzzy wake word", () => {
  const words = wakeAliases("Navi");
  it("wakes on close-sounding names after a greeting", () => {
    expect(stripWakePhrase("hey navvy open youtube", words)).toEqual({ woke: true, rest: "open youtube" });
    expect(stripWakePhrase("Hey Nabi, scroll down", words)).toEqual({ woke: true, rest: "scroll down" });
    expect(stripWakePhrase("heynavi open gmail", words)).toEqual({ woke: true, rest: "open gmail" });
    expect(stripWakePhrase("so um hey novi go back", words, true)).toEqual({ woke: true, rest: "go back" });
  });
  it("ignores unrelated names and words", () => {
    expect(stripWakePhrase("hey nancy how are you", words).woke).toBe(false);
    expect(stripWakePhrase("hey maybe later", words).woke).toBe(false);
    expect(stripWakePhrase("the navy ship", words, true).woke).toBe(false);
  });
});

describe("closing tabs by name", () => {
  it("names a tab without ever meaning the current one", () => {
    expect(parseCommand("close the reddit tab")).toEqual({ type: "closeNamedTab", query: "reddit", saidTab: true });
    expect(parseCommand("close youtube")).toEqual({ type: "closeNamedTab", query: "youtube", saidTab: false });
    expect(parseCommand("close the tab")).toEqual({ type: "closeTab" });
    expect(parseCommand("close this tab")).toEqual({ type: "closeTab" });
    expect(parseCommand("close other tabs")).toEqual({ type: "closeOtherTabs" });
    expect(parseCommand("close it")).toBeNull();
    expect(parseCommand("close tap")).toEqual({ type: "closeTab" });
    expect(parseCommand("close the popup")).not.toMatchObject({ type: "closeNamedTab" });
  });
});

describe("mouse grid: sequences, clicks and closing", () => {
  it.each([
    ["5 3", [5, 3]],
    ["five three", [5, 3]],
    ["5, 3, 7", [5, 3, 7]],
    ["five three seven", [5, 3, 7]],
    ["5 and then 3", [5, 3]],
    ["five-three", [5, 3]],
    // Speech engines merge digits said in a row.
    ["53", [5, 3]],
    ["537", [5, 3, 7]],
    ["12", [1, 2]],
    ["number 5 3", [5, 3]],
    ["go to 9", [9]],
    ["zoom in on four", [4]],
    // Homophones said on their own.
    ["to", [2]],
    ["for", [4]],
  ])("zooms: %s", (text, cells) => {
    expect(parseGridCommand(text)).toEqual({ type: "zoom", cells });
  });

  it("only takes cells 1-9, at most four levels' worth", () => {
    for (const text of ["10", "0", "twelve", "fifty three", "5 3 7 2 1", "53721", "5 potato"]) {
      expect(parseGridCommand(text), text).toBeNull();
    }
  });

  it("clicks the current block, a block inside it, or a path of blocks", () => {
    expect(parseGridCommand("click")).toEqual({ type: "click" });
    expect(parseGridCommand("click it")).toEqual({ type: "click" });
    expect(parseGridCommand("tap the middle")).toEqual({ type: "click" });
    expect(parseGridCommand("click 7")).toEqual({ type: "click", cells: [7] });
    expect(parseGridCommand("click on seven")).toEqual({ type: "click", cells: [7] });
    expect(parseGridCommand("click 5 3")).toEqual({ type: "click", cells: [5, 3] });
    expect(parseGridCommand("click five three")).toEqual({ type: "click", cells: [5, 3] });
    expect(parseGridCommand("click 53")).toEqual({ type: "click", cells: [5, 3] });
    expect(parseGridCommand("left click 2")).toEqual({ type: "click", cells: [2] });
  });

  it("double and right clicks", () => {
    expect(parseGridCommand("double click")).toEqual({ type: "doubleClick" });
    expect(parseGridCommand("double-click 4")).toEqual({ type: "doubleClick", cells: [4] });
    expect(parseGridCommand("doubleclick five three")).toEqual({ type: "doubleClick", cells: [5, 3] });
    expect(parseGridCommand("right click")).toEqual({ type: "rightClick" });
    expect(parseGridCommand("right-click 2 6")).toEqual({ type: "rightClick", cells: [2, 6] });
  });

  it("leaves other clicks and commands to the normal parser", () => {
    for (const text of ["click sign in", "press enter", "select all", "zoom in", "scroll down", "open youtube"]) {
      expect(parseGridCommand(text), text).toBeNull();
    }
  });

  it("zooms out, starts over and closes", () => {
    for (const text of ["back", "out", "zoom out", "go back", "back up"]) expect(parseGridCommand(text), text).toEqual({ type: "back" });
    for (const text of ["show grid", "grid", "grid on", "reset the grid", "start over"]) {
      expect(parseGridCommand(text), text).toEqual({ type: "show" });
    }
    for (const text of ["hide grid", "grid off", "close grid", "close the grid", "cancel", "never mind", "turn off the grid"]) {
      expect(parseGridCommand(text), text).toEqual({ type: "hide" });
    }
  });

  it("turns the grid on and off from anywhere", () => {
    for (const text of ["grid on", "show the mouse grid", "turn on the grid"]) expect(parseCommand(text), text).toEqual({ type: "showGrid" });
    for (const text of ["grid off", "close grid", "turn off the grid", "hide the mouse grid"]) {
      expect(parseCommand(text), text).toEqual({ type: "hideGrid" });
    }
  });
});

describe("Navi's window", () => {
  it("pins Navi to this window, and unpins it", () => {
    for (const text of ["pin navi to this window", "pin yourself here", "make this the navi window", "keep navi in this window", "stay in this window"]) {
      expect(parseCommand(text), text).toEqual({ type: "pinWindow", on: true });
    }
    for (const text of ["unpin navi", "unpin this window", "follow me", "navi follow me", "follow my window"]) {
      expect(parseCommand(text), text).toEqual({ type: "pinWindow", on: false });
    }
    // Pinning tabs is something else.
    expect(parseCommand("pin this tab")).toEqual({ type: "pinTab", pinned: true });
    expect(parseCommand("unpin tab")).toEqual({ type: "pinTab", pinned: false });
  });
});
