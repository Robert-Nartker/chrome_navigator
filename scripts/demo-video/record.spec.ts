// Records Navi doing the demo: the real extension in Chromium, on three demo pages, driven by the script
// (script.json). The commands go in through Navi's voice path with the recognizer stood in for (the voice
// itself is added afterwards from Kokoro); the AI step is replayed from a scripted reply, since recording
// runs without an API key. Everything else, from parsing to clicking, is Navi as it ships.
//
// Run (after `npm run build` and narrate.py lines): DEMO_OUT=/path npx playwright test -c scripts/demo-video
import { chromium, expect, test, type Page } from "@playwright/test";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { installFakeRecognizer } from "../../tests/e2e/fake-speech";
import { CHROMIUM, openedPage } from "../../tests/e2e/helpers";

const OUT = process.env.DEMO_OUT ?? path.resolve("demo-out");
const PAGES = path.resolve("scripts/demo-video/pages");
const DIST = path.resolve("dist");
const SITE = { width: 1280, height: 1080 };
const PANEL = { width: 640, height: 1080 };

type Step = { narrator?: string; power?: boolean; say?: string; ai?: boolean };
type Script = { scenes: { page: string; steps: Step[] }[] };

test("record the demo", async () => {
  const script = JSON.parse(await readFile("scripts/demo-video/script.json", "utf8")) as Script;
  const durations = JSON.parse(await readFile(path.join(OUT, "speech/durations.json"), "utf8")) as Record<string, number>;
  await mkdir(path.join(OUT, "video"), { recursive: true });

  // The demo pages, and the stand-in video file next to them.
  const server = createServer(async (req, res) => {
    const name = path.basename(new URL(req.url ?? "/", "http://x").pathname) || "video.html";
    try {
      const file = name === "lofi.mp4" ? path.join(OUT, "lofi.mp4") : path.join(PAGES, name);
      const body = await readFile(file);
      res.writeHead(200, { "content-type": name.endsWith(".mp4") ? "video/mp4" : "text/html; charset=utf-8" }).end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://localhost:${(server.address() as { port: number }).port}`;

  const context = await chromium.launchPersistentContext(await mkdtemp(path.join(tmpdir(), "navi-demo-")), {
    executablePath: CHROMIUM,
    headless: true,
    viewport: SITE,
    recordVideo: { dir: path.join(OUT, "video"), size: SITE },
    args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`, "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"],
  });
  await context.addInitScript(installFakeRecognizer, "available");
  await context.route("https://huggingface.co/**", (route) => route.abort());

  // The AI's part, replayed: it picks the best desk under $400 from the page Navi shows it, and adds it.
  await context.route("https://api.openai.com/v1/responses", async (route) => {
    const body = route.request().postDataJSON() as { input: string | { type?: string; content?: unknown }[] };
    // Navi's other quick calls (naming a thread, its memory): a plain short answer.
    if (!Array.isArray(body.input)) {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ id: "resp", status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "{}" }] }], usage: { input_tokens: 100, output_tokens: 5 } }) });
    }
    const done = body.input.some((x) => x.type === "function_call_output");
    await new Promise((resolve) => setTimeout(resolve, 1400));
    const output = done
      ? [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "The FlexDesk Pro is the best one under $400: $379, rated 4.8. I added it to your cart." }] }]
      : [{
          type: "function_call", id: "fc_1", call_id: "call_1", name: "click",
          arguments: JSON.stringify({ element_id: Number(JSON.stringify(body.input).match(/\[(\d+)\] button \\"Add FlexDesk Pro to cart\\"/)?.[1]) }),
        }];
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ id: "resp", status: "completed", output, usage: { input_tokens: 2000, output_tokens: 40 } }) });
  });

  let [worker] = context.serviceWorkers();
  worker ??= await context.waitForEvent("serviceworker");
  const id = new URL(worker.url()).host;
  for (const p of context.pages()) if (p.url().includes("setup.html")) await p.close();

  // A fresh page (the window's first one doesn't always take the viewport), then the blank one goes.
  const blank = context.pages();
  const t0 = Date.now();
  const site = await context.newPage();
  const siteStarted = Date.now();
  for (const p of blank) await p.close();
  await site.goto(`${base}/${script.scenes[0].page}`);
  // The panel in its own window beside the page (tabs share their window's size, so one tab can't be narrower).
  const opened = openedPage(context, (url) => url.includes("sidepanel.html"));
  await worker.evaluate((size) => chrome.windows.create({ url: chrome.runtime.getURL("sidepanel.html"), type: "normal", ...size }), PANEL);
  const panel = await opened;
  await panel.waitForFunction(() => "navi" in window);
  const panelStarted = Date.now();
  await panel.setViewportSize(PANEL);
  await panel.evaluate(() =>
    chrome.storage.local.set({ settings: { openaiKey: "sk-demo", model: "gpt-6.1-sol", routerModel: "off", aiMode: "pro", speechOutput: "chrome", stayAwake: true } }),
  );
  await site.bringToFront();
  await site.waitForTimeout(1500);

  const events: { kind: string; t: number; key?: string; text?: string }[] = [];
  const at = () => (Date.now() - t0) / 1000;
  const navi = panel.locator("#log li.navi .text");

  for (const [si, scene] of script.scenes.entries()) {
    if (si > 0) {
      await site.goto(`${base}/${scene.page}`);
      await site.waitForTimeout(1200);
    }
    for (const [ti, step] of scene.steps.entries()) {
      if (step.narrator) {
        const key = `s${si}-${ti}-narrator`;
        events.push({ kind: "narrator", key, t: at() });
        await site.waitForTimeout(durations[key] * 1000 + 400);
      }
      if (step.power) {
        await panel.locator("#mic").click();
        events.push({ kind: "power", t: at() });
        await expect(panel.locator("#voice")).toHaveAttribute("data-state", "awake");
        await site.waitForTimeout(900);
      }
      if (step.say) {
        const key = `s${si}-${ti}-say`;
        events.push({ kind: "say", key, text: step.say, t: at() });
        // Said aloud first (the user's voice is laid in at this moment), then Navi acts.
        await site.waitForTimeout(durations[key] * 1000 + 250);
        const before = await navi.count();
        await site.bringToFront();
        await panel.evaluate((text) => (window as unknown as { navi: { run(t: string, s: string): Promise<void> } }).navi.run(text, "voice"), step.say);
        const replies = (await navi.allTextContents()).slice(before);
        const reply = replies.at(-1);
        if (reply) {
          events.push({ kind: "navi", text: reply, t: at() });
          // Room for Navi to say it (about 15 characters a second).
          await site.waitForTimeout(Math.min(14_000, (reply.length / 15) * 1000 + 700));
        } else await site.waitForTimeout(900);
      }
    }
  }
  await site.waitForTimeout(1500);
  events.push({ kind: "end", t: at() });

  const sitePath = await site.video()!.path();
  const panelPath = await panel.video()!.path();
  await context.close();
  server.close();
  await writeFile(
    path.join(OUT, "events.json"),
    JSON.stringify({ site: sitePath, panel: panelPath, siteStart: (siteStarted - t0) / 1000, panelStart: (panelStarted - t0) / 1000, events }, null, 1),
  );
});
