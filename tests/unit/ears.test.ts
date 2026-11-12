import { describe, expect, it } from "vitest";
import { isEcho } from "../../src/ears/ears";

describe("isEcho", () => {
  const saying = "I opened YouTube and searched for lofi beats. Want me to play the first one?";
  it("recognizes Navi hearing its own voice", () => {
    expect(isEcho("searched for lofi beats", saying)).toBe(true);
    expect(isEcho("want me to play the first one", saying)).toBe(true);
    expect(isEcho("", saying)).toBe(true);
  });
  it("lets the user talk over Navi", () => {
    expect(isEcho("close this tab", saying)).toBe(false);
    expect(isEcho("no, open spotify instead", saying)).toBe(false);
    expect(isEcho("scroll down", "")).toBe(false);
    // Little words in common don't make it an echo.
    expect(isEcho("go to sleep", "Sorry. I heard “go to the top”. I've noted it, so it can be fixed.")).toBe(false);
    expect(isEcho("open the settings", "I opened the page for you.")).toBe(false);
  });
});
