// Navi's own parser on each phrase: what the benchmark expects the recognizer's words to run.
// Usage: node bench/asr/expect.mjs <parser bundle> <phrases.txt>  (prints JSON)
import { readFileSync } from "node:fs";
const [bundle, file] = process.argv.slice(2);
const { parseCommand } = await import(new URL(bundle, `file://${process.cwd()}/`).href);
let group = "";
const out = [];
for (const raw of readFileSync(file, "utf8").split("\n")) {
  const line = raw.trim();
  if (!line || line.startsWith("#")) continue;
  const g = /^\[(.+)\]$/.exec(line);
  if (g) { group = g[1]; continue; }
  out.push({ text: line, group, intent: parseCommand(line) });
}
console.log(JSON.stringify(out, null, 1));
