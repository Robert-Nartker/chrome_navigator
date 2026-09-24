// Dev tool: loads the built extension, opens real sites, and reports how well the
// page snapshot captures them (element counts, unnamed elements, snapshot size, time).
// Usage: node scripts/probe-sites.mjs [url ...]   (screenshots go to probe-output/)
import { chromium } from "@playwright/test";
import { mkdir, mkdtemp } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const urls = process.argv.slice(2).length
  ? process.argv.slice(2)
  : [
      "https://en.wikipedia.org/wiki/Ohio_State_University",
      "https://github.com/microsoft/playwright",
      "https://news.ycombinator.com",
      "https://www.youtube.com",
      "https://www.reddit.com/r/programming/",
      "https://www.amazon.com/s?k=airpods",
      "https://www.google.com/search?q=pizza+near+me",
    ];
const outDir = "probe-output";
const SANDBOX_CHROMIUM = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
await mkdir(outDir, { recursive: true });

const context = await chromium.launchPersistentContext(await mkdtemp(path.join(tmpdir(), "navi-probe-")), {
  // Uses Playwright's Chromium unless NAVI_CHROMIUM points at another build.
  executablePath: process.env.NAVI_CHROMIUM ?? (existsSync(SANDBOX_CHROMIUM) ? SANDBOX_CHROMIUM : undefined),
  headless: true,
  viewport: { width: 1280, height: 800 },
  proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined,
  args: [`--disable-extensions-except=${path.resolve("dist")}`, `--load-extension=${path.resolve("dist")}`],
});
let [worker] = context.serviceWorkers();
worker ??= await context.waitForEvent("serviceworker");
const extId = new URL(worker.url()).host;
const ext = await context.newPage();
await ext.goto(`chrome-extension://${extId}/options.html`);

for (const url of urls) {
  const page = await context.newPage();
  const row = { url };
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(2500);
    const result = await ext.evaluate(async (target) => {
      const [tab] = (await chrome.tabs.query({})).filter((t) => t.url?.startsWith(target.slice(0, 20)));
      const t0 = performance.now();
      const res = await chrome.tabs.sendMessage(tab.id, { kind: "showBadges" });
      return { ms: Math.round(performance.now() - t0), snap: res.snapshot, error: res.error };
    }, page.url());
    if (!result.snap) throw new Error(result.error ?? "no snapshot");
    const els = result.snap.elements;
    const lines = els.map((e) => `[${e.id}] ${e.role} "${e.name}"`).join("\n");
    Object.assign(row, {
      title: result.snap.title.slice(0, 50),
      snapshotMs: result.ms,
      inView: els.filter((e) => e.inViewport).length,
      below: els.filter((e) => !e.inViewport).length,
      unnamed: els.filter((e) => !e.name).length,
      approxTokens: Math.round(lines.length / 4),
      sample: els.slice(0, 12).map((e) => `${e.id}:${e.role}:${e.name}`).join(" | "),
    });
    const host = new URL(page.url()).hostname.replace(/^www\./, "");
    await page.screenshot({ path: `${outDir}/${host}.png` });
  } catch (err) {
    row.error = String(err).slice(0, 200);
  }
  console.log(JSON.stringify(row));
  await page.close();
}
await context.close();
