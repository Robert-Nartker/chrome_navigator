import { describe, expect, it } from "vitest";
import { tabMatches } from "../../src/lib/browser";

describe("“close <name> tab”: which tab a name means", () => {
  const tab = (title: string, url = "https://example.com/") => ({ title, url });
  it("a word of the title, from its start, or the site's name", () => {
    expect(tabMatches(tab("Easy Pasta Recipe"), "recipe")).toBe(true);
    expect(tabMatches(tab("Inbox (3) - Gmail", "https://mail.google.com/"), "gmail")).toBe(true);
    expect(tabMatches(tab("Lofi beats", "https://www.youtube.com/watch"), "youtube")).toBe(true);
    expect(tabMatches(tab("You Tube Music"), "youtube")).toBe(true);
    expect(tabMatches(tab("Standing desks - Desk Shop"), "desk shop")).toBe(true);
  });
  it("not letters inside a word: “close up” (misheard “close tab”) isn't a tab called “Setup”", () => {
    expect(tabMatches(tab("Setup"), "up")).toBe(false);
    expect(tabMatches(tab("Sign up for free"), "up")).toBe(false);
    expect(tabMatches(tab("Downloads"), "down")).toBe(false);
    expect(tabMatches(tab("Easy Pasta Recipes"), "recipe")).toBe(true);
    expect(tabMatches(tab("Countdown timer"), "down")).toBe(false);
    expect(tabMatches(tab("Target: weekly ad"), "get")).toBe(false);
    // Only a plural ending, not any two letters: "set" isn't "Setup", "car" isn't "Cart".
    expect(tabMatches(tab("Setup"), "set")).toBe(false);
    expect(tabMatches(tab("Shopping Cart"), "car")).toBe(false);
  });
  it("a short name only as a site's whole name", () => {
    expect(tabMatches(tab("Home / X", "https://x.com/home"), "x")).toBe(true);
    expect(tabMatches(tab("Sign up", "https://example.com/"), "up")).toBe(false);
  });
});
