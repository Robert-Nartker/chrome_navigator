import { describe, expect, it } from "vitest";
import { spaced, withoutLastWords } from "../../src/lib/typing";
import { parseCommand } from "../../src/lib/parser";

describe("dictating in pieces", () => {
  it("puts a space between words, but not before punctuation or after an opening bracket", () => {
    expect(spaced("hello", "world")).toBe(" world");
    expect(spaced("hello ", "world")).toBe("world");
    expect(spaced("", "hello")).toBe("hello");
    expect(spaced("hello", ", world")).toBe(", world");
    expect(spaced("hello", "!")).toBe("!");
    expect(spaced("call me (", "maybe")).toBe("maybe");
    expect(spaced("sam@", "example.com")).toBe("example.com");
  });
  it("takes off the last few words", () => {
    expect(withoutLastWords("hello big wide world", 2)).toBe("hello big");
    expect(withoutLastWords("hello world  ", 1)).toBe("hello");
    expect(withoutLastWords("one", 3)).toBe("");
  });
  it("types what was said, as it was said", () => {
    expect(parseCommand("type Dear Sarah, thanks!")).toMatchObject({ type: "type", text: "Dear Sarah, thanks!" });
    expect(parseCommand("Type I'll be there at 5, OK?")).toMatchObject({ text: "I'll be there at 5, OK?" });
    // Chrome's own period at the end goes; one the user means (an abbreviation, an ellipsis) stays.
    expect(parseCommand("type Hello, World.")).toMatchObject({ text: "Hello, World" });
    expect(parseCommand("please type Mr. Smith.")).toMatchObject({ text: "Mr. Smith" });
    expect(parseCommand("dictate See you soon...")).toMatchObject({ text: "See you soon..." });
    expect(parseCommand("Type cats into 5 and press enter.")).toEqual({ type: "type", text: "cats", target: 5, submit: true });
    expect(parseCommand("type hello world and then hit enter")).toEqual({ type: "type", text: "hello world", submit: true });
  });
  it("understands how people correct dictation", () => {
    expect(parseCommand("delete that")).toEqual({ type: "edit", action: "deleteLast" });
    expect(parseCommand("delete what you just typed")).toEqual({ type: "edit", action: "deleteLast" });
    expect(parseCommand("delete the last word")).toEqual({ type: "edit", action: "deleteWords", count: 1 });
    expect(parseCommand("delete the last three words")).toEqual({ type: "edit", action: "deleteWords", count: 3 });
    expect(parseCommand("delete 2 words")).toEqual({ type: "edit", action: "deleteWords", count: 2 });
  });
});
