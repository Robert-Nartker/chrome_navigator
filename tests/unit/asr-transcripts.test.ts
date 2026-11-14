import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseCommand } from "../../src/lib/parser";
import { cleanTranscript } from "../../src/voice/parakeet-langs";

/**
 * What real recognizers wrote for Navi's benchmark phrases (bench/asr), each distinct mishearing once.
 * A guard for parser changes: what's understood now must stay understood, and what runs a different
 * command must not grow. (Unique pairs weigh the hard cases heavily, so the share right looks low: an
 * exact transcript, the common case, is one pair however often it was heard.)
 */
const { pairs } = JSON.parse(readFileSync(path.resolve("tests/fixtures/asr-transcripts.json"), "utf8")) as { pairs: [string, string][] };

describe("real recognizer transcripts of the speech benchmark, through Navi's parser", () => {
  // Dictation keeps the capitals and commas as said ("Type Dear Sarah, thanks."): compare its words only.
  const plain = (intent: ReturnType<typeof parseCommand>) =>
    JSON.stringify(intent && "text" in intent && intent.type === "type" ? { ...intent, text: intent.text.toLowerCase().replace(/[^\w\s']/g, "").replace(/\s+/g, " ").trim() } : intent);
  const results = pairs.map(([heard, said]) => {
    const want = parseCommand(said);
    const got = parseCommand(cleanTranscript(heard));
    const right = plain(want) === plain(got);
    const wrong = !right && !!got && (!want || got.type !== want.type);
    return { heard, said, right, wrong };
  });

  it("understands at least as many as when this was recorded (2026-11-14)", () => {
    expect(results.filter((r) => r.right).length).toBeGreaterThanOrEqual(615);
  });

  it("runs a different command for no more than it did then", () => {
    const wrong = results.filter((r) => r.wrong);
    expect(wrong.length, wrong.map((r) => `${r.said} ← “${r.heard}”`).join("\n")).toBeLessThanOrEqual(66);
  });

  it("every exact transcript runs the command meant", () => {
    const exact = results.filter((r) => r.heard.toLowerCase().replace(/[.!?,]/g, "").trim() === r.said);
    expect(exact.length).toBeGreaterThan(50);
    expect(exact.filter((r) => !r.right).map((r) => r.heard)).toEqual([]);
  });
});
