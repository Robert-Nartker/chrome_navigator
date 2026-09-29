// Voice lab (tts-lab.html). Kokoro's real model is a 92-326 MB download from Hugging Face, so these tests
// either make that download fail or serve a tiny stand-in model (tests/fixtures/tts/) that outputs a
// tone. Everything else is real: the vendored ONNX Runtime, the phonemizer, Kokoro's worker, caching and
// playback, all under the extension's content security policy.

import { type BrowserContext, type Page, chromium, expect, test as base } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { KOKORO, KOKORO_STAND_INS } from "./fake-models";

const DIST = path.resolve("dist");
const SANDBOX_CHROMIUM = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const CHROMIUM = process.env.NAVI_CHROMIUM ?? (existsSync(SANDBOX_CHROMIUM) ? SANDBOX_CHROMIUM : undefined);

type Fixtures = {
  /** A WAV file the fake microphone plays once (instead of its default beeps). */
  micFile: string | undefined;
  context: BrowserContext;
  extensionId: string;
  /** CSP errors, page errors and CDN requests seen during the test; should stay empty. */
  problems: string[];
  lab: Page;
};

const test = base.extend<Fixtures>({
  micFile: [undefined, { option: true }],
  context: async ({ micFile }, use) => {
    const userDataDir = await mkdtemp(path.join(tmpdir(), "navi-lab-"));
    const context = await chromium.launchPersistentContext(userDataDir, {
      executablePath: CHROMIUM,
      headless: true,
      // A fake microphone, allowed without a prompt, for the speech recognizer tester.
      args: [
        `--disable-extensions-except=${DIST}`,
        `--load-extension=${DIST}`,
        "--use-fake-device-for-media-stream",
        "--use-fake-ui-for-media-stream",
        ...(micFile ? [`--use-file-for-fake-audio-capture=${micFile}%noloop`] : []),
      ],
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

test("speech recognizer tester: loads cleanly, listens, and explains a failed model download", async ({
  context,
  extensionId,
  problems,
}) => {
  const blocked = await blockHuggingFace(context);
  const page = await watchedPage(context, problems);
  await page.goto(`chrome-extension://${extensionId}/asr-lab.html`);
  await expect(page.locator("button.model")).toHaveCount(6);
  // Qwen's engine needs threads that share memory, which only a cross-origin isolated page gets.
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(true);
  // Headless Chromium has no graphics chip for WebGPU.
  await expect(page.locator("#hardware")).toContainText("run on the processor");
  await page.getByRole("button", { name: "Start listening" }).click();
  await expect(page.locator("#mic")).toHaveText("Stop listening");

  const model = (name: string) => page.locator("button.model").filter({ hasText: name });
  for (const name of ["Whisper large-v3 turbo", "Parakeet v3"]) {
    await model(name).click();
    await expect(model(name)).toHaveAttribute("aria-pressed", "true");
    await expect(model(name).locator(".status")).toContainText("Couldn't load", { timeout: 30_000 });
  }
  // Qwen3-ASR runs only on a graphics chip, and says so.
  await model("Qwen3-ASR 1.7B").click();
  await expect(model("Qwen3-ASR 1.7B").locator(".status")).toContainText("needs a graphics chip");
  // Each model's worker and runtime loaded, and went to Hugging Face for its files.
  expect(blocked.some((url) => url.includes("whisper-large-v3-turbo"))).toBe(true);
  expect(blocked.some((url) => /parakeet/i.test(url))).toBe(true);
  expect(problems).toEqual([]);
});

test("Qwen3-ASR: downloads (packing the 0.6B's full-precision weights) into browser storage, and its engine starts", async ({
  context,
  extensionId,
  problems,
}) => {
  // Tiny synthetic checkpoints, and what the engine's own C packer makes of them (tests/fixtures/qwen-pack).
  const fixture = (file: string) => readFileSync(path.resolve("tests/fixtures/qwen-pack", file));
  const files: Record<string, Buffer> = {
    "single/model.safetensors": fixture("single/model.safetensors"),
    "sharded/model-00001-of-00002.safetensors": fixture("sharded/model-00001-of-00002.safetensors"),
    "sharded/model-00002-of-00002.safetensors": fixture("sharded/model-00002-of-00002.safetensors"),
    "sharded/model.safetensors.index.json": Buffer.from(
      JSON.stringify({ weight_map: { a: "model-00002-of-00002.safetensors", b: "model-00001-of-00002.safetensors" } }),
    ),
    "packed/qwen-asr-q8.bin": fixture("single/expected.bin"),
  };
  await context.route(`${HF}test/**`, (route) => {
    const [, repo, file] = new URL(route.request().url()).pathname.match(/^\/test\/(\w+)\/resolve\/main\/(.+)$/)!;
    const body = /^(vocab\.json|merges\.txt)$/.test(file) ? Buffer.from(`${repo} ${file}`) : files[`${repo}/${file}`];
    return body ? route.fulfill({ body, headers: { "access-control-allow-origin": "*" } }) : route.fulfill({ status: 404 });
  });
  const page = await watchedPage(context, problems);
  await page.goto(`chrome-extension://${extensionId}/asr-lab.html`);

  const prepare = (req: { dir: string; base: string; packed?: string }) =>
    page.evaluate(
      (req) =>
        new Promise<string>((resolve) => {
          const worker = new Worker("lab/qwen-files.js", { type: "module" });
          worker.onmessage = ({ data }) => data.type !== "progress" && resolve(data.type === "done" ? "done" : data.message);
          worker.postMessage(req);
        }),
      req,
    );
  const stored = (dir: string, name: string) =>
    page.evaluate(
      async ([dir, name]) => {
        const root = await navigator.storage.getDirectory();
        const folder = await (await root.getDirectoryHandle("qwen-asr")).getDirectoryHandle(dir);
        return [...new Uint8Array(await (await (await folder.getFileHandle(name)).getFile()).arrayBuffer())];
      },
      [dir, name],
    );
  const expected = (file: string) => [...fixture(file)];

  for (const repo of ["single", "sharded"]) {
    expect(await prepare({ dir: repo, base: `${HF}test/${repo}/resolve/main` })).toBe("done");
    expect(await stored(repo, "model.bin")).toEqual(expected(`${repo}/expected.bin`));
    expect(Buffer.from(await stored(repo, "vocab.json")).toString()).toBe(`${repo} vocab.json`);
  }
  expect(await prepare({ dir: "packed", base: `${HF}test/packed/resolve/main`, packed: "qwen-asr-q8.bin" })).toBe("done");
  expect(await stored("packed", "model.bin")).toEqual(expected("single/expected.bin"));
  // A missing model is reported, not stored.
  expect(await prepare({ dir: "gone", base: `${HF}test/gone/resolve/main`, packed: "qwen-asr-q8.bin" })).toContain("404");

  // The engine (WebAssembly with threads) starts on this page under the extension's policies.
  const started = await page.evaluate(
    () =>
      new Promise<string>((resolve) => {
        const s = document.createElement("script");
        s.src = "vendor/qwen-asr/qwen_asr.js";
        s.onload = async () => {
          const create = (window as unknown as { createQwenASR: (o: object) => Promise<Record<string, (...a: number[]) => number>> }).createQwenASR;
          const M = await create({ pthreadPoolSize: 2 });
          resolve(M._qwen_wasm_alloc(1024) ? `threads: ${M._qwen_wasm_threads()}` : "no memory");
        };
        s.onerror = () => resolve("didn't load");
        document.head.append(s);
      }),
  );
  expect(started).toMatch(/^threads: \d+$/);
  expect(problems).toEqual([]);
});

test.describe("speech recognizer tester with a fan running", () => {
  test.use({ micFile: path.resolve("tests/fixtures/speech/three-commands-fan.wav") });

  test("its speech detector splits three commands over air-conditioner noise into three phrases", async ({
    context,
    extensionId,
    problems,
  }) => {
    const page = await watchedPage(context, problems);
    await page.goto(`chrome-extension://${extensionId}/asr-lab.html`);
    await expect(page.locator("#detector")).toContainText("Silero VAD");
    await page.getByRole("button", { name: "Start listening" }).click();
    // The file is 8.6 s: three commands with 1.6 s pauses, the fan 12 dB below the voice throughout.
    await expect(page.locator("#rows > li")).toHaveCount(3, { timeout: 20_000 });
    await page.waitForTimeout(2000);
    await expect(page.locator("#rows > li")).toHaveCount(3);
    expect(problems).toEqual([]);
  });
});
