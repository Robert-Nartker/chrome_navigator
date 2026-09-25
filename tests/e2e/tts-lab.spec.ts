// Voice lab (tts-lab.html). Real voice models are 60-330 MB downloads from Hugging Face, so these tests
// either make those downloads fail or serve tiny stand-in models (tests/fixtures/tts/) that output a
// tone. Everything else is real: the vendored ONNX Runtime builds, the phonemizers, the Kokoro and
// Pocket TTS workers, caching and playback, all under the extension's content security policy.

import { type BrowserContext, type Page, chromium, expect, test as base } from "@playwright/test";
import { existsSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const DIST = path.resolve("dist");
const MODELS = path.resolve("tests/fixtures/tts");
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
const KOKORO = `${HF}onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main/`;
const POCKET = `${HF}vlapky/pocket-tts-onnx/resolve/main/onnx/english_2026-04/`;
const PIPER = `${HF}diffusionstudio/piper-voices/resolve/main/en/en_US/hfc_female/medium/en_US-hfc_female-medium`;

const model = (name: string) => readFile(path.join(MODELS, name));

/** Kokoro-style tokenizer: one token per character, wrapped in "$". */
function kokoroTokenizer() {
  const vocab: Record<string, number> = { $: 0 };
  for (const ch of " .,!?abcdefghijklmnopqrstuvwxyzæðŋɑɔəɛɪʃʊʌʒˈˌː") vocab[ch] = Object.keys(vocab).length;
  const $ = { SpecialToken: { id: "$", type_id: 0 } };
  return {
    version: "1.0",
    added_tokens: [{ id: 0, content: "$", single_word: false, lstrip: false, rstrip: false, normalized: false, special: true }],
    normalizer: null,
    pre_tokenizer: { type: "Split", pattern: { Regex: "" }, behavior: "Isolated", invert: false },
    post_processor: {
      type: "TemplateProcessing",
      single: [$, { Sequence: { id: "A", type_id: 0 } }, $],
      pair: [],
      special_tokens: { $: { id: "$", ids: [0], tokens: ["$"] } },
    },
    decoder: null,
    model: { vocab },
  };
}

/** Stand-ins for the files each engine downloads from Hugging Face. */
const STAND_INS: Record<string, () => Promise<Buffer> | Buffer | string> = {
  [`${KOKORO}config.json`]: () => JSON.stringify({ model_type: "style_text_to_speech_2" }),
  [`${KOKORO}tokenizer.json`]: () => JSON.stringify(kokoroTokenizer()),
  [`${KOKORO}tokenizer_config.json`]: () => JSON.stringify({ model_max_length: 512, unk_token: "$", pad_token: "$" }),
  [`${KOKORO}onnx/model_quantized.onnx`]: () => model("kokoro-tone.onnx"),
  // One 256-value style vector per input length.
  [`${KOKORO}voices/af_heart.bin`]: () => Buffer.alloc(510 * 256 * 4),
  [`${PIPER}.onnx.json`]: () =>
    JSON.stringify({
      audio: { sample_rate: 22050 },
      espeak: { voice: "en-us" },
      inference: { noise_scale: 0.667, length_scale: 1, noise_w: 0.8 },
      speaker_id_map: {},
    }),
  [`${PIPER}.onnx`]: () => model("piper-tone.onnx"),
  [`${POCKET}bundle.json`]: () =>
    JSON.stringify({
      sample_rate: 24000,
      samples_per_frame: 1920,
      latent_dim: 32,
      conditioning_dim: 1024,
      tokenizer_file: "tokenizer.model",
      predefined_voices: ["alba"],
      flow_lm_state_manifest: [],
    }),
  [`${POCKET}tokenizer.model`]: () => Buffer.alloc(0),
  // "PTVB1" voice states: one voice, "alba", with no tensors.
  [`${POCKET}voices.bin`]: () =>
    Buffer.concat([Buffer.from("PTVB1"), Buffer.from([1, 0, 0, 0, 4, 0]), Buffer.from("alba"), Buffer.from([0, 0])]),
  // Any valid model works here: this checks that the worker's ONNX Runtime creates the sessions.
  ...Object.fromEntries(
    ["text_conditioner", "flow_lm_main", "flow_lm_flow", "mimi_decoder"].map((m) => [
      `${POCKET}${m}_int8.onnx`,
      () => model("double.onnx"),
    ]),
  ),
};

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
  await expect(engine(lab, "pocket")).toContainText("Load Pocket TTS to see its voices");
  await expect(engine(lab, "piper").locator(".voices li")).toHaveCount(5);
  // ElevenLabs only appears when Navi has a key.
  await expect(engine(lab, "eleven")).toBeHidden();
  await expect(lab.locator("#volume-note")).toContainText("60%");
  // Headless Chromium can't use WebGPU, so Kokoro falls back to WebAssembly.
  await expect(lab.locator("#kokoro-device")).toHaveValue("wasm");

  // The engines' code and runtimes load only when used.
  await lab.waitForTimeout(500);
  expect(requested.filter((url) => /\/vendor\/|kokoro|piper|ort\./.test(url))).toEqual([]);
  expect(problems).toEqual([]);

  // Settings links here.
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await expect(options.getByRole("link", { name: "Compare voices" })).toHaveAttribute("href", "tts-lab.html");
});

test("each engine shows a clear error when its model download fails, and can retry", async ({ lab, context, problems }) => {
  const blocked = await blockHuggingFace(context);
  await loadButton(lab, "kokoro").click();
  await expect(engine(lab, "kokoro").locator(".status")).toContainText("Couldn't load Kokoro", { timeout: 20_000 });
  await loadButton(lab, "pocket").click();
  await expect(engine(lab, "pocket").locator(".status")).toContainText("Couldn't load Pocket TTS", { timeout: 20_000 });
  await lab.getByRole("button", { name: "Play Amy (Piper)" }).click();
  await expect(engine(lab, "piper").locator(".status")).toContainText("Couldn't load Piper Amy", { timeout: 20_000 });
  await expect(lab.locator("li[data-key='piper:en_US-amy-medium'] .voice-note")).toContainText("Couldn't load this voice");
  for (const id of ["kokoro", "pocket", "piper"]) {
    await expect(engine(lab, id).locator(".status")).toContainText("check your internet connection");
  }
  expect(blocked.some((url) => url.startsWith(KOKORO))).toBe(true);
  // Pocket TTS downloads from its worker; those requests go through the same route.
  expect(blocked.some((url) => url.startsWith(POCKET))).toBe(true);

  // Piper stores whatever the server returns; a 404 page must not be reused once the voice is available.
  await blockHuggingFace(context, "404");
  await lab.getByRole("button", { name: "Play HFC female (Piper)" }).click();
  await expect(engine(lab, "piper").locator(".status")).toContainText("Couldn't load Piper HFC female", { timeout: 20_000 });
  await serveStandIns(context);
  await lab.getByRole("button", { name: "Play HFC female (Piper)" }).click();
  await expect(engine(lab, "piper").locator(".status")).toContainText("Piper HFC female loaded", { timeout: 30_000 });
  expect(problems).toEqual([]);
});

test("runs Kokoro, Piper and Pocket TTS on their vendored runtimes, then loads them again offline", async ({
  lab,
  context,
  problems,
}) => {
  test.setTimeout(120_000);
  const requested = await serveStandIns(context);
  await compareOnly(lab, ["Heart (Kokoro)", "HFC female (Piper)"]);
  await lab.getByRole("button", { name: "Play this phrase in all selected voices" }).click();
  await expect(lab.locator("#status")).toHaveText("Played 2 voices.", { timeout: 60_000 });

  // Real synthesis through each engine (the stand-in models return a 0.3 s tone).
  for (const name of ["Heart (Kokoro)", "HFC female (Piper)"]) {
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

  // Pocket TTS: its worker loads ONNX Runtime from the extension and creates all four model sessions.
  await loadButton(lab, "pocket").click();
  await expect(engine(lab, "pocket").locator(".status")).toContainText("Pocket TTS loaded", { timeout: 30_000 });
  // The stand-ins can't drive its generation loop; that fails with a message instead of hanging.
  await lab.getByRole("button", { name: "Play Alba (Pocket TTS)" }).click();
  await expect(lab.locator("li[data-key='pocket:alba'] .voice-note")).toContainText("Couldn't play", { timeout: 20_000 });

  // Next visit, offline: everything comes from the browser's storage.
  const offline = await blockHuggingFace(context);
  await lab.reload();
  await loadButton(lab, "kokoro").click();
  await expect(engine(lab, "kokoro").locator(".status")).toContainText("already downloaded", { timeout: 30_000 });
  await loadButton(lab, "pocket").click();
  await expect(engine(lab, "pocket").locator(".status")).toContainText("already downloaded", { timeout: 30_000 });
  await lab.getByRole("button", { name: "Play HFC female (Piper)" }).click();
  await expect(engine(lab, "piper").locator(".status")).toContainText("already downloaded", { timeout: 30_000 });
  await lab.getByRole("button", { name: "Play Heart (Kokoro)" }).click();
  await expect(resultRow(lab, "Heart (Kokoro)")).toBeVisible({ timeout: 30_000 });
  expect(offline).toEqual([]);
  await expect(lab.locator("#storage")).toContainText("Downloaded voice models use about");
  expect(problems).toEqual([]);
});

test("the vendored ONNX Runtime 1.20 runs a model in an extension page", async ({ lab, problems }) => {
  const bytes = [...(await model("double.onnx"))];
  const output = await lab.evaluate(async (modelBytes) => {
    const base = chrome.runtime.getURL("vendor/ort-1.20.0/");
    const ort = await import(`${base}ort.min.mjs`);
    ort.env.wasm.wasmPaths = base;
    ort.env.wasm.numThreads = 1;
    const session = await ort.InferenceSession.create(new Uint8Array(modelBytes), { executionProviders: ["wasm"] });
    const result = await session.run({ x: new ort.Tensor("float32", new Float32Array([1, 2, 3]), [3]) });
    return [...(result.y.data as Float32Array)];
  }, bytes);
  expect(output).toEqual([3, 5, 7]);
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
  await compareOnly(lab, ["Heart (Kokoro)", "Bella (Kokoro)", "HFC female (Piper)"]);
  await lab.getByLabel("Rating for Heart (Kokoro)").selectOption("5");
  await lab.getByLabel("Rating for HFC female (Piper)").selectOption("3");
  await expect(lab.locator("#top li")).toHaveText(["Heart (Kokoro): 5/5", "HFC female (Piper): 3/5"]);
  const stored = await lab.evaluate(() => chrome.storage.local.get("ttsLabRatings"));
  expect(stored.ttsLabRatings).toEqual({
    "kokoro:af_heart": { rating: 5, label: "Heart (Kokoro)" },
    "piper:en_US-hfc_female-medium": { rating: 3, label: "HFC female (Piper)" },
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
  await expect(lab.locator("#status")).not.toContainText(/Kokoro|Piper/);
  await expect(lab.locator("#top li").first()).toHaveText(/^Voice [ABC]: 5\/5$/);
  // Rating a letter saves it under the real voice.
  await blind.nth(0).getByRole("combobox").selectOption("4");
  await lab.getByRole("button", { name: "Reveal names" }).click();
  await expect(blind.locator(".pick")).toHaveText([/^Voice A: /, /^Voice B: /, /^Voice C: /]);
  const first = (await blind.nth(0).locator(".pick").textContent())!.replace(/^Voice A: /, "");
  await expect(lab.locator("#top")).toContainText(`${first}: 4/5`);

  // Ratings survive a reload.
  await lab.goto(`chrome-extension://${extensionId}/tts-lab.html`);
  await expect(lab.getByLabel("Rating for HFC female (Piper)")).toHaveValue(first === "HFC female (Piper)" ? "4" : "3");
});

test("ElevenLabs shows only with a key, is marked paid, and plays through Navi's speaker", async ({ lab, context }) => {
  const requests: { url: string; key?: string }[] = [];
  await context.route("https://api.elevenlabs.io/**", (route) => {
    requests.push({ url: route.request().url(), key: route.request().headers()["xi-api-key"] });
    // 0.3 s of a quiet tone as 24 kHz 16-bit PCM.
    const pcm = Buffer.alloc(24000 * 0.3 * 2);
    for (let i = 0; i < pcm.length / 2; i++) pcm.writeInt16LE(Math.round(Math.sin(i / 10) * 2000), i * 2);
    return route.fulfill({ status: 200, contentType: "application/octet-stream", body: pcm });
  });
  await lab.evaluate(() => chrome.storage.local.set({ settings: { elevenLabsKey: "el-test-key" } }));
  await lab.reload();
  await expect(engine(lab, "eleven")).toBeVisible();
  await expect(engine(lab, "eleven").locator("legend")).toContainText("Paid");
  await lab.getByRole("button", { name: "Play Sarah (ElevenLabs)" }).click();
  await expect(resultRow(lab, "Sarah (ElevenLabs)").locator("td").nth(3)).toHaveText(/\d+ ms/);
  expect(requests[0].url).toContain("/v1/text-to-speech/EXAVITQu4vr4xnSDxMaL/stream");
  expect(requests[0].key).toBe("el-test-key");
});
