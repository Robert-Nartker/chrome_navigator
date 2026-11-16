// The command router on real speech from the usage log: what it should and shouldn't turn into a command.
// Usage: npx tsx bench/router/eval.ts [router module path] [runs]   (OPENAI_API_KEY, or a proxy that adds it:
// NODE_USE_ENV_PROXY=1 for Node's fetch to use HTTPS_PROXY)
// Results 2026-11-16, 3 runs each: the old prompt 82/90 acceptable with 4 wrong commands; tightened + the
// personal-command guard 87/90 with none. With the video cases (38 phrases): before telling the router whether
// a video is playing 91/114, after 105/114, wrong commands 2 either way.
import { pathToFileURL } from "node:url";
import { heardPhrase } from "../../src/lib/custom-commands";
import { DEFAULT_SETTINGS } from "../../src/lib/settings";

type Case = { heard: string; ok: (string | RegExp)[]; title?: string; video?: "playing" | "paused" };
// "ignore" and "agent" are routes; anything else is an acceptable command (a RegExp matches the command text).
const IGNORE_OR = (...more: (string | RegExp)[]) => ["ignore", "agent", ...more];
const CASES: Case[] = [
  // Misheard, from the log: never the user's "open news", never the opposite command.
  { heard: "Open muted.", ok: IGNORE_OR(/youtube/) },
  { heard: "We're in a new tab.", ok: IGNORE_OR("new tab") },
  { heard: "Open Utah.", ok: IGNORE_OR(/youtube/) },
  { heard: "Open them too.", ok: IGNORE_OR(/youtube/) },
  { heard: "those tab.", ok: ["ignore", "close tab"] },
  { heard: "those have", ok: ["ignore", "close tab"] },
  { heard: "Still", ok: ["ignore"] },
  { heard: "Post-habit.", ok: ["ignore"] },
  { heard: "First ad.", ok: IGNORE_OR() },
  { heard: "It was sad.", ok: ["ignore"] },
  { heard: "Still there.", ok: IGNORE_OR() },
  { heard: "It's cool, love.", ok: ["ignore"] },
  { heard: "Scored.", ok: IGNORE_OR(/^scroll/) },
  { heard: "Spoiler line.", ok: ["ignore"] },
  { heard: "I think you do.", ok: ["ignore"] },
  { heard: "Hold down", ok: ["ignore", "scroll down"] },
  { heard: "What was this dad too?", ok: IGNORE_OR() },
  { heard: "How's that still?", ok: IGNORE_OR() },
  // Said differently, and should still run.
  { heard: "Actually go to YouTube instead.", ok: [/^(?:go to|open) youtube/] },
  { heard: "Put a new tab in open YouTube.", ok: [/^open youtube/] },
  { heard: "Cycle one tab left", ok: ["previous tab"] },
  { heard: "Cycle one tab right", ok: ["next tab"] },
  { heard: "For the news", ok: ["open news"] },
  { heard: "Muse whisper.", ok: ["use whisper"] },
  { heard: "Miss parakeet", ok: ["use parakeet"] },
  { heard: "Open you do.", ok: [/^open youtube/] },
  { heard: "closes the head.", ok: ["close tab", "ignore"] },
  { heard: "Can you resume the video I'm watching?", ok: ["play", "agent"] },
  { heard: "Click on the GTA video.", ok: ["agent"] },
  { heard: "Play the third video.", ok: ["agent"] },
  // "Pause the video" with its first word lost (Chrome's recognizer, AirPods): from the log.
  { heard: "Video.", video: "playing", ok: ["pause"] },
  { heard: "There's a video", video: "playing", ok: ["pause"] },
  { heard: "Here's the video", video: "playing", ok: ["pause"] },
  { heard: "Just the video.", video: "playing", ok: ["pause"] },
  { heard: "Video.", video: "paused", ok: ["play"] },
  { heard: "There's a video", ok: ["ignore", "agent"] },
  { heard: "Play the first video.", video: "paused", ok: ["agent"] },
  { heard: "What's the video?", video: "playing", ok: ["agent"] },
];

const [modulePath = "src/lib/router.ts", runsArg = "3"] = process.argv.slice(2);
const { routeUtterance } = (await import(pathToFileURL(modulePath).href)) as typeof import("../../src/lib/router");
const settings = { ...DEFAULT_SETTINGS, openaiKey: process.env.OPENAI_API_KEY ?? "sk-proxy" };
const runs = Number(runsArg);
let good = 0, total = 0, wrongCommands = 0;
for (const c of CASES) {
  const got: string[] = [];
  for (let i = 0; i < runs; i++) {
    // A failed call (OpenAI's moderation sometimes flags a garbled phrase) goes to the main AI in Navi.
    const decision = await routeUtterance(c.heard, { title: c.title ?? "YouTube", video: c.video, personalPhrases: ["open news"] }, settings, new AbortController().signal).then(
      (r) => r.decision,
      () => ({ route: "agent" as const }),
    );
    let label = decision.route === "command" ? decision.command.toLowerCase().replace(/[.!?]$/, "") : decision.route;
    // Navi's guard on personal commands (in the controller).
    if (label === "open news" && !heardPhrase(c.heard, "open news")) label = "ignore (guard)";
    got.push(label);
    const fine = c.ok.some((o) => (typeof o === "string" ? o === label.replace(" (guard)", "") : o.test(label)));
    good += fine ? 1 : 0;
    total++;
    if (!fine && !["ignore", "agent", "ignore (guard)"].includes(label)) wrongCommands++;
  }
  const fine = (g: string) => c.ok.some((o) => (typeof o === "string" ? o === g.replace(" (guard)", "") : o.test(g)));
  console.log(`${got.every(fine) ? "  " : "✗ "}${c.heard.padEnd(40)} → ${got.join(" | ")}`);
}
console.log(`\n${modulePath}: ${good}/${total} acceptable, ${wrongCommands} wrong commands`);
