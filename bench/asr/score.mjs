// Scores recognizer output by what Navi would do with it: its own parser on the words heard.
// Usage: node bench/asr/score.mjs <parser bundle> <phrases.json> <transcripts.json>... [--md out.md] [--misses out.json]
//
// Per clip: correct (the command meant runs), wrong (another command runs: the dangerous case),
// missed (no built-in command; the words go to the AI router, which may or may not recover), or
// empty (the recognizer heard nothing: "it didn't register"). For phrases meant for the AI, a built-in
// command running is wrong; anything else is fine. WER is word error rate against the phrase as said.
import { readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};
const mdOut = flag("--md");
const missOut = flag("--misses");
const [bundle, phrasesFile, ...files] = args;
const { parseCommand } = await import(new URL(bundle, `file://${process.cwd()}/`).href);
const phrases = JSON.parse(readFileSync(phrasesFile, "utf8"));
const FREE = ["text", "query", "url", "label", "title", "name"];
const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
const words = (s) => String(s).toLowerCase().replace(/[^a-z0-9' ]+/g, " ").split(/\s+/).filter(Boolean);
const NUM = { five: "5", twelve: "12", three: "3", thirty: "30", ten: "10" };
const canonWords = (s) => words(s).map((w) => NUM[w] ?? w);

function same(a, b) {
  if (!a || !b || a.type !== b.type) return false;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    if (k === "type") continue;
    if (FREE.includes(k)) {
      if (norm(a[k]) !== norm(b[k])) return false;
    } else if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) return false;
  }
  return true;
}

function wer(ref, hyp) {
  const r = canonWords(ref), h = canonWords(hyp);
  const d = Array.from({ length: r.length + 1 }, (_, i) => [i, ...Array(h.length).fill(0)]);
  for (let j = 1; j <= h.length; j++) d[0][j] = j;
  for (let i = 1; i <= r.length; i++)
    for (let j = 1; j <= h.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (r[i - 1] === h[j - 1] ? 0 : 1));
  return { errors: d[r.length][h.length], n: r.length };
}

const rows = [];
const misses = [];
for (const file of files) {
  const run = JSON.parse(readFileSync(file, "utf8"));
  const condition = run.clips.split("/").filter(Boolean).pop();
  const tally = {};
  const bump = (group, key) => {
    for (const g of [group, "all"]) {
      tally[g] ??= { n: 0, correct: 0, wrong: 0, missed: 0, empty: 0, werErr: 0, werN: 0 };
      tally[g][key]++;
    }
  };
  for (const r of run.results) {
    const p = phrases[r.phrase];
    const got = r.heard ? parseCommand(r.heard) : null;
    const w = wer(p.text, r.heard);
    let outcome;
    if (!r.heard.trim()) outcome = "empty";
    else if (p.intent === null) outcome = got ? "wrong" : "correct";
    else if (same(got, p.intent)) outcome = "correct";
    else outcome = got ? "wrong" : "missed";
    for (const g of [p.group, "all"]) {
      tally[g] ??= { n: 0, correct: 0, wrong: 0, missed: 0, empty: 0, werErr: 0, werN: 0 };
      tally[g].n++;
      tally[g][outcome]++;
      tally[g].werErr += w.errors;
      tally[g].werN += w.n;
    }
    if (outcome !== "correct") misses.push({ model: run.model, condition, said: p.text, heard: r.heard, outcome, got, voice: r.voice });
  }
  rows.push({ model: run.model, condition, speed: run.audio_seconds / run.seconds, tally });
}

const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : "–");
const lines = ["| Recognizer | Audio | Correct | Wrong command | Not understood | Heard nothing | WER | Single words correct | Speed |", "|---|---|---|---|---|---|---|---|---|"];
for (const r of rows) {
  const t = r.tally.all, s = r.tally.single ?? { n: 0, correct: 0 };
  lines.push(`| ${r.model} | ${r.condition} | ${pct(t.correct, t.n)} | ${pct(t.wrong, t.n)} | ${pct(t.missed, t.n)} | ${pct(t.empty, t.n)} | ${pct(t.werErr, t.werN)} | ${pct(s.correct, s.n)} | ${r.speed.toFixed(1)}x |`);
}
const md = lines.join("\n");
console.log(md);
if (mdOut) writeFileSync(mdOut, md + "\n");
if (missOut) writeFileSync(missOut, JSON.stringify(misses, null, 0));
