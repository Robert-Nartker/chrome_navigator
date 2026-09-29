// Voice lab (tts-lab.html). Kokoro's real model is a 92-326 MB download from Hugging Face, so these tests
// either make that download fail or serve a tiny stand-in model (tests/fixtures/tts/) that outputs a
// tone. Everything else is real: the vendored ONNX Runtime, the phonemizer, Kokoro's worker, caching and
// playback, all under the extension's content security policy.

import { type BrowserContext, type Page, chromium, expect, test as base } from "@playwright/test";
import { existsSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { KOKORO, KOKORO_STAND_INS } from "./fake-models";

const DIST = path.resolve("dist");
const SANDBOX_CHROMIUM = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const CHROMIUM = process.env.NAVI_CHROMIUM ?? (existsSync(SANDBOX_CHROMIUM) ? SANDBOX_CHROMIUM : undefined);

type Fixtures = {
  context: BrowserContext;
  extensionId: string;
  /** CSP errors, page errors and CDN requests seen during the test; should stay empty. */
  problems: string[];
  lab: Page;
};

const test = base.extend<Fixtures>({
  context: async ({}, use) => {
    const userDataDir = await mkdtemp(path.join(tmpdir(), "navi-lab-"));
    const context = await chromium.launchPersistentContext(userDataDir, {
      executablePath: CHROMIUM,
      headless: true,
      args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`],
    });
    await use(context);
    await context.close();
  },
  extensionId: async ({ context }, use) => {
    let [worker] = context.serviceWorkers();
    worker ??= await context.waitForEvent("serviceworker");
    await use(new URL(worker.url()).host);
  },
  problems: async ({ context }, use) => {
    const problems: string[] = [];
    // Chrome doesn't always log a blocked eval, so report every violation of the extension's CSP.
    await context.addInitScript(() =>
      document.addEventListener("securitypolicyviolation", (e) =>
        console.error(`Content Security Policy violation: ${e.violatedDirective} ${e.blockedURI}`),
      ),
    );
    // Extensions can't run code from a CDN, so nothing may even try.
    await context.route(/^https:\/\/(cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com|unpkg\.com)\//, (route) => {
      problems.push(`CDN request: ${route.request().url()}`);
      return route.abort();
    });
    await use(problems);
  },
  lab: async ({ context, extensionId, problems }, use) => {
    const page = await watchedPage(context, problems);
    await page.goto(`chrome-extension://${extensionId}/tts-lab.html`);
    await expect(page.locator("#phrases input")).toHaveCount(9);
    await use(page);
  },
});

/** A new page whose CSP errors and uncaught errors are recorded in `problems`. */
async function watchedPage(context: BrowserContext, problems: string[]): Promise<Page> {
  const page = await context.newPage();
  page.on("console", (msg) => {
    if (/Content Security Policy|Refused to/i.test(msg.text())) problems.push(msg.text());
  });
  page.on("pageerror", (err) => problems.push(`Page error: ${err.message}`));
  return page;
}

const HF = "https://huggingface.co/";
/** Stand-ins for the files Kokoro downloads from Hugging Face. */
const STAND_INS = KOKORO_STAND_INS;

/** Serves the stand-ins (404 for anything else) and returns the URLs requested. */
async function serveStandIns(context: BrowserContext): Promise<string[]> {
  const requested: string[] = [];
  await context.unroute(`${HF}**`);
  await context.route(`${HF}**`, async (route) => {
    const url = route.request().url();
    requested.push(url);
    const file = STAND_INS[url];
    if (!file) return route.fulfill({ status: 404, body: "Entry not found" });
    return route.fulfill({ status: 200, body: await file() });
  });
  return requested;
}

/** Makes every Hugging Face request fail, and returns the URLs requested. */
async function blockHuggingFace(context: BrowserContext, how: "abort" | "404" = "abort"): Promise<string[]> {
  const requested: string[] = [];
  await context.unroute(`${HF}**`);
  await context.route(`${HF}**`, (route) => {
    requested.push(route.request().url());
    return how === "abort" ? route.abort() : route.fulfill({ status: 404, body: "Entry not found" });
  });
  return requested;
}

const engine = (lab: Page, id: string) => lab.locator(`fieldset.engine[data-engine=${id}]`);
const loadButton = (lab: Page, id: string) => engine(lab, id).getByRole("button", { name: "Download and load" });
const resultRow = (lab: Page, name: string) =>
  lab.locator("#results tbody tr").filter({ has: lab.getByRole("rowheader", { name, exact: true }) });

/** Ticks exactly these voices for comparison. */
async function compareOnly(lab: Page, names: string[]) {
  for (const box of await lab.locator(".engine .voices input[type=checkbox]").all()) {
    const label = (await box.getAttribute("aria-label")) ?? "";
    await box.setChecked(names.includes(label.replace(/^Compare /, "")));
  }
}

test("loads under the extension's security policy, lists every engine, and loads nothing heavy up front", async ({
  context,
  extensionId,
  problems,
}) => {
  const requested: string[] = [];
  context.on("request", (r) => requested.push(r.url()));
  const lab = await watchedPage(context, problems);
  await lab.goto(`chrome-extension://${extensionId}/tts-lab.html`);

  await expect(engine(lab, "system").locator("legend")).toContainText("Chrome and this computer");
  await expect(engine(lab, "system")).toContainText("Premium");
  await expect(engine(lab, "kokoro").locator(".voices li")).toHaveCount(12);
  // Only Kokoro and the computer's own voices: the other engines were retired.
  await expect(lab.locator("fieldset.engine")).toHaveCount(2);
  await expect(lab.locator("#volume-note")).toContainText("60%");
  // Headless Chromium can't use WebGPU, so Kokoro falls back to WebAssembly.
  await expect(lab.locator("#kokoro-device")).toHaveValue("wasm");

  // The engines' code and runtimes load only when used.
  await lab.waitForTimeout(500);
  expect(requested.filter((url) => /\/vendor\/|kokoro|ort\./.test(url))).toEqual([]);
  expect(problems).toEqual([]);

  // Settings links here.
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await expect(options.getByRole("link", { name: "Compare voices" })).toHaveAttribute("href", "tts-lab.html");
});

test("Kokoro shows a clear error when its model download fails, and can retry", async ({ lab, context, problems }) => {
  const blocked = await blockHuggingFace(context);
  await loadButton(lab, "kokoro").click();
  await expect(engine(lab, "kokoro").locator(".status")).toContainText("Couldn't load Kokoro", { timeout: 20_000 });
  await expect(engine(lab, "kokoro").locator(".status")).toContainText("check your internet connection");
  expect(blocked.some((url) => url.startsWith(KOKORO))).toBe(true);

  await serveStandIns(context);
  await loadButton(lab, "kokoro").click();
  await expect(engine(lab, "kokoro").locator(".status")).toContainText("Kokoro loaded", { timeout: 30_000 });
  expect(problems).toEqual([]);
});

test("runs Kokoro on its vendored runtime, then loads it again offline", async ({
  lab,
  context,
  problems,
}) => {
  test.setTimeout(120_000);
  const requested = await serveStandIns(context);
  await compareOnly(lab, ["Heart (Kokoro)", "Bella (Kokoro)"]);
  await lab.getByRole("button", { name: "Play this phrase in all selected voices" }).click();
  await expect(lab.locator("#status")).toHaveText("Played 2 voices.", { timeout: 60_000 });

  // Real synthesis (the stand-in model returns a 0.3 s tone).
  for (const name of ["Heart (Kokoro)"]) {
    // Engine, first load, download, time to first audio, synthesis, real-time factor, rating.
    const cells = await resultRow(lab, name).locator("td").allTextContents();
    expect(cells[1]).toMatch(/\d+ (ms|s)/);
    expect(cells[2]).toMatch(/KB/);
    expect(cells[3]).toMatch(/\d+ (ms|s)/);
    expect(cells[4]).toMatch(/\d+ (ms|s)/);
    expect(cells[5]).toMatch(/\d\.\d\d×/);
  }
  await expect(resultRow(lab, "Heart (Kokoro)").locator("td").first()).toHaveText("Kokoro (WebAssembly)");
  // Kokoro's voice file is data it fetches on first use.
  expect(requested).toContain(`${KOKORO}voices/af_heart.bin`);

  // Next visit, offline: everything comes from the browser's storage.
  const offline = await blockHuggingFace(context);
  await lab.reload();
  await loadButton(lab, "kokoro").click();
  await expect(engine(lab, "kokoro").locator(".status")).toContainText("already downloaded", { timeout: 30_000 });
  await lab.getByRole("button", { name: "Play Heart (Kokoro)" }).click();
  await expect(resultRow(lab, "Heart (Kokoro)")).toBeVisible({ timeout: 30_000 });
  expect(offline).toEqual([]);
  await expect(lab.locator("#storage")).toContainText("Downloaded voice models use about");
  expect(problems).toEqual([]);
});

test("Chrome's voices: English by default, marked local or online, timed when played", async ({
  context,
  extensionId,
  problems,
}) => {
  // Headless Chromium has no speech voices, so stand in for chrome.tts.
  await context.addInitScript(() => {
    if (!location.href.endsWith("tts-lab.html")) return;
    const voices = [
      { voiceName: "Samantha (Enhanced)", lang: "en-US", remote: false },
      { voiceName: "Google US English", lang: "en-US", remote: true },
      { voiceName: "Amélie", lang: "fr-CA", remote: false },
    ];
    Object.assign(chrome.tts, {
      getVoices: (callback: (v: typeof voices) => void) => callback(voices),
      speak: (_text: string, options: chrome.tts.TtsOptions) => {
        setTimeout(() => options.onEvent?.({ type: "start" }), 30);
        setTimeout(() => options.onEvent?.({ type: "end" }), 200);
      },
      stop: () => {},
    });
  });
  const lab = await watchedPage(context, problems);
  await lab.goto(`chrome-extension://${extensionId}/tts-lab.html`);
  const list = engine(lab, "system").locator(".voices li");
  await expect(list).toHaveCount(2);
  await expect(list.filter({ hasText: "Samantha (Enhanced)" })).toContainText("on this computer");
  await expect(list.filter({ hasText: "Google US English" })).toContainText("online");
  await lab.getByLabel("Show all languages").check();
  await expect(list).toHaveCount(3);

  await lab.getByRole("button", { name: "Play Samantha (Enhanced) (Chrome)" }).click();
  const cells = resultRow(lab, "Samantha (Enhanced) (Chrome)").locator("td");
  await expect(cells.nth(2)).toHaveText("none (built in)");
  await expect(cells.nth(3)).toHaveText(/\d+ ms/);
  expect(problems).toEqual([]);
});

test("ratings are saved, blind mode hides names and shuffles, and favorites are listed", async ({ lab, context, extensionId }) => {
  await compareOnly(lab, ["Heart (Kokoro)", "Bella (Kokoro)", "Nicole (Kokoro)"]);
  await lab.getByLabel("Rating for Heart (Kokoro)").selectOption("5");
  await lab.getByLabel("Rating for Nicole (Kokoro)").selectOption("3");
  await expect(lab.locator("#top li")).toHaveText(["Heart (Kokoro): 5/5", "Nicole (Kokoro): 3/5"]);
  const stored = await lab.evaluate(() => chrome.storage.local.get("ttsLabRatings"));
  expect(stored.ttsLabRatings).toEqual({
    "kokoro:af_heart": { rating: 5, label: "Heart (Kokoro)" },
    "kokoro:af_nicole": { rating: 3, label: "Nicole (Kokoro)" },
  });

  // Blind mode: letters instead of names, and the named lists are hidden.
  await lab.getByLabel("Blind mode: hide the names and shuffle the order of the selected voices").check();
  const blind = lab.locator("#blind-list li");
  await expect(blind.locator(".pick")).toHaveText(["Voice A", "Voice B", "Voice C"]);
  await expect(lab.locator("#voices")).toBeHidden();
  await expect(lab.locator("#top")).not.toContainText("Heart");
  // Loading (here, failing to) is reported under the letter, not the engine's name.
  await blockHuggingFace(context);
  await blind.nth(1).getByRole("button", { name: "Play Voice B" }).click();
  await expect(lab.locator("#status")).toContainText("Couldn't load Voice B", { timeout: 20_000 });
  await expect(lab.locator("#status")).not.toContainText(/Kokoro|Heart|Bella|Nicole/);
  await expect(lab.locator("#top li").first()).toHaveText(/^Voice [ABC]: 5\/5$/);
  // Rating a letter saves it under the real voice.
  await blind.nth(0).getByRole("combobox").selectOption("4");
  await lab.getByRole("button", { name: "Reveal names" }).click();
  await expect(blind.locator(".pick")).toHaveText([/^Voice A: /, /^Voice B: /, /^Voice C: /]);
  const first = (await blind.nth(0).locator(".pick").textContent())!.replace(/^Voice A: /, "");
  await expect(lab.locator("#top")).toContainText(`${first}: 4/5`);

  // Ratings survive a reload.
  await lab.goto(`chrome-extension://${extensionId}/tts-lab.html`);
  await expect(lab.getByLabel("Rating for Nicole (Kokoro)")).toHaveValue(first === "Nicole (Kokoro)" ? "4" : "3");
});
