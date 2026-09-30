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
  });
});
