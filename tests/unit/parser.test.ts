import { describe, expect, it } from "vitest";
import { isLikelyNoise, normalize, parseCommand, parseGridCommand, stripWakePhrase, wakeAliases } from "../../src/lib/parser";

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
    expect(parseCommand("open YouTube")).toMatchObject({ type: "open", url: "https://www.youtube.com", newTab: false });
    expect(parseCommand("go to github dot com")).toMatchObject({ type: "open", url: "https://github.com" });
    expect(parseCommand("take me to docs.python.org")).toMatchObject({ type: "open", url: "https://docs.python.org" });
    expect(parseCommand("open gmail in a new tab")).toMatchObject({ type: "open", url: "https://mail.google.com", newTab: true });
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
    expect(parseGridCommand("5")).toEqual({ type: "zoom", cell: 5 });
    expect(parseGridCommand("seven")).toEqual({ type: "zoom", cell: 7 });
    expect(parseGridCommand("zoom into 3")).toEqual({ type: "zoom", cell: 3 });
    expect(parseGridCommand("click")).toEqual({ type: "click" });
    expect(parseGridCommand("click 9")).toEqual({ type: "click", cell: 9 });
    expect(parseGridCommand("click here")).toEqual({ type: "click" });
    expect(parseGridCommand("go back")).toEqual({ type: "back" });
    expect(parseGridCommand("cancel")).toEqual({ type: "hide" });
    expect(parseGridCommand("12")).toBeNull();
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

describe("noise filter", () => {
  it("flags keyboard noise and filler", () => {
    expect(isLikelyNoise("tiktok tiktok tiktok")).toBe(true);
    expect(isLikelyNoise("click click click click")).toBe(true);
    expect(isLikelyNoise("um")).toBe(true);
    expect(isLikelyNoise("yeah")).toBe(true);
  });
  it("keeps real requests", () => {
    expect(isLikelyNoise("open my latest email")).toBe(false);
    expect(isLikelyNoise("what is this article about")).toBe(false);
    expect(isLikelyNoise("wordle")).toBe(false);
  });
});
