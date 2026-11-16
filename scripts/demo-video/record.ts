// Records the demo in a real Chromium window: tabs, address bar and Navi in Chrome's own side panel, on
// real sites (Wikipedia, Hacker News), with the screen captured as it is (ffmpeg x11grab on a virtual
// display). Commands go in through Navi's whole listening path, with the recognizer stood in for: the
// words appear in Navi's live caption as they're "said", then the phrase ends, exactly as with a mic.
// Navi's replies are spoken (spoken-feedback mode); each is noted with its time so the composer can lay
// Navi's voice in at that moment. The AI part runs for real, through OpenAI.
//
// Run (after `npm run build` and narrate.py lines), on a virtual display:
//   DEMO_OUT=/path xvfb-run -a -s "-screen 0 1920x1080x24" npx tsx scripts/demo-video/record.ts
import { chromium, type BrowserContext, type Page } from "@playwright/test";
import { spawn, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { installFakeRecognizer } from "../../tests/e2e/fake-speech";
import { CHROMIUM } from "../../tests/e2e/helpers";

const OUT = process.env.DEMO_OUT ?? path.resolve("demo-out");
const DIST = path.resolve("dist");
const W = 1920;
const H = 1080;

type Step = { card?: string; say?: string; cutAfter?: number; clickLink?: string };
type Script = { steps: Step[] };
type Event = { kind: string; t: number; key?: string; text?: string; duration?: number };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** In Navi's offscreen page: Chrome's voices stood in for (the virtual display has no sound), noting what's said and when. */
function noteSpeech() {
  if (!location.href.endsWith("/offscreen.html")) return;
  const said: { text: string; at: number }[] = [];
  (window as unknown as { __said: typeof said }).__said = said;
  const timers = new Map<string, ReturnType<typeof setTimeout>[]>();
  Object.assign(chrome.tts, {
    getVoices: (callback: (v: object[]) => void) => callback([{ voiceName: "Demo voice", lang: "en-US", remote: false }]),
    speak: (text: string, options: chrome.tts.TtsOptions = {}) => {
      said.push({ text, at: Date.now() });
      // As long as Navi's voice takes to say it (about 14 characters a second).
      const ms = Math.max(600, (text.length / 14) * 1000);
      const t = [setTimeout(() => options.onEvent?.({ type: "start" } as chrome.tts.TtsEvent), 20), setTimeout(() => options.onEvent?.({ type: "end" } as chrome.tts.TtsEvent), ms)];
      timers.set(text, t);
    },
    stop: () => {
      for (const t of timers.values()) t.forEach(clearTimeout);
      timers.clear();
    },
    isSpeaking: (callback: (speaking: boolean) => void) => callback(false),
  });
  // An offscreen page has no chrome.tts: Navi speaks there with speechSynthesis.
  let current: { u: SpeechSynthesisUtterance; timer: ReturnType<typeof setTimeout> } | null = null;
  const finish = (how: "end" | "error") => {
    if (!current) return;
    clearTimeout(current.timer);
    const { u } = current;
    current = null;
    (how === "end" ? u.onend : u.onerror)?.call(u, new Event(how) as SpeechSynthesisEvent & SpeechSynthesisErrorEvent);
  };
  speechSynthesis.speak = (u: SpeechSynthesisUtterance) => {
    finish("error");
    said.push({ text: u.text, at: Date.now() });
    current = { u, timer: setTimeout(() => finish("end"), Math.max(600, (u.text.length / 14) * 1000)) };
  };
  speechSynthesis.cancel = () => finish("error");
}

/**
 * A page Playwright doesn't attach to in a visible browser (Navi's offscreen page, its side panel),
 * reached through Chrome's debugging protocol instead.
 */
type Remote = { eval<T>(expression: string): Promise<T>; send(method: string, params?: object): Promise<unknown>; close(): void };
const PORT = 9333;

async function remote(urlEnd: string): Promise<Remote> {
  let target: { url: string; webSocketDebuggerUrl: string } | undefined;
  for (let i = 0; i < 100 && !target; i++) {
    const list = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()) as { url: string; webSocketDebuggerUrl: string }[];
    target = list.find((t) => t.url.endsWith(urlEnd));
    if (!target) await sleep(100);
  }
  if (!target) throw new Error(`${urlEnd} never opened`);
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => ((ws.onopen = resolve), (ws.onerror = reject)));
  let next = 0;
  const waiting = new Map<number, (msg: { result?: unknown; error?: { message: string } }) => void>();
  ws.onmessage = (e) => {
    const msg = JSON.parse(String(e.data)) as { id?: number; result?: unknown; error?: { message: string } };
    if (msg.id !== undefined) waiting.get(msg.id)?.(msg);
  };
  const send = (method: string, params: object = {}) =>
    new Promise<unknown>((resolve, reject) => {
      const id = ++next;
      waiting.set(id, (msg) => (msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result)));
      ws.send(JSON.stringify({ id, method, params }));
    });
  return {
    send,
    async eval<T>(expression: string) {
      const r = (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })) as { result: { value: T }; exceptionDetails?: { text: string } };
      if (r.exceptionDetails) throw new Error(`${expression.slice(0, 60)}: ${JSON.stringify(r.exceptionDetails).slice(0, 300)}`);
      return r.result.value;
    },
    close: () => ws.close(),
  };
}

async function extensionPage(context: BrowserContext, id: string, file: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${id}/${file}`);
  return page;
}

async function main() {
  const script = JSON.parse(await readFile("scripts/demo-video/script.json", "utf8")) as Script;
  const durations = JSON.parse(await readFile(path.join(OUT, "speech/durations.json"), "utf8")) as Record<string, number>;
  await mkdir(OUT, { recursive: true });

  const context = await chromium.launchPersistentContext(await mkdtemp(path.join(tmpdir(), "navi-demo-")), {
    headless: false,
    viewport: null,
    executablePath: CHROMIUM,
    // Without it, Chrome shows a "controlled by automated software" bar.
    ignoreDefaultArgs: ["--enable-automation"],
    args: [
      `--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`, `--window-size=${W},${H}`, "--window-position=0,0",
      "--force-dark-mode", "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream",
      "--autoplay-policy=no-user-gesture-required", "--no-first-run", "--hide-crash-restore-bubble", `--remote-debugging-port=${PORT}`,
      // No "Chrome for Testing is only for automated testing" bar.
      "--test-type", "--disable-infobars",
    ],
  });
  // Wikipedia in its dark theme, like the browser.
  await context.addCookies([{ name: "enwikimwclientpreferences", value: "skin-theme-clientpref-night", domain: ".wikipedia.org", path: "/" }]);
  await context.route("https://huggingface.co/**", (route) => route.abort());
  // Wikipedia's fundraising banner isn't part of the demo.
  await context.addInitScript(() => {
    if (!location.hostname.endsWith("wikipedia.org")) return;
    const style = document.createElement("style");
    style.textContent = "#siteNotice, #centralNotice, .cn-fundraising, .frb, [id^='frb'] { display: none !important; }";
    document.documentElement.append(style);
  });

  let [worker] = context.serviceWorkers();
  worker ??= await context.waitForEvent("serviceworker");
  const id = new URL(worker.url()).host;
  await sleep(1500);

  // Pro with OpenAI (this sandbox's proxy adds the real key), replies spoken, awake until stopped.
  const setup = context.pages().find((p) => p.url().includes("setup.html")) ?? (await extensionPage(context, id, "setup.html"));
  await setup.evaluate(() =>
    chrome.storage.local.set({
      settings: { openaiKey: "sk-proxy", model: "gpt-6.1-sol", aiMode: "pro", feedback: "minimal", stayAwake: true, speechOutput: "chrome", memory: false },
    }),
  );
  // The page Chrome opens with, then Navi's side panel: opened by a real click, which Chrome requires.
  const site = await context.newPage();
  await site.goto("https://en.wikipedia.org/wiki/Main_Page");
  await setup.evaluate(() => {
    const b = document.createElement("button");
    b.id = "demo-open-panel";
    b.textContent = "Open Navi";
    b.style.cssText = "position:fixed;top:8px;left:8px;z-index:99999";
    b.onclick = async () => {
      const win = await chrome.windows.getCurrent();
      await chrome.sidePanel.open({ windowId: win.id! });
    };
    document.body.append(b);
  });
  await setup.bringToFront();
  await setup.click("#demo-open-panel");
  // Navi on (its offscreen page, where the stand-in recognizer is, opens), then only the site's tab is left.
  await setup.evaluate(() => chrome.runtime.sendMessage({ type: "navi:listen", on: true }));
  // The recognizer stood in for, and Navi's voice noted, in its offscreen page (reloaded with them in;
  // Navi restarts listening in a reloaded one by itself).
  const ears = await remote("/offscreen.html");
  await ears.send("Page.enable");
  // (`__name`: what the TypeScript runner adds inside functions, needed when their source runs elsewhere.)
  await ears.send("Page.addScriptToEvaluateOnNewDocument", { source: `var __name = (f) => f; (${installFakeRecognizer.toString()})("available"); (${noteSpeech.toString()})();` });
  await ears.eval("location.reload()").catch(() => undefined);
  await sleep(2500);
  for (let i = 0; i < 50 && !(await ears.eval<boolean>("typeof window.__hear === 'function' && !!window.__recognition?.live").catch(() => false)); i++) await sleep(200);
  // The panel too, so it knows on-device speech is there (no "download it" card).
  const panel = await remote("/sidepanel.html");
  await panel.send("Page.enable");
  await panel.send("Page.addScriptToEvaluateOnNewDocument", { source: `var __name = (f) => f; (${installFakeRecognizer.toString()})("available");` });
  await panel.eval("location.reload()").catch(() => undefined);
  await sleep(2500);
  // Awake from the start (a reloaded listening page starts asleep).
  await ears.eval(`window.__hear("wake up", true)`);
  await sleep(1500);
  await site.bringToFront();
  for (const p of context.pages()) if (p !== site && !p.url().endsWith("/offscreen.html")) await p.close();
  await sleep(2500);

  // The screen, from here on.
  const video = path.join(OUT, "screen.mp4");
  const ffmpeg = spawn("ffmpeg", ["-loglevel", "error", "-y", "-f", "x11grab", "-framerate", "30", "-video_size", `${W}x${H}`, "-i", process.env.DISPLAY ?? ":99", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "18", "-pix_fmt", "yuv420p", video]);
  const t0 = Date.now() + 300;
  await sleep(1200);
  const events: Event[] = [];
  const at = () => (Date.now() - t0) / 1000;


  /** Says a command: its words show up as they're spoken, over as long as the user's voice takes, then the phrase ends. */
  async function say(text: string, seconds: number) {
    const words = text.split(" ");
    const each = (seconds * 1000) / (words.length + 1);
    for (let i = 1; i <= words.length; i++) {
      await sleep(each);
      await ears.eval(`window.__hear(${JSON.stringify(words.slice(0, i).join(" "))}, false)`);
    }
    await sleep(each);
    await ears.eval(`window.__hear(${JSON.stringify(text)}, true)`);
  }

  /** Navi's replies so far, as its panel shows them (what it says aloud in spoken-feedback mode), noted with their time. */
  const replies: { text: string; t: number }[] = [];
  const panelReplies = () => panel.eval<string[]>(`[...document.querySelectorAll("#log li.navi .text")].map((e) => e.textContent)`);
  async function noteReplies() {
    const all = await panelReplies();
    // Footnote marks ("[ 57 ]") aren't read out.
    for (const text of all.slice(replies.length)) replies.push({ text: (text ?? "").replace(/\[\s*\d+\s*\]/g, "").replace(/\s+/g, " ").trim(), t: at() });
    return all.length;
  }

  /** Waits until Navi has answered (the AI may take several steps) and had time to say it, at most `maxMs`. */
  async function settle(before: number, maxMs = 30_000) {
    const started = Date.now();
    while (Date.now() - started < maxMs) {
      const n = await noteReplies();
      const working = await panel.eval<boolean>(`document.getElementById("voice")?.dataset.state === "working"`).catch(() => false);
      if (n > before && !working) {
        await noteReplies();
        return;
      }
      await sleep(150);
    }
  }

  // What Navi says aloud and the sounds it plays, as its listening page reports them (with the panel open,
  // actions get a short chime and only answers are spoken, as in everyday use).
  const askEars = (action: string) =>
    panel.eval<unknown>(`chrome.runtime.sendMessage({ type: "navi:test", action: "ears", ears: { type: "ears:test", action: ${JSON.stringify(action)} } })`);
  let lastSaid = String((await askEars("lastSaid")) ?? "");
  let sounds = ((await askEars("sounds")) as string[]) ?? [];
  async function noteVoice() {
    const said = String((await askEars("lastSaid").catch(() => lastSaid)) ?? "");
    if (said && said !== lastSaid) events.push({ kind: "navi", text: said.replace(/\[\s*\d+\s*\]/g, "").replace(/\s+/g, " ").trim(), t: at() });
    lastSaid = said;
    const now = ((await askEars("sounds").catch(() => sounds)) as string[]) ?? sounds;
    // The list keeps the last 30: what's new is what follows the longest overlap with the last look.
    let overlap = Math.min(sounds.length, now.length);
    while (overlap > 0 && JSON.stringify(sounds.slice(-overlap)) !== JSON.stringify(now.slice(0, overlap))) overlap--;
    for (const name of now.slice(overlap)) events.push({ kind: "sound", text: name, t: at() });
    sounds = now;
  }
  const watch = async (ms: number) => {
    const until = Date.now() + ms;
    while (Date.now() < until) {
      await noteReplies();
      await noteVoice();
      await sleep(120);
    }
  };

  for (const [i, step] of script.steps.entries()) {
    if (step.card) {
      events.push({ kind: "card", text: step.card, t: at() });
      await watch(2600);
    }
    if (step.say) {
      const key = `s${i}`;
      let text = step.say;
      if (step.clickLink) {
        // The number Navi's flag shows on that link, as the user would read it off the screen.
        const n = await site.evaluate((name) => {
          const link = [...document.querySelectorAll("a")].find((a) => a.textContent?.trim().toLowerCase() === name && a.getBoundingClientRect().top > 0 && a.getBoundingClientRect().bottom < innerHeight);
          const host = document.querySelector("navi-overlay");
          if (!link || !host?.shadowRoot) return null;
          const r = link.getBoundingClientRect();
          const badges = [...host.shadowRoot.querySelectorAll<HTMLElement>(".badge")];
          const near = badges.find((b) => Math.abs(parseFloat(b.style.left) - Math.max(r.left, 2)) < 3 && Math.abs(parseFloat(b.style.top) - Math.max(r.top, 2)) < 3);
          return near?.textContent ?? null;
        }, step.clickLink);
        if (!n) throw new Error(`No flag on the "${step.clickLink}" link`);
        text = step.say.replace("{n}", n);
        const made = spawnSync("python3", ["scripts/demo-video/narrate.py", "say", "scripts/demo-video/script.json", "-", path.join(OUT, "speech"), key, text], { encoding: "utf8" });
        if (made.status !== 0) throw new Error(made.stderr);
        durations[key] = Number(made.stdout.trim().split("\n").at(-1));
      }
      const before = await noteReplies();
      events.push({ kind: "say", key, text, t: at(), duration: durations[key] } as Event);
      await say(text, durations[key]);
      if (step.cutAfter) await watch(step.cutAfter * 1000);
      // "Stop" just stops: nothing to wait for.
      else if (step.say === "stop") await watch(900);
      else {
        const said = events.length;
        await settle(before);
        await watch(500);
        // Navi said something: room to say it (about 14 characters a second), up to a few seconds; a long
        // answer is cut short by the next command, as talking over Navi does.
        const spoken = events.slice(said).find((e) => e.kind === "navi");
        if (spoken) await watch(Math.min(5500, ((spoken.text ?? "").length / 14) * 1000));
      }
      await watch(400);
    }
  }
  await sleep(1500);
  events.push({ kind: "end", t: at() });

  // When each reply showed (for cutting the AI's thinking time), apart from what was said aloud.
  await noteReplies();
  await noteVoice();
  ears.close();
  panel.close();
  for (const r of replies) events.push({ kind: "reply", text: r.text, t: r.t });
  events.sort((a, b) => a.t - b.t);

  ffmpeg.stdin.write("q");
  await new Promise((resolve) => ffmpeg.on("close", resolve));
  await context.close();
  await writeFile(path.join(OUT, "events.json"), JSON.stringify({ screen: video, events }, null, 1));
  console.log(`recorded ${events.find((e) => e.kind === "end")!.t.toFixed(1)} s, ${replies.length} replies`);
}

void main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
