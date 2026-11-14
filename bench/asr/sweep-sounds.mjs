// Which real English words, heard in place of a word of a short command, make Navi run a *different*
// built-in command? Each command word is swapped for every dictionary word that sounds close to it (by
// Navi's own sound key), and the result goes through Navi's parser. Opposites ("mute"/"unmute",
// "play"/"pause", "up"/"down") are the dangerous ones.
// Usage: node bench/asr/sweep-sounds.mjs <parser bundle> <sounds-like bundle> <word list (one word first per line)>
import { readFileSync } from "node:fs";
const [parserPath, soundsPath, wordsPath] = process.argv.slice(2);
const url = (p) => new URL(p, `file://${process.cwd()}/`).href;
const { parseCommand } = await import(url(parserPath));
const { soundKey, keyDistance } = await import(url(soundsPath));

const COMMANDS = [
  "pause", "play", "stop", "mute", "unmute", "louder", "quieter", "refresh", "help", "flags",
  "scroll up", "scroll down", "go back", "go forward", "zoom in", "zoom out", "next tab", "previous tab", "close tab", "new tab",
  "show flags", "hide flags", "show grid", "hide grid", "volume up", "volume down", "page up", "page down",
  "pause the video", "play the video", "mute the video", "unmute the video", "next heading", "next link", "next field",
  "go to sleep", "wake up", "turn off", "turn on", "stay awake", "speed up", "slow down", "full screen", "exit full screen",
];
// Common words only: short, alphabetic, and in the dictionary once.
const words = [...new Set(readFileSync(wordsPath, "utf8").split("\n").map((l) => l.split(/\s/)[0].toLowerCase()).filter((w) => /^[a-z']{2,9}$/.test(w)))];
const byKey = new Map();
for (const w of words) {
  const k = soundKey(w);
  if (!byKey.has(k)) byKey.set(k, []);
  byKey.get(k).push(w);
}
const keys = [...byKey.keys()];
const near = (word) => keys.filter((k) => keyDistance(k, soundKey(word)) <= 1).flatMap((k) => byKey.get(k));

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const found = [];
let tried = 0;
for (const command of COMMANDS) {
  const meant = parseCommand(command);
  const parts = command.split(" ");
  for (let i = 0; i < parts.length; i++) {
    for (const w of near(parts[i])) {
      if (w === parts[i]) continue;
      const said = [...parts.slice(0, i), w, ...parts.slice(i + 1)].join(" ");
      tried++;
      const got = parseCommand(said);
      if (got && !same(got, meant) && !("query" in got) && !("text" in got) && !("name" in got) && !("label" in got)) {
        found.push({ command, said, got: got.type + (got.action ? `:${got.action}` : "") + (got.direction ? `:${got.direction}` : "") + ("muted" in got ? `:muted=${got.muted}` : "") });
      }
    }
  }
}
console.log(`${tried} sound-alike variants of ${COMMANDS.length} commands; ${found.length} run a different built-in command:`);
for (const f of found) console.log(`  ${f.command.padEnd(18)} heard “${f.said}” → ${f.got}`);
