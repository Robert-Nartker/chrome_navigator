// Loads the built extension (dist/) into Chromium and drives it through the
// side panel's command pipeline against local test pages.

import { type BrowserContext, type Page, chromium, expect, test as base } from "@playwright/test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";

import { tmpdir } from "node:os";
import path from "node:path";

import { KOKORO, KOKORO_STAND_INS } from "./fake-models";
import { installFakeRecognizer } from "./fake-speech";
import { CHROMIUM, startServer } from "./helpers";
import { type Settings, normalizeSettings } from "../../src/lib/settings";

const DIST = path.resolve("dist");

type Fixtures = {
  context: BrowserContext;
  extensionId: string;
  baseUrl: string;
  site: Page;
  panel: Page;
  /** Give Chromium a fake microphone (a test tone) that's allowed without a prompt. */
  fakeMic: boolean;
  /** Replace Chrome's on-device model (Gemini Nano) in extension pages with a scripted one. */
  fakeNano: boolean;
  /** Replace Chrome's speech recognizer with a scripted one reporting this on-device status (null: the real one). */
  fakeSpeech: string | null;
};

/**
 * A stand-in for Chrome's Prompt API: routes a few phrases, and answers Navi Free's chat for the
 * requests the tests make. Every prompt is kept in window.__nanoLog.
 */
function installFakeNano() {
  if (location.protocol !== "chrome-extension:") return;
  const w = window as unknown as Record<string, unknown>;
  const log: { text: string; image: boolean }[] = [];
  w.__nanoLog = log;
  const none = { phrases: [], steps: [], description: "" };
  const answer = (system: string, text: string): object => {
    if (system.startsWith("You route voice input")) {
      const heard = /Heard: "(.*)"/.exec(text)?.[1] ?? "";
      if (heard.includes("smidge")) return { route: "command", command: "scroll down" };
      if (heard.includes("tiktok")) return { route: "ignore", command: "" };
      return { route: "agent", command: "" };
    }
    const said = /(?:Typed|Said): "(.*)"/.exec(text)?.[1] ?? "";
    const page = /Current page: .* \((http[^)]*)\)/.exec(text)?.[1] ?? "";
    if (said.includes("when I say")) {
      const url = new URL("about.html", page).href;
      return {
        reply: "Saved: say “about page” to open it.",
        run: [],
        save: { phrases: ["about page"], steps: [{ type: "open", value: url, new_tab: false }], description: "Opens the about page" },
        delete: "",
      };
    }
    if (said.includes("take me down")) return { reply: "Scrolled down, then back to the top.", run: ["scroll down", "scroll to the top"], save: none, delete: "" };
    const knows = text.includes("Article text at the bottom");
    return { reply: knows ? "It's the Navi test page, with an article at the bottom." : "I can't see the page.", run: [], save: none, delete: "" };
  };
  class Session {
    constructor(private readonly system: string) {}
    async prompt(input: unknown) {
      const image = typeof input !== "string";
      const text = image ? (input as { content: { value: string }[] }[])[0].content[0].value : (input as string);
      log.push({ text, image });
      return JSON.stringify(answer(this.system, text));
    }
    async clone() {
      return new Session(this.system);
    }
    destroy() {}
  }
  w.LanguageModel = {
    availability: async () => "available",
    create: async (options?: { initialPrompts?: { content: string }[] }) => new Session(options?.initialPrompts?.[0]?.content ?? ""),
  };
}

/** One second of silence (16 kHz mono WAV): the fake mic stays quiet unless a test "talks". */
async function silentWav(dir: string): Promise<string> {
  const samples = 16000;
  const wav = Buffer.alloc(44 + samples * 2);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(36 + samples * 2, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); // PCM
  wav.writeUInt16LE(1, 22); // mono
  wav.writeUInt32LE(16000, 24);
  wav.writeUInt32LE(32000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(samples * 2, 40);
  const file = path.join(dir, "silence.wav");
  await writeFile(file, wav);
  return file;
}

const test = base.extend<Fixtures>({
  fakeMic: [false, { option: true }],
  fakeNano: [false, { option: true }],
  fakeSpeech: [null, { option: true }],
  baseUrl: async ({}, use) => {
    const { server, baseUrl } = await startServer();
    await use(baseUrl);
    server.close();
  },
  context: async ({ fakeMic, fakeNano, fakeSpeech }, use) => {
    const userDataDir = await mkdtemp(path.join(tmpdir(), "navi-e2e-"));
    // The default fake mic beeps every second, which can sound like speech; this one is silent.
    const media = fakeMic
      ? [
          "--use-fake-device-for-media-stream",
          "--use-fake-ui-for-media-stream",
          `--use-file-for-fake-audio-capture=${await silentWav(userDataDir)}`,
        ]
      : [];
    const context = await chromium.launchPersistentContext(userDataDir, {
      executablePath: CHROMIUM,
      headless: true,
      args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`, ...media],
    });
    if (fakeNano) await context.addInitScript(installFakeNano);
    if (fakeSpeech) await context.addInitScript(installFakeRecognizer, fakeSpeech);
    // Navi's on-device voice downloads its model from Hugging Face; tests never do (voice tests serve stand-ins).
    await context.route("https://huggingface.co/**", (route) => route.abort());
    await use(context);
    await context.close();
    // Each test's Chrome profile is a few hundred MB.
    await rm(userDataDir, { recursive: true, force: true });
  },
  extensionId: async ({ context }, use) => {
    let [worker] = context.serviceWorkers();
    worker ??= await context.waitForEvent("serviceworker");
    await use(new URL(worker.url()).host);
  },
  site: async ({ context, baseUrl }, use) => {
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(`${baseUrl}/index.html`);
    await use(page);
  },
  panel: async ({ context, extensionId, site }, use) => {
    // The setup tab opens on install; close it so it doesn't count as a web tab.
    for (const p of context.pages()) if (p.url().includes("setup.html")) await p.close();
    await site.bringToFront();
    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await panel.waitForFunction(() => "navi" in window);
    await use(panel);
  },
});

type RunHook = { navi: { run(t: string, source?: "typed" | "voice"): Promise<void> } };

/** A command as if spoken (the voice pipeline: router, then the AI with the page's element list). */
async function run(panel: Page, command: string) {
  await panel.evaluate((text) => (window as unknown as RunHook).navi.run(text, "voice"), command);
}

/** Navi's settings as it runs with them (each mode keeps some of its own, so the stored object isn't enough). */
async function settingsOf(page: Page): Promise<Settings> {
  return normalizeSettings(await page.evaluate(async () => (await chrome.storage.local.get("settings")).settings as Partial<Settings>));
}

/** A message typed in the panel's chat box. */
async function type(panel: Page, message: string) {
  await panel.evaluate((text) => (window as unknown as RunHook).navi.run(text, "typed"), message);
}

async function snapshotFromPanel(panel: Page) {
  return panel.evaluate(async () => {
    const tabs = await chrome.tabs.query({});
    const web = tabs.filter((t) => t.url?.startsWith("http")).sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0));
    const res = await chrome.tabs.sendMessage(web[0].id!, { kind: "snapshot" });
    return res.snapshot as { gen: number; elements: { id: number; name: string; role: string; value?: string }[] };
  });
}

test("snapshot names elements like a screen reader and hides passwords", async ({ panel }) => {
  const snap = await snapshotFromPanel(panel);
  const names = snap.elements.map((e) => e.name);
  expect(names).toEqual(expect.arrayContaining(["Home", "About", "Sign in", "Subscribe", "Open settings menu", "Open card", "Search the site"]));
  const password = snap.elements.find((e) => e.name === "Password");
  expect(password?.value).toBeUndefined();
  expect(snap.elements.find((e) => e.name === "Open card")?.role).toBe("clickable");
});

test("click by label and by number", async ({ panel, site }) => {
  await run(panel, "click sign in");
  await expect(site.locator("#result")).toHaveText("signed in");

  await run(panel, "show numbers");
  const badges = await site.evaluate(() => document.querySelector("navi-overlay")?.shadowRoot?.querySelectorAll(".badge").length ?? 0);
  expect(badges).toBeGreaterThan(5);
  const snap = await snapshotFromPanel(panel);
  const subscribe = snap.elements.find((e) => e.name === "Subscribe")!;
  await run(panel, `click ${subscribe.id}`);
  await expect(site.locator("#subs")).toHaveText("1");
  await run(panel, "click open card");
  await expect(site.locator("#result")).toHaveText("card opened");
});

test("scrolls the page", async ({ panel, site }) => {
  await run(panel, "scroll down");
  await expect.poll(() => site.evaluate(() => scrollY)).toBeGreaterThan(100);
  await run(panel, "scroll to the top");
  await expect.poll(() => site.evaluate(() => scrollY)).toBe(0);
});

test("types into the focused field and submits into a numbered one", async ({ panel, site }) => {
  await site.focus("#q");
  await run(panel, "type hello world");
  await expect(site.locator("#q")).toHaveValue("hello world");
  await expect(site.locator("#mirror")).toHaveText("hello world");

  const snap = await snapshotFromPanel(panel);
  const box = snap.elements.find((e) => e.name === "Search the site")!;
  await run(panel, "show numbers");
  await site.fill("#q", "");
  await run(panel, `type cats into ${box.id} and press enter`);
  await expect(site).toHaveURL(/search\.html\?q=cats/);
  await expect(site.locator("#q")).toHaveText("Results for cats");
});

test("navigates, goes back, and manages tabs", async ({ panel, site, baseUrl, context }) => {
  const port = new URL(baseUrl).port;
  // Chrome's back button skips history entries the user never interacted with.
  await site.click("h1");
  await run(panel, `go to localhost:${port}/about.html`);
  await expect(site).toHaveURL(/about\.html/);
  await run(panel, "go back");
  await expect(site).toHaveURL(/index\.html/);

  const before = context.pages().length;
  await run(panel, `open localhost:${port}/about.html in a new tab`);
  await expect.poll(() => context.pages().length).toBe(before + 1);
  await run(panel, "close this tab");
  await expect.poll(() => context.pages().length).toBe(before);
});

test("closing a tab by name closes only that tab, and asks when unsure", async ({ panel, site, baseUrl, context }) => {
  const port = new URL(baseUrl).port;
  await run(panel, `open localhost:${port}/about.html in a new tab`);
  await expect.poll(() => context.pages().some((p) => p.url().includes("about.html"))).toBe(true);
  await site.bringToFront();
  const count = () => context.pages().filter((p) => p.url().startsWith(baseUrl)).length;
  expect(count()).toBe(2);

  // A name that matches no tab: nothing is closed.
  await run(panel, "close the recipes tab");
  await expect(panel.locator("#log li.navi").last()).toContainText("couldn't find a tab called");
  expect(count()).toBe(2);

  // The named tab closes, and the current one stays open.
  await run(panel, "close the about navi tab");
  await expect.poll(count).toBe(1);
  expect(site.isClosed()).toBe(false);
});

test("router: one tab closes from loose speech (reopen brings it back), but other tabs never close without a plain request", async ({
  panel,
  site,
  baseUrl,
  context,
}) => {
  await context.route(
    "https://api.anthropic.com/**",
    routerOrAgent((body) => {
      const heard = String((body.messages as { content: unknown }[]).at(-1)?.content);
      const other = heard.includes('Heard: "clothes the other taps"');
      return [{ type: "text", text: JSON.stringify({ route: "command", command: other ? "close other tabs" : "close tab" }) }];
    }),
  );
  await panel.evaluate(() =>
    chrome.storage.local.set({ settings: { apiKey: "sk-ant-test", model: "claude-opus-5-5", routerModel: "claude-sonnet-5-5" } }),
  );
  await panel.waitForFunction(() => document.getElementById("key-banner")?.hidden === true);
  const port = new URL(baseUrl).port;
  await run(panel, `open localhost:${port}/about.html in a new tab`);
  await site.bringToFront();
  const count = () => context.pages().filter((p) => p.url().startsWith(baseUrl)).length;
  await expect.poll(count).toBe(2);

  await run(panel, "clothes the other taps");
  await expect(panel.locator("#log li.navi").last()).toContainText("didn't do it, to be safe");
  expect(count()).toBe(2);

  await run(panel, "clothes the red it tap");
  await expect.poll(() => site.isClosed()).toBe(true);
  await run(panel, "reopen tab");
  await expect.poll(count).toBe(2);

  // YOLO: no double-checking.
  await panel.evaluate(async () => {
    const { settings } = (await chrome.storage.local.get("settings")) as { settings: Record<string, unknown> };
    await chrome.storage.local.set({ settings: { ...settings, autonomy: "yolo" } });
  });
  await run(panel, "clothes the other taps");
  await expect.poll(count).toBe(1);
});

test("keyboard games: the agent types a whole guess in one step, and “type … and press enter” works with no text box", async ({
  panel,
  site,
  baseUrl,
  context,
}) => {
  await site.goto(`${baseUrl}/keys.html`);
  const guesses = site.locator("#guesses li");
  // Spoken: nothing to type into, so the letters go to the page. A focused on-screen key doesn't take the Enter.
  await site.focus("button[data-key=q]");
  await run(panel, "type crane and press enter");
  await expect(guesses).toHaveText(["CRANE"]);

  const calls: string[] = [];
  await context.route(
    "https://api.anthropic.com/**",
    routerOrAgent((body) => {
      const messages = body.messages as unknown[];
      calls.push(messages.length === 1 ? "look" : "done");
      return messages.length === 1
        ? [{ type: "tool_use", id: "t1", name: "type_keys", input: { text: "slate", submit: true } }]
        : [{ type: "text", text: "[done] Guessed SLATE." }];
    }),
  );
  await panel.evaluate(() =>
    chrome.storage.local.set({ settings: { apiKey: "sk-ant-test", model: "claude-opus-5-5", routerModel: "off" } }),
  );
  await panel.waitForFunction(() => document.getElementById("key-banner")?.hidden === true);
  await type(panel, "guess slate in this game");
  await expect(guesses).toHaveText(["CRANE", "SLATE"]);
  expect(calls).toEqual(["look", "done"]);
  await expect(panel.locator("#log li.navi").last()).toContainText("Guessed SLATE.");
});

test("video volume: set to a level, and turned up or down however it's said", async ({ panel, site, baseUrl }) => {
  await site.goto(`${baseUrl}/video.html`);
  const volume = () => site.locator("#player").evaluate((v: HTMLVideoElement) => Math.round(v.volume * 100));
  await run(panel, "Turn volume to 45.");
  await expect.poll(volume).toBe(45);
  await run(panel, "turn the volume down");
  await expect.poll(volume).toBe(30);
  await run(panel, "set the volume to 80 percent");
  await expect.poll(volume).toBe(80);
});

test("“open” opens a new tab; “go back” is the browser's back button and never closes a tab; “go to” stays in this tab", async ({
  panel,
  site,
  baseUrl,
  context,
}) => {
  const port = new URL(baseUrl).port;
  const webTabs = () => context.pages().filter((p) => p.url().startsWith("http"));
  await run(panel, `open 127.0.0.1:${port}/about.html`);
  await expect.poll(() => webTabs().length).toBe(2);
  await expect(site).toHaveURL(/localhost.*index\.html/);
  const opened = webTabs().find((p) => p.url().includes("127.0.0.1"))!;
  // The new tab has nothing to go back to: Navi says so (and how to get back) instead of closing it.
  await run(panel, "go back");
  await expect(panel.locator("#log li.error .text").last()).toHaveText(
    "There's no previous page in this tab. To get back to “Navi Test Page”, say “close tab”.",
  );
  expect(opened.isClosed()).toBe(false);
  await run(panel, "close tab");
  await expect.poll(() => opened.isClosed()).toBe(true);
  // "Go to" replaces the page, and "go back" is ordinary history.
  await run(panel, `go to 127.0.0.1:${port}/about.html`);
  await expect(site).toHaveURL(/127\.0\.0\.1.*about\.html/);
  await run(panel, "go back");
  await expect(site).toHaveURL(/localhost.*index\.html/);
  expect(webTabs().length).toBe(1);
});

test("“search for …” on a site Navi doesn't know uses the site's own search box, not Google", async ({ panel, site }) => {
  await run(panel, "search for octopus");
  await expect(site).toHaveURL(/localhost.*search\.html\?q=octopus/);
  await expect(panel.locator("#log li.navi .text").last()).toHaveText("Searching this site for octopus");
  // "Google …" still searches the web.
  await run(panel, "google octopus");
  await expect(panel.locator("#log li.navi .text").last()).toHaveText("Searching for octopus");
});

test("closing a tab with unsent typing asks first by default (“yes” closes it); searches don't count; YOLO just closes", async ({
  panel,
  baseUrl,
  context,
}) => {
  const port = new URL(baseUrl).port;
  const openNote = async () => {
    const opened = context.waitForEvent("page", { predicate: (p) => p.url().includes("note.html") });
    await run(panel, `open localhost:${port}/note.html`);
    const page = await opened;
    await page.waitForLoadState();
    return page;
  };

  // Typing in a search box isn't work to lose.
  let note = await openNote();
  await note.getByLabel("Search notes").fill("groceries");
  await run(panel, "close tab");
  await expect.poll(() => note.isClosed()).toBe(true);

  note = await openNote();
  await note.getByRole("textbox", { name: "Note", exact: true }).fill("Half-written reply to Sarah");
  await run(panel, "close tab");
  await expect(panel.locator("#log li.navi").last()).toContainText("“Navi Notes” has typing that isn't sent or saved. Close anyway?");
  expect(note.isClosed()).toBe(false);
  await run(panel, "yes");
  await expect.poll(() => note.isClosed()).toBe(true);

  // YOLO: no question.
  await panel.evaluate(() => chrome.storage.local.set({ settings: { autonomy: "yolo" } }));
  note = await openNote();
  await note.getByRole("textbox", { name: "Note", exact: true }).fill("Another draft");
  await run(panel, "close tab");
  await expect.poll(() => note.isClosed()).toBe(true);
});

test("the AI doesn't close a tab with unsent typing unless the user said yes to losing it", async ({ panel, baseUrl, context }) => {
  const port = new URL(baseUrl).port;
  const opened = context.waitForEvent("page", { predicate: (p) => p.url().includes("note.html") });
  await run(panel, `open localhost:${port}/note.html`);
  const note = await opened;
  await note.getByRole("textbox", { name: "Note", exact: true }).fill("Half-written reply to Sarah");
  const results: string[] = [];
  await context.route(
    "https://api.anthropic.com/**",
    routerOrAgent((body) => {
      const messages = body.messages as { content: unknown }[];
      if (messages.length === 1) {
        const tabId = Number(String(messages[0].content).match(/\(tab (\d+)\) Navi Notes/)?.[1]);
        return [{ type: "tool_use", id: "t1", name: "close_tabs", input: { tab_ids: [tabId], discard_unsaved: false } }];
      }
      results.push(JSON.stringify(messages.at(-1)?.content));
      return [{ type: "text", text: "Navi Notes has an unsent draft. Close it anyway?" }];
    }),
  );
  await panel.evaluate(() =>
    chrome.storage.local.set({ settings: { apiKey: "sk-ant-test", model: "claude-opus-5-5", routerModel: "off" } }),
  );
  await panel.waitForFunction(() => document.getElementById("key-banner")?.hidden === true);
  await type(panel, "tidy up my tabs by getting rid of the notes one");
  await expect(panel.locator("#log li.navi").last()).toContainText("Close it anyway?");
  expect(note.isClosed()).toBe(false);
  expect(results[0]).toContain("Not closed, because they have typing that isn't sent or saved");
});

test("YOLO: the panel's switch turns it on; the AI is then told to act without asking, with no step limit", async ({ panel, context }) => {
  const systems: string[] = [];
  await context.route(
    "https://api.anthropic.com/**",
    routerOrAgent((body) => {
      systems.push(JSON.stringify(body.system));
      // Scrolls for five steps, then answers.
      return (body.messages as unknown[]).length < 1 + 2 * 5
        ? [{ type: "tool_use", id: `t${systems.length}`, name: "scroll", input: { direction: "down", amount: "small" } }]
        : [{ type: "text", text: "[done] Scrolled through it all." }];
    }),
  );
  await panel.evaluate(() =>
    chrome.storage.local.set({ settings: { apiKey: "sk-ant-test", model: "claude-opus-5-5", routerModel: "off", maxAgentSteps: 3 } }),
  );
  await panel.waitForFunction(() => document.getElementById("key-banner")?.hidden === true);
  const yolo = panel.getByRole("button", { name: "YOLO" });
  await expect(yolo).toHaveAttribute("aria-pressed", "false");

  await type(panel, "look over every section of this page for me");
  await expect(panel.locator("#log li.navi").last()).toContainText("too many steps");
  expect(systems).toHaveLength(3);
  expect(systems[0]).toContain("Ask first only before");

  await yolo.click();
  await expect(yolo).toHaveAttribute("aria-pressed", "true");
  expect((await settingsOf(panel)).autonomy).toBe("yolo");
  await type(panel, "look over every section of this page for me");
  await expect(panel.locator("#log li.navi").last()).toContainText("Scrolled through it all.");
  expect(systems).toHaveLength(3 + 6);
  expect(systems.at(-1)).toContain("YOLO mode is on");
});

test("setup: connecting a key checks it, then turns on that provider's recommended models", async ({ panel, context, extensionId }) => {
  const seen: string[] = [];
  await context.route("https://api.anthropic.com/v1/models**", (route) => {
    const key = route.request().headers()["x-api-key"];
    seen.push(key);
    if (key !== "sk-ant-good") return route.fulfill({ status: 401, json: { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } } });
    return route.fulfill({
      json: {
        data: [{ type: "model", id: "claude-sonnet-5-5", display_name: "Claude Sonnet 5.5", created_at: "2026-09-28T00:00:00Z" }],
        has_more: false,
        first_id: "claude-sonnet-5-5",
        last_id: "claude-sonnet-5-5",
      },
    });
  });
  await context.route("https://api.openai.com/v1/models", (route) => route.fulfill({ json: { data: [{ id: "gpt-6.1-sol" }] } }));

  // The panel's banner leads straight to this step.
  await expect(panel.locator("#key-banner")).toBeVisible();
  const [setup] = await Promise.all([context.waitForEvent("page"), panel.locator("#open-settings-inline").click()]);
  await setup.waitForLoadState();
  expect(setup.url()).toBe(`chrome-extension://${extensionId}/setup.html#ai`);
  const key = setup.locator("#ai-key");
  const result = setup.locator("#ai-result");

  // A pasted Claude key switches the provider by itself.
  await key.fill("sk-ant-wrong");
  await expect(setup.locator("input[name=provider][value=anthropic]")).toBeChecked();
  await expect(setup.locator("#ai-key-label")).toHaveText("Anthropic API key");
  await setup.locator("#ai-connect").click();
  await expect(result).toHaveText("Anthropic rejected that key. Check that you copied all of it.");
  let settings = await setup.evaluate(async () => (await chrome.storage.local.get("settings")).settings as Record<string, string> | undefined);
  expect(settings?.apiKey).toBeFalsy();

  await key.fill("sk-ant-good");
  await key.press("Enter");
  await expect(result).toContainText("Connected to Anthropic.");
  await expect(result).toContainText("Tasks and chat: Claude Sonnet 5.5 (low reasoning). Unclear speech: Claude Sonnet 5.5 (no reasoning).");
  await expect(setup.locator("#ai-warning")).toBeHidden();
  expect(await settingsOf(setup)).toMatchObject({ apiKey: "sk-ant-good", model: "claude-sonnet-5-5", routerModel: "claude-sonnet-5-5", effort: "low" });
  expect(seen).toEqual(["sk-ant-wrong", "sk-ant-good"]);
  await expect(panel.locator("#key-banner")).toBeHidden();

  // An OpenAI key without one of Navi's models still connects, with a note.
  await setup.locator("input[name=provider][value=openai]").check();
  await key.fill("sk-proj-test");
  await setup.locator("#ai-connect").click();
  await expect(result).toContainText("Connected to OpenAI.");
  await expect(setup.locator("#ai-warning")).toContainText("doesn't list gpt-6-luna");
  expect(await settingsOf(setup)).toMatchObject({ openaiKey: "sk-proj-test", apiKey: "sk-ant-good", model: "gpt-6.1-sol", routerModel: "gpt-6-luna" });

  // Reopening shows what's connected.
  await setup.reload();
  await expect(result).toContainText("Connected to OpenAI (and Anthropic).");
});

test.describe("Navi Free", () => {
  test.use({ fakeNano: true });

  test("on-device routing and chat: answers from the page, runs built-in commands, saves voice commands, never calls a paid API", async ({
    panel,
    site,
    context,
  }) => {
    let paid = 0;
    await context.route(/api\.(openai|anthropic)\.com/, (route) => {
      paid++;
      return route.abort();
    });
    await expect(panel.locator("#plan")).toHaveText("Free");
    await expect(panel.locator("#plan")).toHaveAttribute("title", /No cost/);

    // Loose speech: the on-device router turns it into a built-in command.
    await run(panel, "nudge the whole thing along a smidge");
    await expect(panel.locator("#log li.step").filter({ hasText: "Understood as “scroll down”" })).toHaveCount(1);
    await expect.poll(() => site.evaluate(() => scrollY)).toBeGreaterThan(0);
    await run(panel, "tiktok tiktok");
    await expect(panel.locator("#log li.step").filter({ hasText: "Ignored “tiktok tiktok”" })).toHaveCount(1);

    // A question about the page, answered on this computer from the page's text.
    await type(panel, "what is this page about?");
    const reply = panel.locator("#log li.navi").last();
    await expect(reply).toContainText("It's the Navi test page, with an article at the bottom.");
    await expect(reply.locator(".meta")).toContainText("Free · on-device");

    // Several built-in commands in a row.
    await type(panel, "take me down the page and then back where I started");
    await expect(panel.locator("#log li.navi").last()).toContainText("Scrolled down, then back to the top.");
    await expect.poll(() => site.evaluate(() => scrollY)).toBe(0);

    // A voice command, saved by the on-device model, then used by voice with no AI at all.
    await type(panel, "when I say about page, open the about page");
    await expect(panel.locator("#log li.step").filter({ hasText: "Saved command" })).toHaveCount(1);
    await run(panel, "about page");
    await expect(site).toHaveURL(/about\.html$/);

    expect(paid).toBe(0);
    const ears = context.pages().find((p) => p.url().endsWith("/offscreen.html"))!;
    const prompts = await ears.evaluate(() => (window as unknown as { __nanoLog: { text: string }[] }).__nanoLog);
    expect(prompts.some((p) => p.text.includes('Typed: "what is this page about?"'))).toBe(true);
  });

  test("Free / Pro: one click switches, and Pro shows what it costs today", async ({ panel, context }) => {
    // No key: Pro needs one, so the switch opens the setup step.
    const [setup] = await Promise.all([context.waitForEvent("page"), panel.locator("#plan").click()]);
    await expect(setup).toHaveURL(/setup\.html#ai$/);
    await expect(setup.locator("#free-result")).toContainText("Navi Free is on. The on-device AI is ready.");
    await setup.close();

    await panel.evaluate(() => chrome.storage.local.set({ settings: { openaiKey: "sk-test" } }));
    await expect(panel.locator("#plan")).toHaveText(/^Pro · \$0(\.0+)? today$/);
    await expect(panel.locator("#plan")).toHaveAttribute("title", /GPT-6.1 Sol for tasks and chat, GPT-6 Luna for quick checks/);
    // Pro shows how much the AI thinks, starting at the provider's default ("low"), and changes it in one click.
    const thinking = panel.locator("#thinking");
    await expect(thinking).toBeVisible();
    await expect(thinking.getByRole("radio", { name: "Low" })).toBeChecked();
    await thinking.getByRole("radio", { name: "Extra high" }).check();
    await expect.poll(() => settingsOf(panel)).toMatchObject({ effort: "xhigh", model: "gpt-6.1-sol" });
    await expect(thinking.getByRole("radio", { name: "Extra high" })).toBeChecked();
    await panel.locator("#plan").click();
    await expect(panel.locator("#plan")).toHaveText("Free");
    await expect(thinking).toBeHidden();
    expect(await panel.evaluate(async () => ((await chrome.storage.local.get("settings")).settings as { aiMode: string }).aiMode)).toBe("free");
    await panel.locator("#plan").click();
    await expect(panel.locator("#plan")).toHaveText(/^Pro/);

    // Free and Pro keep their own settings: Pro's YOLO and reasoning come back after a trip to Free.
    await expect(thinking.getByRole("radio", { name: "Extra high" })).toBeChecked();
    const yolo = panel.getByRole("button", { name: "YOLO" });
    await yolo.click();
    await expect(yolo).toHaveAttribute("aria-pressed", "true");
    await panel.locator("#plan").click();
    await expect(panel.locator("#plan")).toHaveText("Free");
    expect(await settingsOf(panel)).toMatchObject({ autonomy: "default", memory: false });
    await panel.locator("#plan").click();
    await expect(yolo).toHaveAttribute("aria-pressed", "true");
    expect(await settingsOf(panel)).toMatchObject({ autonomy: "yolo", effort: "xhigh", memory: true });

    // The settings page shows the chosen mode's own values.
    const options = await context.newPage();
    await options.goto(panel.url().replace("sidepanel.html", "options.html"));
    await expect(options.locator("#autonomy")).toHaveValue("yolo");
    await options.locator("#aiMode").selectOption("free");
    await expect(options.locator("#autonomy")).toHaveValue("default");
    await options.locator("#aiMode").selectOption("pro");
    await expect(options.locator("#autonomy")).toHaveValue("yolo");
    await expect(options.locator("#effort")).toHaveValue("xhigh");
  });
});

test("reports restricted pages instead of failing silently", async ({ panel, site }) => {
  await site.goto("chrome://version");
  await run(panel, "scroll down");
  await expect(panel.locator("#log li.error").last()).toContainText("Chrome doesn't let extensions control its own pages");
});

test("AI path: Claude picks the element, extension clicks it, reply is logged", async ({ panel, site, context }) => {
  const requests: { headers: Record<string, string>; body: Record<string, unknown> }[] = [];
  await context.route("https://api.anthropic.com/**", async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    requests.push({ headers: route.request().headers(), body });
    const messages = body.messages as { role: string; content: unknown }[];
    const first = messages.length === 1;
    let content: unknown[];
    let stop: string;
    if (first) {
      // Find the Subscribe button's id in the observation, as the model would.
      const text = String(messages[0].content);
      const id = Number(text.match(/\[(\d+)\] button "Subscribe"/)?.[1]);
      content = [{ type: "tool_use", id: "toolu_1", name: "click", input: { element_id: id } }];
      stop = "tool_use";
    } else {
      content = [{ type: "text", text: "Subscribed." }];
      stop = "end_turn";
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "request-id": "req_test" },
      body: JSON.stringify({
        id: `msg_${requests.length}`,
        type: "message",
        role: "assistant",
        model: body.model,
        content,
        stop_reason: stop,
        stop_sequence: null,
        usage: { input_tokens: 100, output_tokens: 20 },
      }),
    });
  });
  await panel.evaluate(() => chrome.storage.local.set({ settings: { apiKey: "sk-ant-test", model: "claude-opus-5-5", routerModel: "claude-sonnet-5-5" } }));
  await panel.waitForFunction(() => document.getElementById("key-banner")?.hidden === true);

  await run(panel, "hit the subscribe thing for me");
  await expect(site.locator("#subs")).toHaveText("1");
  await expect(panel.locator("#log li.navi").last()).toContainText("Subscribed.");

  expect(requests).toHaveLength(2);
  const [firstReq, secondReq] = requests;
  expect(firstReq.body.model).toBe("claude-opus-5-5");
  expect(firstReq.body.fallbacks).toBe("default");
  expect(firstReq.headers["anthropic-beta"]).toContain("server-side-fallback-2026-07-01");
  expect(firstReq.body.output_config).toEqual({ effort: "low" });
  expect((firstReq.body.tools as { name: string }[]).map((t) => t.name)).toContain("click");
  // Only labels are sent: no page body text.
  expect(JSON.stringify(firstReq.body.messages)).not.toContain("Article text at the bottom");
  // The follow-up carries the tool result with a fresh observation.
  expect(JSON.stringify(secondReq.body.messages)).toContain("New observation");
});

test("AI path: a request with several parts answers right away, then acts, in one go", async ({ panel, site, context }) => {
  let calls = 0;
  await context.route(
    "https://api.anthropic.com/**",
    routerOrAgent((body) => {
      calls++;
      if (calls === 1) {
        const text = String((body.messages as { content: unknown }[])[0].content);
        const id = Number(text.match(/\[(\d+)\] button "Subscribe"/)?.[1]);
        return [
          { type: "tool_use", id: "toolu_say", name: "say", input: { text: "This is the Navi test page." } },
          { type: "tool_use", id: "toolu_click", name: "click", input: { element_id: id } },
        ];
      }
      return [{ type: "text", text: "And you're subscribed." }];
    }),
  );
  await panel.evaluate(() => chrome.storage.local.set({ settings: { apiKey: "sk-ant-test", model: "claude-sonnet-5-5", routerModel: "off" } }));
  await panel.waitForFunction(() => document.getElementById("key-banner")?.hidden === true);
  await run(panel, "what is this page, then subscribe");
  await expect(site.locator("#subs")).toHaveText("1");
  const card = panel.locator("#log > li.turn").last();
  await expect(card.locator("li.navi .text")).toHaveText(["This is the Navi test page.", "And you're subscribed."]);
  expect(calls).toBe(2);
});

test("the log survives closing and reopening the panel", async ({ panel, context }) => {
  await run(panel, "what time is it");
  await expect(panel.locator("#log li.navi").last()).toContainText(/It's \d/);
  const url = panel.url();
  await panel.waitForTimeout(500); // the log is saved shortly after each entry
  await panel.close();
  const reopened = await context.newPage();
  await reopened.goto(url);
  await reopened.waitForFunction(() => "navi" in window);
  await expect(reopened.locator("#log li.user").filter({ hasText: "what time is it" })).toHaveCount(1);
  await expect(reopened.locator("#log li.navi").last()).toContainText(/It's \d/);
  // No second greeting when there's history.
  await expect(reopened.locator("#log li.info").filter({ hasText: "keeps listening" })).toHaveCount(1);
});

test("hands-free: stray words before the name still wake Navi", async ({ panel, site }) => {
  const final = (text: string) =>
    panel.evaluate((t) => (window as unknown as { navi: { handleFinal(t: string): void } }).navi.handleFinal(t), text);
  await final("uh tiktok hey navi click sign in");
  await expect(site.locator("#result")).toHaveText("signed in");
});

test("voice session: ignores speech until 'Hey Navi', then takes commands without the name", async ({ panel, site }) => {
  const final = (text: string) =>
    panel.evaluate((t) => (window as unknown as { navi: { handleFinal(t: string): void } }).navi.handleFinal(t), text);

  await final("click sign in");
  await panel.waitForTimeout(300);
  await expect(site.locator("#result")).toHaveText("idle");

  await final("Hey Navi, click sign in");
  await expect(site.locator("#result")).toHaveText("signed in");
  // (The mic isn't running in tests, so check the session directly rather than the status pill.)
  expect(await panel.evaluate(() => (window as unknown as { navi: { session: { current: string } } }).navi.session.current)).toBe("awake");

  // Still awake: no wake word needed.
  await final("click subscribe");
  await expect(site.locator("#subs")).toHaveText("1");

  await final("go to sleep");
  await expect(panel.locator("#log li.navi").last()).toContainText("Going to sleep");
  await final("click subscribe");
  await panel.waitForTimeout(300);
  await expect(site.locator("#subs")).toHaveText("1");
});

test("privacy: blocked sites never reach the AI", async ({ panel, context }) => {
  let calls = 0;
  await context.route("https://api.anthropic.com/**", (route) => {
    calls++;
    return route.abort();
  });
  await panel.evaluate(() =>
    chrome.storage.local.set({ settings: { apiKey: "sk-ant-test", model: "claude-opus-5-5", routerModel: "claude-sonnet-5-5", blockedSites: ["localhost"] } }),
  );
  await panel.waitForFunction(() => document.getElementById("key-banner")?.hidden === true);
  await run(panel, "what is this page about");
  await expect(panel.locator("#log li.error").last()).toContainText("turned off Navi's AI on this site");
  expect(calls).toBe(0);
});

test("commands spoken while Navi is busy run in order", async ({ panel, site }) => {
  await panel.evaluate(() => {
    const navi = (window as unknown as { navi: { run(t: string): Promise<void> } }).navi;
    void navi.run("click subscribe");
    void navi.run("click subscribe");
    void navi.run("click sign in");
  });
  await expect(site.locator("#subs")).toHaveText("2");
  await expect(site.locator("#result")).toHaveText("signed in");
});

test("fast mode: sends speed=fast, and falls back to standard speed if unavailable", async ({ panel, site, context }) => {
  const speeds: (string | undefined)[] = [];
  await context.route("https://api.anthropic.com/**", async (route) => {
    const body = route.request().postDataJSON() as { speed?: string; model: string; messages: unknown[] };
    speeds.push(body.speed);
    if (body.speed === "fast") {
      await route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "fast mode not available" } }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "msg_1", type: "message", role: "assistant", model: body.model, stop_reason: "end_turn", stop_sequence: null,
        content: [{ type: "text", text: "Standard speed works." }], usage: { input_tokens: 1, output_tokens: 1 },
      }),
    });
  });
  await panel.evaluate(() => chrome.storage.local.set({ settings: { apiKey: "sk-ant-test", model: "claude-opus-5-5", fastMode: true, routerModel: "off" } }));
  await panel.waitForFunction(() => document.getElementById("key-banner")?.hidden === true);
  await run(panel, "what is on this page");
  await expect(panel.locator("#log li.navi").last()).toContainText("Standard speed works.");
  expect(speeds).toEqual(["fast", undefined]);
  void site;
});

test("personal commands: the AI saves one, then it runs instantly without the AI", async ({ panel, site, context, baseUrl }) => {
  const aboutUrl = `${baseUrl}/about.html`;
  let calls = 0;
  await context.route("https://api.anthropic.com/**", async (route) => {
    calls++;
    const body = route.request().postDataJSON() as { model: string; messages: unknown[] };
    const first = body.messages.length === 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: `msg_${calls}`, type: "message", role: "assistant", model: body.model, stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
        stop_reason: first ? "tool_use" : "end_turn",
        content: first
          ? [{
              type: "tool_use", id: "toolu_save", name: "save_command",
              input: {
                phrases: ["open the about page", "about page"],
                steps: [{ type: "open", value: aboutUrl, new_tab: false }],
                description: "Opens the About page.",
              },
            }]
          : [{ type: "text", text: "Done. Say open the about page anytime." }],
      }),
    });
  });
  await panel.evaluate(() => chrome.storage.local.set({ settings: { apiKey: "sk-ant-test", model: "claude-opus-5-5", routerModel: "off" } }));
  await panel.waitForFunction(() => document.getElementById("key-banner")?.hidden === true);

  await site.click("h1");
  await run(panel, "add a command called open the about page that takes me to the about page");
  await expect(panel.locator("#log li.navi").last()).toContainText("Say open the about page anytime");
  expect(calls).toBe(2);

  // Now it's a personal command: runs on the fast path, no API call.
  await run(panel, "Open the about page.");
  await expect(site).toHaveURL(/about\.html/);
  expect(calls).toBe(2);
  await run(panel, "what are my commands");
  await expect(panel.locator("#log li.navi").last()).toContainText("open the about page");
});

test("personal commands: placeholders and chaining other commands", async ({ panel, site }) => {
  await panel.evaluate(() =>
    chrome.storage.sync.set({
      "cmd:find": {
        id: "find",
        phrases: ["find {thing} here"],
        steps: [{ type: "run", command: "search this site for {thing}" }],
        description: "",
        updatedAt: "",
      },
    }),
  );
  await panel.waitForTimeout(200);
  await run(panel, "find blue shoes here");
  await expect(site).toHaveURL(/search\.html\?q=blue\+shoes/);
});

type Region = { x: number; y: number; w: number; h: number };

/** Block n (keypad layout) of a region. */
function cellOf(r: Region, n: number): Region {
  const col = (n - 1) % 3;
  const row = Math.floor((n - 1) / 3);
  return { x: r.x + (col * r.w) / 3, y: r.y + (row * r.h) / 3, w: r.w / 3, h: r.h / 3 };
}

/** The keypad numbers a person would say to reach a point, one per level. */
function cellsTo(point: { x: number; y: number }, screen: Region, levels: number): number[] {
  const cells: number[] = [];
  let r = screen;
  for (let i = 0; i < levels; i++) {
    const col = Math.min(2, Math.floor(((point.x - r.x) / r.w) * 3));
    const row = Math.min(2, Math.floor(((point.y - r.y) / r.h) * 3));
    cells.push(row * 3 + col + 1);
    r = cellOf(r, row * 3 + col + 1);
  }
  return cells;
}

/** What the grid shows on the page right now, or null when it's hidden. */
async function gridState(site: Page) {
  return site.evaluate(() => {
    const root = document.querySelector("navi-grid")?.shadowRoot;
    const frame = root?.querySelector<HTMLElement>(".frame");
    if (!root || !frame) return null;
    const box = (el: HTMLElement) => ({
      x: parseFloat(el.style.left), y: parseFloat(el.style.top), w: parseFloat(el.style.width), h: parseFloat(el.style.height),
    });
    const loupe = root.querySelector<HTMLElement>(".loupe")!;
    const canvas = loupe.querySelector("canvas")!;
    // The magnified view is drawn from a picture of the page: check it isn't blank.
    const pixels = canvas.width ? canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data : new Uint8ClampedArray();
    return {
      screen: { x: 0, y: 0, w: document.documentElement.clientWidth, h: document.documentElement.clientHeight },
      region: box(frame),
      numbers: Array.from(frame.querySelectorAll(".tile b"), (b) => b.textContent).join(""),
      labels: frame.dataset.labels,
      preview: frame.dataset.preview,
      previewNumbers: Array.from(frame.querySelectorAll(".preview i"), (i) => i.textContent).join(""),
      magnified: !loupe.hidden,
      loupe: loupe.hidden ? null : { ...box(loupe), painted: pixels.some((v, i) => i % 4 === 3 && v > 0) },
      hint: root.querySelector(".hint")?.textContent ?? "",
    };
  });
}

function expectRegion(actual: Region | undefined, expected: Region) {
  for (const k of ["x", "y", "w", "h"] as const) expect(actual?.[k]).toBeCloseTo(expected[k], 1);
}

test("mouse grid: nested preview, zooming by one or several numbers, back and hide", async ({ panel, site }) => {
  await run(panel, "show grid");
  let grid = (await gridState(site))!;
  const screen = grid.screen;
  expectRegion(grid.region, screen);
  expect(grid.numbers).toBe("123456789");
  // Each block previews the next level: 8 small numbers around its big one.
  expect(grid.preview).toBe("labels");
  expect(grid.previewNumbers).toBe("12346789".repeat(9));
  expect(grid.hint).toContain("click");

  // One number zooms one level; "back" goes up again.
  await run(panel, "5");
  grid = (await gridState(site))!;
  expectRegion(grid.region, cellOf(screen, 5));
  expect(grid.hint).toContain("5");
  await run(panel, "back");
  expectRegion((await gridState(site))?.region, screen);

  // Several numbers at once, spoken apart or merged by the speech engine.
  await run(panel, "5 3");
  expectRegion((await gridState(site))?.region, cellOf(cellOf(screen, 5), 3));
  await run(panel, "show grid");
  expectRegion((await gridState(site))?.region, screen);
  await run(panel, "53");
  grid = (await gridState(site))!;
  expectRegion(grid.region, cellOf(cellOf(screen, 5), 3));
  expect(grid.hint).toContain("5 › 3");
  // The page's tab isn't on screen here, so there's no picture to magnify: numbers stay on the spot.
  expect(grid.magnified).toBe(false);
  expect(grid.labels).toBe("on");
  await run(panel, "seven two"); // one level left: the extra number is ignored
  expectRegion((await gridState(site))?.region, [5, 3, 7].reduce(cellOf, screen));

  // While the grid is up, "go back" zooms out instead of leaving the page.
  await run(panel, "zoom out");
  await run(panel, "go back");
  expectRegion((await gridState(site))?.region, cellOf(screen, 5));
  await expect(site).toHaveURL(/index\.html/);
  await run(panel, "hide grid");
  expect(await gridState(site)).toBeNull();

  // Number tags and the grid take turns, since both answer to numbers.
  const badges = () => site.evaluate(() => document.querySelector("navi-overlay")?.shadowRoot?.querySelectorAll(".badge").length ?? 0);
  await run(panel, "show numbers");
  await run(panel, "grid on");
  expect(await gridState(site)).not.toBeNull();
  expect(await badges()).toBe(0);
  await run(panel, "show numbers");
  expect(await gridState(site)).toBeNull();
  expect(await badges()).toBeGreaterThan(0);
  await run(panel, "hide numbers");

  // The side panel's Grid button toggles it too.
  await panel.locator("#toggle-grid").click();
  await expect.poll(() => gridState(site)).not.toBeNull();
  await expect(panel.locator("#toggle-grid")).toHaveText("Hide grid");
  await panel.locator("#toggle-grid").click();
  await expect.poll(() => gridState(site)).toBeNull();
  await expect(panel.locator("#toggle-grid")).toHaveText("Grid");

  // Zooming animates, unless the user asked for reduced motion.
  const motion = () =>
    site.evaluate(() => {
      const style = getComputedStyle(document.querySelector("navi-grid")!.shadowRoot!.querySelector(".frame")!);
      return { transition: style.transitionDuration, animation: style.animationName };
    });
  await run(panel, "show grid");
  expect((await motion()).transition).toContain("0.24s");
  await run(panel, "hide grid");
  await site.emulateMedia({ reducedMotion: "reduce" });
  await run(panel, "show grid");
  expect(await motion()).toEqual({ transition: "0s", animation: "none" });
  await run(panel, "hide grid");
});

test("mouse grid: magnifies small blocks and clicks an exact spot", async ({ panel, site }) => {
  // Chrome only takes the grid's picture of the tab on screen (the real side panel isn't a tab).
  await site.bringToFront();
  const centers = await site.evaluate(() =>
    Object.fromEntries(
      ["signin", "subscribe", "card"].map((id) => {
        const r = document.getElementById(id)!.getBoundingClientRect();
        return [id, { x: r.left + r.width / 2, y: r.top + r.height / 2 }];
      }),
    ),
  );
  await run(panel, "show grid");
  const screen = (await gridState(site))!.screen;

  // Three levels in, the blocks are too small to read, so they're shown magnified beside the spot.
  const subscribe = cellsTo(centers.subscribe, screen, 4);
  await run(panel, subscribe.slice(0, 3).join(" "));
  const grid = (await gridState(site))!;
  expectRegion(grid.region, subscribe.slice(0, 3).reduce(cellOf, screen));
  expect(grid.magnified).toBe(true);
  expect(grid.labels).toBe("off");
  expect(grid.loupe!.painted).toBe(true);
  expect(grid.loupe!.w).toBeGreaterThan(grid.region.w * 3);
  expect(grid.loupe!.x).toBeGreaterThanOrEqual(0);
  expect(grid.loupe!.x + grid.loupe!.w).toBeLessThanOrEqual(screen.w);
  // "click 7" clicks the middle of block 7 of the current region: the exact button, not its neighbor.
  await run(panel, `click ${subscribe[3]}`);
  await expect(site.locator("#subs")).toHaveText("1");
  await expect(site.locator("#result")).toHaveText("idle");
  expect(await gridState(site)).toBeNull();
  await expect(panel.locator("#log li.navi").last()).toContainText("Clicked Subscribe");

  // Zoom and click in one go.
  await run(panel, "show grid");
  await run(panel, `click ${cellsTo(centers.signin, screen, 4).join(" ")}`);
  await expect(site.locator("#result")).toHaveText("signed in");

  // Double and right clicks.
  await site.evaluate(() => {
    const result = document.getElementById("result")!;
    const card = document.getElementById("card")!;
    card.addEventListener("dblclick", () => (result.textContent = "card double-clicked"));
    card.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      result.textContent = "card menu";
    });
  });
  const card = cellsTo(centers.card, screen, 3);
  await run(panel, "show grid");
  await run(panel, `double click ${card.join(" ")}`);
  await expect(site.locator("#result")).toHaveText("card double-clicked");
  await run(panel, "show grid");
  await run(panel, card.join(" "));
  await run(panel, "right click");
  await expect(site.locator("#result")).toHaveText("card menu");
  expect(await gridState(site)).toBeNull();
});

test("AI vision: looks at a tagged screenshot, then clicks a spot by coordinates", async ({ panel, site, context }) => {
  const bodies: { messages: { role: string; content: unknown }[] }[] = [];
  const subscribe = await site.evaluate(() => {
    const r = document.getElementById("subscribe")!.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), dpr: devicePixelRatio };
  });
  await context.route("https://api.anthropic.com/**", async (route) => {
    const body = route.request().postDataJSON() as { model: string; messages: { role: string; content: unknown }[] };
    bodies.push(body);
    const turn = bodies.length;
    const content =
      turn === 1
        ? [{ type: "tool_use", id: "t1", name: "look_at_screen", input: {} }]
        : turn === 2
          ? [{ type: "tool_use", id: "t2", name: "click_at", input: { x: subscribe.x * subscribe.dpr, y: subscribe.y * subscribe.dpr } }]
          : [{ type: "text", text: "Clicked the button you meant." }];
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: `m${turn}`, type: "message", role: "assistant", model: body.model, stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 }, stop_reason: turn < 3 ? "tool_use" : "end_turn", content,
      }),
    });
  });
  await panel.evaluate(() => chrome.storage.local.set({ settings: { apiKey: "sk-ant-test", model: "claude-opus-5-5", routerModel: "claude-sonnet-5-5" } }));
  await panel.waitForFunction(() => document.getElementById("key-banner")?.hidden === true);
  await run(panel, "click the second button in that row");
  await expect(site.locator("#subs")).toHaveText("1");
  await expect(panel.locator("#log li.navi").last()).toContainText("Clicked the button you meant.");
  // The screenshot went to the model as an image, with the element list alongside.
  const toolResult = JSON.stringify(bodies[1].messages[bodies[1].messages.length - 1].content);
  expect(toolResult).toContain('"type":"image"');
  expect(toolResult).toContain("image/jpeg");
  expect(toolResult).toContain('button \\"Subscribe\\"');
  // Tags were only shown for the picture.
  expect(await site.evaluate(() => document.querySelector("navi-overlay")?.shadowRoot?.querySelectorAll(".badge").length ?? 0)).toBe(0);
});

function routerOrAgent(route: (body: Record<string, unknown>) => unknown) {
  return async (r: import("@playwright/test").Route) => {
    const body = r.request().postDataJSON() as Record<string, unknown>;
    const content = route(body);
    await r.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "m", type: "message", role: "assistant", model: body.model, stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
        stop_reason: Array.isArray(content) && (content[0] as { type: string }).type === "tool_use" ? "tool_use" : "end_turn",
        content,
      }),
    });
  };
}

test("router: a loosely worded command is understood by the quick model and runs on the fast path", async ({ panel, site, context }) => {
  const models: string[] = [];
  const bodies: Record<string, unknown>[] = [];
  await context.route(
    "https://api.anthropic.com/**",
    routerOrAgent((body) => {
      models.push(String(body.model));
      bodies.push(body);
      // Only the router is expected here; it answers with structured JSON.
      return [{ type: "text", text: JSON.stringify({ route: "command", command: "click subscribe" }) }];
    }),
  );
  await panel.evaluate(() => chrome.storage.local.set({ settings: { apiKey: "sk-ant-test", model: "claude-opus-5-5", routerModel: "claude-sonnet-5-5" } }));
  await panel.waitForFunction(() => document.getElementById("key-banner")?.hidden === true);
  await run(panel, "yo can you smash that sub thingy");
  // The router runs Sonnet 5.5 with thinking off (and its unchanging instructions cached) so it stays fast.
  expect(bodies[0].thinking).toEqual({ type: "between_tools" });
  expect(bodies[0].output_config).toMatchObject({ effort: "low" });
  expect(bodies[0].cache_control).toEqual({ type: "ephemeral" });
  await expect(site.locator("#subs")).toHaveText("1");
  expect(models).toEqual(["claude-sonnet-5-5"]);
  await expect(panel.locator("#log li.step").filter({ hasText: "Understood as “click subscribe”" })).toHaveCount(1);
});

test("router: noise is ignored quietly and never reaches the main model", async ({ panel, context }) => {
  const models: string[] = [];
  await context.route(
    "https://api.anthropic.com/**",
    routerOrAgent((body) => {
      models.push(String(body.model));
      return [{ type: "text", text: JSON.stringify({ route: "ignore", command: "" }) }];
    }),
  );
  await panel.evaluate(() => chrome.storage.local.set({ settings: { apiKey: "sk-ant-test", model: "claude-opus-5-5", routerModel: "claude-sonnet-5-5" } }));
  await panel.waitForFunction(() => document.getElementById("key-banner")?.hidden === true);
  const final = (text: string) =>
    panel.evaluate((t) => (window as unknown as { navi: { handleFinal(t: string): void } }).navi.handleFinal(t), text);
  await final("hey navi");
  // Keyboard clatter and someone talking nearby: no hardcoded list, the quick model judges both,
  // and the main model is never called.
  await final("tiktok tiktok tiktok");
  await expect(panel.locator("#log li.step").filter({ hasText: "Ignored “tiktok tiktok tiktok”" })).toHaveCount(1);
  await final("and then she told me the car was still in the shop");
  await expect(panel.locator("#log li.step").filter({ hasText: "Ignored “and then she told me" })).toHaveCount(1);
  expect(models).toEqual(["claude-sonnet-5-5", "claude-sonnet-5-5"]);
  // Nothing was spoken or shown as an error.
  await expect(panel.locator("#log li.error")).toHaveCount(0);
});

/** A fake OpenAI Responses API reply. */
function openaiReply(output: unknown[], usage = { input_tokens: 2000, output_tokens: 40, input_tokens_details: { cached_tokens: 1500 } }) {
  return { status: 200, contentType: "application/json", body: JSON.stringify({ id: "resp_test", status: "completed", output, usage }) };
}

test("the AI scrolls a side panel (a column of filters) by naming an element in it, not the page", async ({ panel, site, context, baseUrl }) => {
  const bodies: { input: { type?: string; output?: string; content?: unknown; role?: string }[] }[] = [];
  const call = (name: string, args: object) => ({ type: "function_call", id: `fc_${name}`, call_id: `call_${name}`, name, arguments: JSON.stringify(args) });
  await context.route("https://api.openai.com/v1/responses", (route) => {
    const body = route.request().postDataJSON();
    bodies.push(body);
    const outputs = body.input.filter((x: { type?: string }) => x.type === "function_call_output").map((x: { output: string }) => x.output);
    if (!outputs.length) return route.fulfill(openaiReply([call("look_at_page", {})]));
    if (outputs.length === 1) {
      const id = Number(outputs[0].match(/\[(\d+)\] checkbox "Make: Acura"/)?.[1]);
      return route.fulfill(openaiReply([call("scroll", { direction: "down", amount: "page", element_id: id })]));
    }
    return route.fulfill(openaiReply([{ type: "message", role: "assistant", content: [{ type: "output_text", text: "Scrolled the filters." }] }]));
  });
  await site.goto(`${baseUrl}/filters.html`);
  await panel.evaluate(() => chrome.storage.local.set({ settings: { openaiKey: "sk-openai-test", model: "gpt-6-luna", effort: "none", routerModel: "off" } }));
  await panel.waitForFunction(() => document.getElementById("key-banner")?.hidden === true);
  await type(panel, "find the toyota filter in the sidebar");
  await expect.poll(() => site.evaluate(() => document.getElementById("filters")!.scrollTop)).toBeGreaterThan(100);
  expect(await site.evaluate(() => scrollY)).toBe(0);
  const results = bodies[2].input.filter((i) => i.type === "function_call_output");
  expect(results.at(-1)!.output).toContain("scrolled down in the panel around it");
});

test("GPT agent: OpenAI picks the element, extension clicks it, and the cost is logged", async ({ panel, site, context }) => {
  const bodies: Record<string, unknown>[] = [];
  const auth: string[] = [];
  await context.route("https://api.openai.com/v1/responses", async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    bodies.push(body);
    auth.push(route.request().headers()["authorization"] ?? "");
    const input = body.input as { role?: string; content?: unknown; type?: string }[];
    if (bodies.length === 1) {
      const text = String(input[0].content);
      const id = Number(text.match(/\[(\d+)\] button "Subscribe"/)?.[1]);
      return route.fulfill(
        openaiReply([
          { type: "function_call", id: "fc_1", call_id: "call_1", name: "click", arguments: JSON.stringify({ element_id: id }) },
        ]),
      );
    }
    return route.fulfill(
      openaiReply([{ type: "message", role: "assistant", content: [{ type: "output_text", text: "Subscribed." }] }]),
    );
  });
  await panel.evaluate(() =>
    chrome.storage.local.set({ settings: { openaiKey: "sk-openai-test", model: "gpt-6-luna", effort: "none", routerModel: "off" } }),
  );
  await panel.waitForFunction(() => document.getElementById("key-banner")?.hidden === true);

  await run(panel, "hit the subscribe thing for me");
  await expect(site.locator("#subs")).toHaveText("1");
  await expect(panel.locator("#log li.navi").last()).toContainText("Subscribed.");

  expect(bodies).toHaveLength(2);
  expect(auth[0]).toBe("Bearer sk-openai-test");
  const [first, second] = bodies;
  expect(first.model).toBe("gpt-6-luna");
  expect(first.store).toBe(false);
  expect(first.reasoning).toEqual({ effort: "none" });
  // No reasoning to carry over at effort none.
  expect(first.include).toBeUndefined();
  expect((first.tools as { type: string; name: string; strict: boolean }[]).find((t) => t.name === "click")).toMatchObject({
    type: "function",
    strict: true,
  });
  expect(String(first.instructions)).toContain("You are Navi");
  // The second call carries the model's call, the tool result, and a fresh observation.
  const secondInput = second.input as { type?: string; call_id?: string; output?: string }[];
  expect(secondInput.some((i) => i.type === "function_call" && i.call_id === "call_1")).toBe(true);
  const output = secondInput.find((i) => i.type === "function_call_output");
  expect(output?.call_id).toBe("call_1");
  expect(output?.output).toContain("New observation");

  // Two calls x (500 uncached + 1500 cached input, 40 output) at Luna's prices, shown and logged.
  const expected = 2 * (500 * 0.1 + 1500 * 0.01 + 40 * 0.5) / 1e6;
  const cost = await panel.evaluate(
    () => (window as unknown as { navi: { metrics: { costUsd?: number }[] } }).navi.metrics.at(-1)?.costUsd,
  );
  expect(cost).toBeCloseTo(expected, 10);
  await expect(panel.locator("#log li.navi").last()).toContainText("<$0.01");
});

test.describe("tutorial", () => {
  const card = (panel: Page) => panel.locator("#tutorial");
  const lastNavi = (panel: Page) => panel.locator("#log li.navi .text").last();
  const said = (panel: Page) => panel.evaluate(() => (window as unknown as { navi: { lastSaid: Promise<string> } }).navi.lastSaid);
  async function expectStep(panel: Page, n: number, total: number, title: string) {
    await expect(panel.locator("#tutorial-progress")).toHaveText(`Tutorial ${n} of ${total} ·`);
    await expect(panel.locator("#tutorial-title")).toHaveText(title);
  }

  test("a spoken tour: each step moves on when the user has done it by voice, start to finish", async ({ panel, context, site }) => {
    await run(panel, "start the tutorial");
    await expect(card(panel)).toBeVisible();
    await expectStep(panel, 1, 8, "Welcome");
    await expect(lastNavi(panel)).toContainText("Hi, I'm Navi. This tour takes about two minutes.");
    await expect(panel.locator("#tutorial-yes")).toBeVisible();

    // The answer sets how much Navi says.
    await run(panel, "no");
    await expectStep(panel, 2, 8, "Wake me up");
    await expect(lastNavi(panel)).toHaveText(
      "Okay. I'll play a short sound when something works, and talk when there's something to tell you. I'm going to sleep now. To wake me, say my name and the command together. Try: Hey Navi, open Wikipedia.",
    );
    expect((await settingsOf(panel)).feedback).toBe("minimal");
    await expect(panel.locator("#tutorial-yes")).toBeHidden();

    // Something else doesn't count.
    await run(panel, "scroll down");
    await expectStep(panel, 2, 8, "Wake me up");
    await run(panel, "open wikipedia");
    await expectStep(panel, 3, 8, "Scroll");
    // Tests can't serve tabs the extension opens, so Wikipedia shows an error page; the tour goes on with the test page.
    await expect.poll(() => context.pages().some((p) => /wikipedia|chrome-error/.test(p.url()))).toBe(true);
    for (const p of context.pages()) if (/wikipedia|chrome-error/.test(p.url())) await p.close();
    await site.bringToFront();
    await expect(lastNavi(panel)).toHaveText(/^That's how you wake me\. “Hey Navigator” works too\..* Now say: scroll down\.$/);
    await run(panel, "scroll down");
    await expectStep(panel, 4, 8, "Click");
    await run(panel, "show numbers");
    await expectStep(panel, 4, 8, "Click");
    await run(panel, "hide numbers");
    await expectStep(panel, 5, 8, "Search");
    await run(panel, "search for octopus");
    await expectStep(panel, 6, 8, "Go back");
    await run(panel, "go back");
    await expectStep(panel, 7, 8, "Interrupt me");
    await run(panel, "read this page");
    await expectStep(panel, 7, 8, "Interrupt me");
    await run(panel, "stop");
    await expectStep(panel, 8, 8, "Sleep and settings");
    await expect(lastNavi(panel)).toHaveText(/^Good\. Last thing\./);
    // "Repeat" says the step again.
    await run(panel, "repeat");
    await expect(panel.locator("#log li.navi .text").filter({ hasText: "Last thing." })).toHaveCount(2);
    await run(panel, "go to sleep");
    await expect(card(panel)).toBeHidden();
    await expect(lastNavi(panel)).toHaveText("That's the tour. Have fun.");
    await expect.poll(() => said(panel)).toBe("That's the tour. Have fun.");
    expect((await panel.evaluate(() => chrome.storage.local.get("tutorialOffered"))).tutorialOffered).toBe(true);
  });

  test("for someone who can't see the screen: spoken feedback, describing the screen, and the panel's buttons", async ({ panel }) => {
    await run(panel, "start the tutorial");
    await panel.locator("#tutorial-yes").click();
    await expectStep(panel, 2, 8, "Wake me up");
    await expect(lastNavi(panel)).toContainText("Okay, I'll say out loud what I do.");
    await expect.poll(async () => (await settingsOf(panel)).feedback).toBe("spoken");
    await run(panel, "next");
    await expectStep(panel, 3, 8, "Scroll");
    await panel.locator("#tutorial-next").click();
    await expectStep(panel, 4, 8, "Hear what's on screen");
    // Without an AI, Navi says what it can tell from the page.
    await run(panel, "describe the screen");
    await expectStep(panel, 5, 8, "Search");
    await expect(panel.locator("#log li.navi .text").filter({ hasText: "You're on Navi Test Page, at localhost. On screen there are" })).toHaveCount(1);
    await run(panel, "end tutorial");
    await expect(card(panel)).toBeHidden();
    await expect(lastNavi(panel)).toHaveText("Okay, the tutorial is over. Say “start the tutorial” any time to take it again.");
    // It can be taken again, and ended from the panel.
    await run(panel, "take the tour");
    await expectStep(panel, 1, 8, "Welcome");
    await panel.locator("#tutorial-end").click();
    await expect(card(panel)).toBeHidden();
  });

  test("with an AI, the tour includes asking it something", async ({ panel, context }) => {
    await context.route("https://api.openai.com/v1/responses", (route) =>
      route.fulfill(openaiReply([{ type: "message", role: "assistant", content: [{ type: "output_text", text: "It's a test page." }] }])),
    );
    await panel.evaluate(() => chrome.storage.local.set({ settings: { openaiKey: "sk-openai-test", model: "gpt-6-luna", effort: "none", routerModel: "off" } }));
    await panel.waitForFunction(() => document.getElementById("key-banner")?.hidden === true);
    await run(panel, "start the tutorial");
    await expectStep(panel, 1, 9, "Welcome");
    for (const say of ["no", "next", "next", "next", "next", "next", "next"]) await run(panel, say);
    await expectStep(panel, 8, 9, "Ask anything");
    await run(panel, "what is this page about");
    await expectStep(panel, 9, 9, "Sleep and settings");
    // The answer comes first, then the next step.
    await expect.poll(() => said(panel), { timeout: 20_000 }).toMatch(/^Last thing\./);
    const texts = await panel.locator("#log li.navi .text").allTextContents();
    expect(texts.indexOf("It's a test page.")).toBeLessThan(texts.findIndex((t) => t.startsWith("Last thing.")));
  });
});

test("describe the screen: the AI looks and describes it for someone who can't see it", async ({ panel, context }) => {
  const bodies: { input: { role?: string; content?: unknown }[] }[] = [];
  await context.route("https://api.openai.com/v1/responses", (route) => {
    bodies.push(route.request().postDataJSON());
    return route.fulfill(
      openaiReply([{ type: "message", role: "assistant", content: [{ type: "output_text", text: "A test page with a Subscribe button and a few links." }] }]),
    );
  });
  await panel.evaluate(() => chrome.storage.local.set({ settings: { openaiKey: "sk-openai-test", model: "gpt-6-luna", effort: "none", routerModel: "off" } }));
  await panel.waitForFunction(() => document.getElementById("key-banner")?.hidden === true);
  await run(panel, "what's on the screen");
  await expect(panel.locator("#log li.navi .text").last()).toHaveText("A test page with a Subscribe button and a few links.");
  expect(String(bodies[0].input[0].content)).toContain(`Command: "Describe what's on my screen for someone who can't see it.`);
  await expect.poll(() => panel.evaluate(() => (window as unknown as { navi: { lastSaid: Promise<string> } }).navi.lastSaid)).toBe(
    "A test page with a Subscribe button and a few links.",
  );
});

test("open settings, by voice", async ({ panel, context }) => {
  const opened = context.waitForEvent("page");
  await run(panel, "open settings");
  expect((await opened).url()).toContain("/options.html");
  await expect(panel.locator("#log li.navi .text").last()).toHaveText("Opened Navi's settings");
});

test.describe("after setup", () => {
  test.use({ fakeMic: true, fakeSpeech: "available" });
  test("once Navi hears for the first time, it offers the spoken tour, once", async ({ panel }) => {
    const offer = panel.locator("#log li.navi .text").filter({ hasText: "For a two-minute tour" });
    await panel.evaluate(() => (window as unknown as { navi: { startListening(): Promise<void> } }).navi.startListening());
    await expect(panel.locator("#voice")).toHaveAttribute("data-state", "sleeping");
    // Not before setup has allowed the mic.
    await expect(offer).toHaveCount(0);
    await panel.evaluate(() => chrome.runtime.sendMessage({ type: "navi:mic-granted" }));
    await expect(offer).toHaveText("Hi, I'm Navi, and I'm listening. For a two-minute tour of what I can do, say: Hey Navi, start the tutorial.");
    await panel.evaluate(() => chrome.runtime.sendMessage({ type: "navi:mic-granted" }));
    await panel.waitForTimeout(1500);
    await expect(offer).toHaveCount(1);
  });
});

test.describe("helpers", () => {
  type Body = { model: string; instructions: string; input: { role?: string; content?: unknown; type?: string; output?: string }[]; tools?: { name: string }[]; reasoning?: { effort: string } };
  const call = (name: string, args: object, id = name) => ({ type: "function_call", id: `fc_${id}`, call_id: `call_${id}`, name, arguments: JSON.stringify(args) });
  const message = (text: string) => ({ type: "message", role: "assistant", content: [{ type: "output_text", text }] });
  const isHelper = (b: Body) => b.instructions.startsWith("You are a Navi helper");
  const outputs = (b: Body) => b.input.filter((i) => i.type === "function_call_output").map((i) => String(i.output));
  const notes = (panel: Page) => panel.locator("#log > li.solo.info .text");
  const said = (panel: Page) => panel.evaluate(() => (window as unknown as { navi: { lastSaid: Promise<string> } }).navi.lastSaid);
  async function usePro(panel: Page) {
    await panel.evaluate(() =>
      chrome.storage.local.set({ settings: { openaiKey: "sk-openai-test", model: "gpt-6-luna", effort: "none", routerModel: "off" } }),
    );
    await panel.waitForFunction(() => document.getElementById("key-banner")?.hidden === true);
  }

  const lastUser = (b: Body) => String(b.input.filter((i) => i.role === "user").at(-1)?.content ?? "");
  const isReport = (b: Body) => b.input.at(-1)?.role === "user" && lastUser(b).startsWith("Helper report");

  test("the AI hands a side task to a helper: its own window, the helper model, the user's page untouched, the report comes back to the AI", async ({
    panel,
    site,
    context,
    baseUrl,
  }) => {
    const main: Body[] = [];
    const helper: Body[] = [];
    await context.route("https://api.openai.com/v1/responses", async (route) => {
      const body = route.request().postDataJSON() as Body;
      if (isHelper(body)) {
        helper.push(body);
        if (helper.length === 1) {
          const id = Number(String(body.input[0].content).match(/\[(\d+)\] button "Subscribe"/)?.[1]);
          return route.fulfill(openaiReply([call("click", { element_id: id })]));
        }
        return route.fulfill(openaiReply([message("Subscribed on the helper's copy of the page.")]));
      }
      main.push(body);
      if (isReport(body)) return route.fulfill(openaiReply([message("Your helper subscribed on the test page.")]));
      if (body.input.at(-1)?.type === "function_call_output") return route.fulfill(openaiReply([message("A helper is on it.")]));
      return route.fulfill(
        openaiReply([call("start_helper", { task: "Click Subscribe on the test page.", url: `${baseUrl}/index.html?helper`, keep_open: true })]),
      );
    });
    await usePro(panel);
    await type(panel, "get a helper to subscribe on the test page");

    // The helper ran on the helper model (GPT-6.1 Sol, low), with page tools only, in its own window.
    await expect.poll(() => helper.length).toBe(2);
    expect(helper[0]).toMatchObject({ model: "gpt-6.1-sol", reasoning: { effort: "low" } });
    const tools = helper[0].tools!.map((t) => t.name);
    expect(tools).toContain("click");
    for (const missing of ["start_helper", "check_helpers", "stop_helper", "close_tabs", "say", "save_command"]) expect(tools).not.toContain(missing);
    const first = String(helper[0].input[0].content);
    expect(first).toContain('Task from Navi: "Click Subscribe on the test page."');
    expect(first).toContain("Time limit: 15 minutes.");
    expect(first).toContain("index.html?helper");
    expect(main[0].tools!.map((t) => t.name)).toEqual(expect.arrayContaining(["start_helper", "check_helpers", "stop_helper"]));
    expect(outputs(main[1])[0]).toBe("Helper 1 started in its own window. Its report comes to you when it's done.");

    const helperPage = context.pages().find((p) => p.url().endsWith("?helper"))!;
    await expect(helperPage.locator("#subs")).toHaveText("1");
    await expect(site.locator("#subs")).toHaveText("0");

    // When it finished, the main AI got its report (in the same conversation) and told the user.
    await expect(panel.locator("#log li.navi .text").last()).toHaveText("Your helper subscribed on the test page.");
    const report = main.find(isReport)!;
    expect(lastUser(report)).toContain(
      "Helper report (from your helpers, not the user):\nHelper 1 (“Click Subscribe on the test page.”) finished: Subscribed on the helper's copy of the page.\n\nOpen tabs:",
    );
    expect(report.input.some((i) => i.type === "function_call" || String(i.content).includes("get a helper to subscribe"))).toBe(true);
    await expect.poll(() => said(panel)).toBe("Your helper subscribed on the test page.");
    await expect(notes(panel).filter({ hasText: "Helper 1" })).toContainText("finished: Subscribed on the helper's copy");
    const log = await panel.evaluate(async () => (await chrome.storage.local.get("metrics")).metrics as { command: string; path: string; model: string }[]);
    expect(log.find((m) => m.command.startsWith("(helper)"))).toMatchObject({ path: "background", model: "gpt-6.1-sol" });
    await expect(panel.locator("#helpers")).toBeHidden();
  });

  test("the supervisor nudges a helper going in circles, stops it if it keeps on, and stops one at its time limit", async ({ panel, context, baseUrl }) => {
    const helperBodies: Record<string, Body[]> = {};
    const reports: string[] = [];
    await context.route("https://api.openai.com/v1/responses", async (route) => {
      const body = route.request().postDataJSON() as Body;
      if (isHelper(body)) {
        const task = /Task from Navi: "(.*)"/.exec(String(body.input[0].content))?.[1] ?? "";
        (helperBodies[task] ??= []).push(body);
        const n = helperBodies[task].length;
        // Scrolling up at the top of the page changes nothing.
        if (task === "Stuck task") return route.fulfill(openaiReply([call("scroll", { direction: "up", amount: "page" }, `s${n}`)]));
        // The slow one never hears back: its time limit ends it.
        return new Promise<void>(() => {});
      }
      if (isReport(body)) {
        reports.push(lastUser(body));
        return route.fulfill(openaiReply([message("A helper stopped.")]));
      }
      if (body.input.at(-1)?.type === "function_call_output") return route.fulfill(openaiReply([message("Started.")]));
      const asked = /Typed message: "(.*)"/.exec(lastUser(body))?.[1] ?? "";
      const task = asked.includes("stuck") ? "Stuck task" : "Slow task";
      return route.fulfill(openaiReply([call("start_helper", { task, url: `${baseUrl}/index.html?${task.split(" ")[0]}`, keep_open: false })]));
    });
    await panel.evaluate(() =>
      chrome.storage.local.set({ settings: { openaiKey: "sk-openai-test", model: "gpt-6-luna", effort: "none", routerModel: "off" } }),
    );
    await panel.waitForFunction(() => document.getElementById("key-banner")?.hidden === true);

    await type(panel, "start the stuck helper");
    await expect(notes(panel).filter({ hasText: "Stuck task" })).toHaveText(
      "Helper 1 (“Stuck task”) was stopped: it was stuck doing the same thing (scroll) with nothing changing. Its last action: Scrolling up.",
      { timeout: 15_000 },
    );
    const stuck = helperBodies["Stuck task"];
    expect(stuck).toHaveLength(8);
    // From the third time on, it was told it's going in circles.
    expect(outputs(stuck[2]).at(-1)).not.toContain("Note from Navi");
    expect(outputs(stuck[3]).at(-1)).toContain("Note from Navi: you've done this 3 times in a row and the page hasn't changed.");
    await expect.poll(() => reports[0]).toContain("Helper 1 (“Stuck task”) was stopped: it was stuck");
    await expect.poll(() => context.pages().some((p) => p.url().endsWith("?Stuck"))).toBe(false);

    // A 3-second limit for the slow one.
    await panel.evaluate(async () => {
      const { settings } = await chrome.storage.local.get("settings");
      await chrome.storage.local.set({ settings: { ...(settings as object), helperMinutes: 0.05 } });
    });
    await expect.poll(async () => (await settingsOf(panel)).helperMinutes).toBe(0.05);
    await type(panel, "start the slow helper");
    await expect(notes(panel).filter({ hasText: "Slow task" })).toHaveText("Helper 2 (“Slow task”) was stopped: it reached its time limit (0.05 minutes).");
    await expect.poll(() => reports[1]).toContain("Helper 2 (“Slow task”) was stopped: it reached its time limit");
    // Each report has only what the AI hasn't heard yet.
    expect(reports[1]).not.toContain("Stuck task");
    expect(reports).toHaveLength(2);
    await expect.poll(() => context.pages().some((p) => p.url().endsWith("?Slow"))).toBe(false);
  });

  test("several at once; the AI and the user check on them and stop them; the panel lists them with stop buttons", async ({ panel, context, baseUrl }) => {
    let release = () => {};
    const hold = new Promise<void>((resolve) => (release = resolve));
    const mainBodies: Body[] = [];
    await context.route("https://api.openai.com/v1/responses", async (route) => {
      const body = route.request().postDataJSON() as Body;
      if (isHelper(body)) {
        await hold;
        return route.fulfill(openaiReply([message("Done.")])).catch(() => undefined);
      }
      mainBodies.push(body);
      // Helpers stopped along the way report in; the AI waits for the rest.
      if (isReport(body)) return route.fulfill(openaiReply([message("[quiet]")]));
      const last = body.input.at(-1);
      if (last?.type === "function_call_output") return route.fulfill(openaiReply([message(`OK: ${String(last.output).split("\n")[0]}`)]));
      const asked = /Typed message: "(.*)"/.exec(lastUser(body))?.[1] ?? "";
      if (asked === "what are my helpers up to") return route.fulfill(openaiReply([call("check_helpers", {})]));
      if (asked === "the fourth helper isn't needed anymore") return route.fulfill(openaiReply([call("stop_helper", { helper_id: 4 })]));
      return route.fulfill(
        openaiReply([1, 2, 3, 4, 5, 6].map((n) => call("start_helper", { task: `Task ${n}`, url: `${baseUrl}/about.html?${n}`, keep_open: false }, `h${n}`))),
      );
    });
    await usePro(panel);
    await type(panel, "start six helpers");
    const started = outputs(mainBodies[1]);
    expect(started.slice(0, 5).every((o) => o.startsWith("Helper"))).toBe(true);
    expect(started[5]).toContain("5 helpers are already running");

    const rows = panel.locator("#helper-list li");
    await expect(rows).toHaveCount(5);
    await expect(rows.first().locator(".helper-task")).toHaveText("Task 1");
    await expect(rows.first().locator(".helper-meta")).toHaveText("0 min · $0");
    await expect(panel.locator("#helpers-stop-all")).toBeVisible();

    // The user asks by voice; the AI checks with its tool.
    await run(panel, "how are the helpers doing");
    await expect(panel.locator("#log > li.solo.navi .text").last()).toContainText("Helper 1 (“Task 1”): working for");
    await type(panel, "what are my helpers up to");
    await expect(panel.locator("#log li.navi .text").last()).toHaveText(/^OK: Helper 1 \(“Task 1”\): working for \d+ seconds?, now: Thinking…$/);

    // One from the panel, one by voice, one by the AI, then the rest.
    await panel.getByRole("button", { name: "Stop helper: Task 2" }).click();
    await expect(rows).toHaveCount(4);
    await expect(notes(panel).filter({ hasText: "Task 2" })).toContainText("Helper 2 (“Task 2”) was stopped: you stopped it.");
    await run(panel, "stop helper 3");
    await expect(rows).toHaveCount(3);
    await expect(panel.locator("#log > li.solo.navi .text").last()).toHaveText("Stopped helper 3.");
    await type(panel, "the fourth helper isn't needed anymore");
    await expect(rows).toHaveCount(2);
    await expect(notes(panel).filter({ hasText: "Task 4" })).toContainText("Helper 4 (“Task 4”) was stopped: Navi stopped it.");
    await expect(panel.locator("#log li.navi .text").last()).toHaveText("OK: Stopped helper 4.");
    await run(panel, "stop helpers");
    await expect(rows).toHaveCount(0);
    await expect(panel.locator("#helpers")).toBeHidden();
    await expect(panel.locator("#log > li.solo.navi .text").last()).toHaveText("Stopped 2 helpers.");
    await expect.poll(() => context.pages().filter((p) => p.url().includes("about.html?")).length).toBe(0);
    // Stopped helpers were reported to the AI, which kept quiet.
    await expect.poll(() => mainBodies.filter(isReport).length).toBeGreaterThan(0);
    await expect(panel.locator("#log li.step").filter({ hasText: "Noted the helpers' report" }).first()).toBeAttached();
    release();
  });

  test("Settings: the helper model and reasoning, per mode", async ({ panel, context }) => {
    const options = await context.newPage();
    await options.goto(panel.url().replace("sidepanel.html", "options.html"));
    await expect(options.locator("#subagentModel")).toHaveValue("gpt-6.1-sol");
    await expect(options.locator("#subagentEffort")).toHaveValue("low");
    await options.locator("#aiMode").selectOption("pro");
    await options.locator("#subagentModel").selectOption("claude-sonnet-5-5");
    await options.locator("#subagentEffort").selectOption("medium");
    await expect(options.locator("#helperMinutes")).toHaveValue("15");
    await options.locator("#helperMinutes").fill("30");
    await options.locator("button[type=submit]").click();
    // Saved for Pro (Navi runs Free until a key is added).
    const stored = () => panel.evaluate(async () => (await chrome.storage.local.get("settings")).settings as Partial<Settings>);
    const pro = async () => normalizeSettings(await stored(), "pro");
    await expect.poll(async () => (await pro()).subagentModel).toBe("claude-sonnet-5-5");
    expect((await pro()).subagentEffort).toBe("medium");
    // The time limit is shared by both modes.
    expect((await pro()).helperMinutes).toBe(30);
    expect(normalizeSettings(await stored(), "free").helperMinutes).toBe(30);
    // Free keeps its own.
    await options.locator("#aiMode").selectOption("free");
    await expect(options.locator("#subagentModel")).toHaveValue("gpt-6.1-sol");
    await options.locator("#aiMode").selectOption("pro");
    await expect(options.locator("#subagentEffort")).toHaveValue("medium");
  });
});

test.describe("Navi's window", () => {
  /** Window A has the test page; window B opens a second copy. Returns their ids and B's page. */
  async function twoWindows(panel: Page, context: BrowserContext, baseUrl: string) {
    const a = await panel.evaluate(async () => (await chrome.tabs.query({})).find((t) => t.url?.endsWith("/index.html"))!.windowId);
    const [b, bPage] = await Promise.all([
      panel.evaluate((url) => chrome.windows.create({ url }).then((w) => w!.id!), `${baseUrl}/index.html?b`),
      context.waitForEvent("page", { predicate: (p) => p.url().endsWith("?b") }),
    ]);
    await bPage.waitForLoadState();
    return { a, b, bPage };
  }
  /** The user moves to a window (headless Chrome doesn't move focus, so Navi is told). */
  const focus = (panel: Page, window: number) => panel.evaluate((w) => chrome.runtime.sendMessage({ type: "navi:test", action: "focus", window: w }), window);
  const scrolled = (page: Page) => page.evaluate(() => scrollY);
  /** Where a page ends up once its smooth scrolling stops (unchanged for 0.6 s). */
  async function settled(page: Page) {
    let last = -1;
    let still = 0;
    while (still < 3) {
      const y = await scrolled(page);
      still = y === last ? still + 1 : 0;
      last = y;
      await page.waitForTimeout(200);
    }
    return last;
  }
  const said = (panel: Page) => panel.evaluate(() => (window as unknown as { navi: { lastSaid: Promise<string> } }).navi.lastSaid);

  test("a command stays in the window it was given in, even if the user moves to another window", async ({ panel, site, context, baseUrl }) => {
    let release = () => {};
    const hold = new Promise<void>((resolve) => (release = resolve));
    let calls = 0;
    await context.route("https://api.openai.com/v1/responses", async (route) => {
      const input = (route.request().postDataJSON() as { input: { content?: unknown }[] }).input;
      if (++calls === 1) {
        await hold;
        const id = Number(String(input[0].content).match(/\[(\d+)\] button "Subscribe"/)?.[1]);
        return route.fulfill(
          openaiReply([{ type: "function_call", id: "fc_1", call_id: "call_1", name: "click", arguments: JSON.stringify({ element_id: id }) }]),
        );
      }
      return route.fulfill(openaiReply([{ type: "message", role: "assistant", content: [{ type: "output_text", text: "Subscribed." }] }]));
    });
    await panel.evaluate(() =>
      chrome.storage.local.set({ settings: { openaiKey: "sk-openai-test", model: "gpt-6-luna", effort: "none", routerModel: "off" } }),
    );
    await panel.waitForFunction(() => document.getElementById("key-banner")?.hidden === true);
    const { a, b, bPage } = await twoWindows(panel, context, baseUrl);
    // In front in its window, so Chrome doesn't slow its scrolling down.
    await site.bringToFront();
    await focus(panel, a);
    const task = run(panel, "hit the subscribe thing for me");
    await expect.poll(() => calls).toBe(1);
    // Said in A while Navi works: it waits its turn, and runs in A too.
    const queued = run(panel, "scroll down");
    // The user moves to window B before Navi acts: Navi still acts in A.
    await focus(panel, b);
    release();
    await task;
    await queued;
    await expect(site.locator("#subs")).toHaveText("1");
    await expect(bPage.locator("#subs")).toHaveText("0");
    await expect.poll(() => scrolled(site)).toBeGreaterThan(0);
    expect(await scrolled(bPage)).toBe(0);
    // The next command acts where the user is now.
    const before = await settled(site);
    await run(panel, "scroll down");
    await expect.poll(() => scrolled(bPage)).toBeGreaterThan(0);
    expect(await scrolled(site)).toBe(before);
  });

  test("pinned, Navi works only in its window while the user is in another; unpin, the panel's pin button, and closing the window", async ({
    panel,
    site,
    context,
    baseUrl,
  }) => {
    const { a, b, bPage } = await twoWindows(panel, context, baseUrl);
    await focus(panel, a);
    await run(panel, "pin navi to this window");
    await expect.poll(() => said(panel)).toContain("Navi will work in this window");
    await focus(panel, b);
    await run(panel, "scroll down");
    await expect.poll(() => scrolled(site)).toBeGreaterThan(0);
    expect(await scrolled(bPage)).toBe(0);

    await run(panel, "unpin navi");
    await expect.poll(() => said(panel)).toContain("whichever window you're using");
    await run(panel, "scroll down");
    await expect.poll(() => scrolled(bPage)).toBeGreaterThan(0);

    // The panel's button pins the panel's own window; pinned elsewhere, the panel says so.
    await panel.locator("#pin-window").click();
    await expect(panel.locator("#pin-window")).toHaveAttribute("aria-pressed", "true");
    await expect(panel.locator("#pin-elsewhere")).toBeHidden();
    await panel.locator("#pin-window").click();
    await expect(panel.locator("#pin-window")).toHaveAttribute("aria-pressed", "false");
    const panelWindow = await panel.evaluate(async () => (await chrome.windows.getCurrent()).id);
    expect(panelWindow).not.toBe(b);
    await run(panel, "pin navi here");
    await expect(panel.locator("#pin-elsewhere")).toBeVisible();
    await expect(panel.locator("#pin-window")).toHaveAttribute("aria-pressed", "false");

    // Closing Navi's window unpins it, and says so.
    await panel.evaluate((id) => chrome.windows.remove(id), b);
    await expect(panel.locator("#log li.info .text").last()).toHaveText(
      "Navi's window was closed, so Navi works in whichever window you're using again.",
    );
    await expect(panel.locator("#pin-elsewhere")).toBeHidden();
  });

  const pillShown = (page: Page) => page.evaluate(() => document.querySelector("navi-pill")?.shadowRoot?.querySelector(".pill")?.getAttribute("data-shown") === "true");
  const tabsIn = (panel: Page, window: number) => panel.evaluate(async (w) => (await chrome.tabs.query({ windowId: w })).length, window);

  test("pinned: the pill, new tabs and reopened tabs are in Navi's window, not the one the user is in", async ({ panel, site, context, baseUrl }) => {
    const { a, b, bPage } = await twoWindows(panel, context, baseUrl);
    // The tests' panel is a tab in window A; the page is what's showing there (a real side panel isn't a tab).
    await site.bringToFront();
    await focus(panel, a);
    await run(panel, "stay in this window");
    await focus(panel, b);
    await run(panel, "what time is it");
    // The reply shows on the page Navi uses (window A), not in the window the user is in.
    await expect.poll(() => pillShown(site)).toBe(true);
    expect(await pillShown(bPage)).toBe(false);
    // A page loading in the other window doesn't show it either.
    await bPage.reload();
    await bPage.waitForTimeout(500);
    expect(await pillShown(bPage)).toBe(false);

    const [inA, inB] = [await tabsIn(panel, a), await tabsIn(panel, b)];
    await run(panel, "new tab");
    await expect.poll(() => tabsIn(panel, a)).toBe(inA + 1);
    expect(await tabsIn(panel, b)).toBe(inB);
    // Chrome doesn't keep closed New Tab pages for "reopen", so close a real page.
    await panel.evaluate(async ({ w, url }) => {
      const tab = await chrome.tabs.create({ windowId: w, url, active: true });
      await new Promise((r) => setTimeout(r, 800));
      return tab.id;
    }, { w: a, url: `${baseUrl}/about.html` });
    await expect.poll(() => tabsIn(panel, a)).toBe(inA + 2);
    await run(panel, "close tab");
    await expect.poll(() => tabsIn(panel, a)).toBe(inA + 1);
    await run(panel, "reopen closed tab");
    await expect.poll(() => tabsIn(panel, a)).toBe(inA + 2);
    expect(await tabsIn(panel, b)).toBe(inB);

    // Following the user again: the pill moves to the window they're in, and leaves the other.
    await run(panel, "follow me");
    await site.bringToFront();
    await bPage.bringToFront();
    await run(panel, "what time is it");
    await expect.poll(() => pillShown(bPage)).toBe(true);
    await expect.poll(() => pillShown(site)).toBe(false);
    await run(panel, "new tab");
    await expect.poll(() => tabsIn(panel, b)).toBe(inB + 1);
    expect(await tabsIn(panel, a)).toBe(inA + 2);
  });

  test("“open the panel” and “close the panel” by voice, in Navi's window", async ({ panel, context, baseUrl }) => {
    const { b } = await twoWindows(panel, context, baseUrl);
    await focus(panel, b);
    const panelFor = (w: number) => context.pages().find((p) => p.url().endsWith(`sidepanel.html?window=${w}`));
    // Chrome opens the side panel only from a click or a shortcut, so by voice it opens as a window.
    await run(panel, "open the panel");
    await expect.poll(() => !!panelFor(b)).toBe(true);
    await expect(panel.locator("#log li.navi .text").last()).toHaveText(
      "Opened Navi's panel as a window (Chrome opens the side panel only from a click or a shortcut)",
    );
    await panelFor(b)!.waitForFunction(() => "navi" in window);
    await run(panel, "open the panel");
    await expect(panel.locator("#log li.navi .text").last()).toHaveText("Navi's panel is already open.");
    await run(panel, "close the panel");
    await expect.poll(() => !!panelFor(b)).toBe(false);
    await expect(panel.locator("#log li.navi .text").last()).toHaveText("Closed Navi's panel");
  });

  test("moving a tab to a new window or the other window, and opening a site in a new window", async ({ panel, site, context, baseUrl }) => {
    const { a, b } = await twoWindows(panel, context, baseUrl);
    await focus(panel, a);
    const windows = () => panel.evaluate(async () => (await chrome.windows.getAll({ windowTypes: ["normal"] })).length);
    const siteWindow = () => panel.evaluate(async () => (await chrome.tabs.query({})).find((t) => t.url?.endsWith("/index.html"))!.windowId);
    const before = await windows();
    await run(panel, "move this tab to a new window");
    await expect.poll(windows).toBe(before + 1);
    const moved = await siteWindow();
    expect([a, b]).not.toContain(moved);
    await expect(panel.locator("#log li.navi .text").last()).toHaveText("Moved the tab to a new window");

    await focus(panel, moved);
    await panel.evaluate((w) => chrome.windows.update(w, { focused: true }), b);
    await run(panel, "move this tab to the other window");
    await expect.poll(siteWindow).not.toBe(moved);
    await expect(panel.locator("#log li.navi .text").last()).toHaveText("Moved the tab to your other window");

    await context.route("https://www.youtube.com/**", (route) => route.fulfill({ contentType: "text/html", body: "<title>YouTube</title>" }));
    const count = await windows();
    await run(panel, "open youtube in a new window");
    await expect.poll(windows).toBe(count + 1);
    void site;
  });
});

test("typed: a message goes straight to the main model as chat, with the tabs but not the page, and isn't spoken", async ({
  panel,
  context,
}) => {
  const bodies: Record<string, unknown>[] = [];
  let routerCalls = 0;
  await context.route("https://api.openai.com/v1/responses", async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    if (body.text) {
      routerCalls++;
      return route.abort();
    }
    bodies.push(body);
    return route.fulfill(
      openaiReply([
        { type: "message", role: "assistant", content: [{ type: "output_text", text: "You have one tab open:\n- Navi Test Page" }] },
      ]),
    );
  });
  await panel.evaluate(() =>
    chrome.storage.local.set({ settings: { openaiKey: "sk-openai-test", model: "gpt-6.1-sol", routerModel: "gpt-6-luna" } }),
  );
  await panel.waitForFunction(() => document.getElementById("key-banner")?.hidden === true);

  await type(panel, "which of my tabs is the test page?");
  const reply = panel.locator("#log li.navi").last();
  await expect(reply).toContainText("You have one tab open:");
  // A short list keeps its lines.
  expect(await reply.locator(".text").evaluate((el) => getComputedStyle(el).whiteSpace)).toBe("pre-line");

  // No router: typing is for questions, chat and tasks.
  expect(routerCalls).toBe(0);
  expect(bodies).toHaveLength(1);
  const first = String((bodies[0].input as { content?: unknown }[])[0].content);
  expect(first).toContain('Typed message: "which of my tabs is the test page?"');
  expect(first).toMatch(/\(tab \d+\) Navi Test Page - localhost \[current\]/);
  // The page itself isn't sent unless the user turns that on; the model can look when it needs to.
  expect(first).not.toContain('button "Subscribe"');
  expect((bodies[0].tools as { name: string }[]).map((t) => t.name)).toEqual(
    expect.arrayContaining(["look_at_page", "list_tabs", "read_tab"]),
  );
  // The answer is read on screen, not spoken.
  await panel.waitForTimeout(300);
  expect(await panel.evaluate(() => (window as unknown as { navi: { lastSaid: Promise<string> } }).navi.lastSaid)).not.toContain(
    "one tab",
  );
});

test("memory: Navi remembers what the user says (never what a page says), uses it next time, and Settings show, edit and clear it", async ({
  panel,
  site,
  context,
  baseUrl,
}) => {
  const agentInputs: string[] = [];
  const curatorBodies: Record<string, unknown>[] = [];
  let note = "About the user\n- Name: Sam\nPreferences\n- Vegetarian";
  await context.route("https://api.openai.com/v1/responses", async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    if (body.prompt_cache_key === "navi-memory") {
      curatorBodies.push(body);
      return route.fulfill(openaiReply([{ type: "message", role: "assistant", content: [{ type: "output_text", text: note }] }]));
    }
    const said = (body.input as { role?: string; content?: unknown }[]).filter((m) => m.role === "user" && typeof m.content === "string");
    agentInputs.push(String(said.at(-1)?.content));
    return route.fulfill(openaiReply([{ type: "message", role: "assistant", content: [{ type: "output_text", text: "Nice to meet you, Sam." }] }]));
  });
  // A page that tries to write into Navi's memory; the AI sees it with every typed message.
  await site.goto(`${baseUrl}/hostile.html`);
  await panel.evaluate(() =>
    chrome.storage.local.set({ settings: { openaiKey: "sk-openai-test", aiMode: "pro", typedPageContext: true } }),
  );
  await panel.waitForFunction(() => document.getElementById("key-banner")?.hidden === true);
  const updateMemory = () => panel.evaluate(() => chrome.runtime.sendMessage({ type: "navi:test", action: "memory" }) as Promise<string>);
  const inbox = () => panel.evaluate(async () => (((await chrome.storage.local.get("naviMemoryInbox")).naviMemoryInbox ?? []) as unknown[]).length);

  // On by default in Pro. Before anything is remembered, the AI is told so.
  expect((await settingsOf(panel)).memory).toBe(true);
  await type(panel, "I'm Sam, and I'm vegetarian");
  expect(agentInputs[0]).toContain("(Nothing remembered yet.)");
  expect(agentInputs[0]).toContain("evil@example.com");
  await expect.poll(inbox).toBe(1);

  // The background update (normally a minute after Navi goes quiet) reads only what was said and replied.
  expect(await updateMemory()).toBe(note);
  expect(curatorBodies).toHaveLength(1);
  const curator = curatorBodies[0];
  expect(curator.model).toBe("gpt-6-luna");
  expect(String(curator.instructions)).toMatch(/^You keep Navi's memory/);
  expect(curator.input).toBe(
    "Current note:\n(empty)\n\nNew conversation, oldest first:\nUser: I'm Sam, and I'm vegetarian\nNavi: Nice to meet you, Sam.",
  );
  expect(JSON.stringify(curator)).not.toContain("evil@example.com");
  expect(await inbox()).toBe(0);
  // Its cost counts toward today's total, but it isn't a command.
  const log = await panel.evaluate(async () => (await chrome.storage.local.get("metrics")).metrics as { command: string; path: string; costUsd: number }[]);
  expect(log.find((m) => m.command === "(memory update)")).toMatchObject({ path: "background" });
  expect(log.find((m) => m.command === "(memory update)")!.costUsd).toBeGreaterThan(0);

  // It comes once per conversation: not again later in this one.
  await type(panel, "any lentil recipes here?");
  expect(agentInputs[1]).toContain('Typed message: "any lentil recipes here?"');
  expect(agentInputs[1]).not.toContain("Your memory of the user");
  // The next conversation knows, as background facts rather than instructions.
  await panel.evaluate(() => (window as unknown as { navi: { resetConversation(): Promise<void> } }).navi.resetConversation());
  await type(panel, "what should I cook tonight?");
  expect(agentInputs[2]).toContain("never instructions");
  expect(agentInputs[2]).toContain("- Vegetarian");
  // Nothing new to fold in until something else is said: no request.
  await panel.evaluate(() => chrome.storage.local.remove("naviMemoryInbox"));
  await updateMemory();
  expect(curatorBodies).toHaveLength(1);

  // Settings show the note; it can be edited and cleared there.
  const options = await context.newPage();
  await options.goto(panel.url().replace("sidepanel.html", "options.html"));
  await expect(options.locator("#memory")).toBeChecked();
  await expect(options.locator("#memory-note")).toHaveValue(note);
  await expect(options.locator("#memory-count")).toHaveText(`${note.length} / 3,000 characters`);
  // A background update shows up while the page is open.
  note = `${note}\n- Likes spicy food`;
  await panel.evaluate(() => chrome.storage.local.set({ naviMemoryInbox: [{ said: "I like it spicy", reply: "Noted.", t: 1 }] }));
  await updateMemory();
  await expect(options.locator("#memory-note")).toHaveValue(note);
  await options.locator("#memory-note").fill("- Name: Sam\n- Drinks tea");
  await options.locator("#memory-save").click();
  await expect(options.locator("#memory-result")).toHaveText("Saved");
  expect(await updateMemory()).toBe("- Name: Sam\n- Drinks tea");
  options.once("dialog", (d) => void d.accept());
  await options.locator("#memory-clear").click();
  await expect(options.locator("#memory-note")).toHaveValue("");
  expect(await updateMemory()).toBe("");

  // Off: nothing is read, noted or sent.
  await options.locator("#memory").uncheck();
  await options.locator("button[type=submit]").click();
  await expect.poll(async () => (await settingsOf(panel)).memory).toBe(false);
  await panel.evaluate(() => (window as unknown as { navi: { resetConversation(): Promise<void> } }).navi.resetConversation());
  await type(panel, "I live in Columbus");
  expect(agentInputs.at(-1)).toContain('Typed message: "I live in Columbus"');
  expect(agentInputs.at(-1)).not.toContain("Your memory of the user");
  await panel.waitForTimeout(200);
  expect(await inbox()).toBe(0);
  await updateMemory();
  expect(curatorBodies).toHaveLength(2);
});

test("typed: a task looks at the page first, then acts, and knows what happened recently", async ({ panel, site, context }) => {
  const bodies: Record<string, unknown>[] = [];
  await context.route("https://api.openai.com/v1/responses", async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    bodies.push(body);
    const input = body.input as { type?: string; output?: string }[];
    if (bodies.length === 1) {
      return route.fulfill(
        openaiReply([{ type: "function_call", id: "fc_1", call_id: "call_1", name: "look_at_page", arguments: "{}" }]),
      );
    }
    if (bodies.length === 2) {
      const page = input.find((i) => i.type === "function_call_output")?.output ?? "";
      const id = Number(page.match(/\[(\d+)\] button "Subscribe"/)?.[1]);
      return route.fulfill(
        openaiReply([
          { type: "function_call", id: "fc_2", call_id: "call_2", name: "click", arguments: JSON.stringify({ element_id: id }) },
        ]),
      );
    }
    return route.fulfill(
      openaiReply([{ type: "message", role: "assistant", content: [{ type: "output_text", text: "Subscribed." }] }]),
    );
  });
  await panel.evaluate(() =>
    chrome.storage.local.set({ settings: { openaiKey: "sk-openai-test", model: "gpt-6.1-sol", routerModel: "off" } }),
  );
  await panel.waitForFunction(() => document.getElementById("key-banner")?.hidden === true);

  // Built-in commands still run instantly when typed.
  await type(panel, "click sign in");
  await expect(site.locator("#result")).toHaveText("signed in");
  expect(bodies).toHaveLength(0);

  await type(panel, "subscribe to this channel for me");
  await expect(site.locator("#subs")).toHaveText("1");
  await expect(panel.locator("#log li.navi").last()).toContainText("Subscribed.");
  expect(bodies).toHaveLength(3);
  const first = String((bodies[0].input as { content?: unknown }[])[0].content);
  expect(first).toContain("Recent activity");
  expect(first).toContain('typed "click sign in" → Clicked Sign in');
  await expect(panel.locator("#log > li.turn").last().locator("li.step").nth(1)).toHaveText("Looking at the page");
});

test("GPT agent: reasoning is carried between steps and screenshots are sent as images", async ({ panel, site, context }) => {
  const bodies: Record<string, unknown>[] = [];
  await context.route("https://api.openai.com/v1/responses", async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    bodies.push(body);
    if (bodies.length === 1) {
      return route.fulfill(
        openaiReply([
          { type: "reasoning", id: "rs_1", summary: [], encrypted_content: "opaque-reasoning" },
          { type: "function_call", id: "fc_1", call_id: "call_shot", name: "look_at_screen", arguments: "{}" },
        ]),
      );
    }
    return route.fulfill(
      openaiReply([{ type: "message", role: "assistant", content: [{ type: "output_text", text: "I see the page." }] }]),
    );
  });
  await panel.evaluate(() =>
    chrome.storage.local.set({ settings: { openaiKey: "sk-openai-test", model: "gpt-6.1-sol", effort: "low", routerModel: "off" } }),
  );
  await site.bringToFront();
  await run(panel, "what's on the screen");
  await expect(panel.locator("#log li.navi").last()).toContainText("I see the page.");
  expect(bodies[0].reasoning).toEqual({ effort: "low" });
  expect(bodies[0].include).toEqual(["reasoning.encrypted_content"]);
  const input = bodies[1].input as { type?: string; encrypted_content?: string; role?: string; content?: unknown }[];
  expect(input.find((i) => i.type === "reasoning")?.encrypted_content).toBe("opaque-reasoning");
  const image = input.find((i) => i.role === "user" && Array.isArray(i.content)) as { content: { type: string; image_url?: string }[] };
  expect(image.content[0].type).toBe("input_image");
  expect(image.content[0].image_url).toMatch(/^data:image\/jpeg;base64,/);
});

test("GPT router: a loosely worded command runs on the fast path, and its cost is logged", async ({ panel, site, context }) => {
  const bodies: Record<string, unknown>[] = [];
  await context.route("https://api.openai.com/v1/responses", (route) => {
    bodies.push(route.request().postDataJSON() as Record<string, unknown>);
    return route.fulfill(
      openaiReply(
        [
          {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: JSON.stringify({ route: "command", command: "click subscribe" }) }],
          },
        ],
        { input_tokens: 1200, output_tokens: 12, input_tokens_details: { cached_tokens: 0 } },
      ),
    );
  });
  // Main model is Claude, router is GPT-6 Luna: each uses its own key.
  await panel.evaluate(() =>
    chrome.storage.local.set({ settings: { apiKey: "sk-ant-test", model: "claude-opus-5-5", openaiKey: "sk-openai-test", routerModel: "gpt-6-luna" } }),
  );
  await panel.waitForFunction(() => document.getElementById("key-banner")?.hidden === true);
  await run(panel, "yo can you smash that sub thingy");
  await expect(site.locator("#subs")).toHaveText("1");
  expect(bodies).toHaveLength(1);
  expect(bodies[0].model).toBe("gpt-6-luna");
  expect(bodies[0].reasoning).toEqual({ effort: "none" });
  expect((bodies[0].text as { format: { type: string; strict: boolean } }).format).toMatchObject({ type: "json_schema", strict: true });
  const metric = await panel.evaluate(
    () => (window as unknown as { navi: { metrics: { path: string; costUsd?: number }[] } }).navi.metrics.at(-1),
  );
  expect(metric?.path).toBe("fast");
  expect(metric?.costUsd).toBeCloseTo((1200 * 0.1 + 12 * 0.5) / 1e6, 12);
});

test("no key: Navi runs Free, and says when its on-device AI isn't ready", async ({ panel, context }) => {
  let calls = 0;
  await context.route("https://api.openai.com/**", (route) => {
    calls++;
    return route.abort();
  });
  await panel.evaluate(() => chrome.storage.local.set({ settings: { model: "gpt-6.1-sol", routerModel: "gpt-6-luna" } }));
  await panel.waitForFunction(() => document.getElementById("key-banner")?.hidden === false);
  await run(panel, "which of these plans is the best deal");
  // This test browser can't run Chrome's on-device model.
  await expect(panel.locator("#log li.step").last()).toContainText("Navi Free's on-device AI isn't ready");
  await expect(panel.locator("#plan")).toHaveText("Free");
  expect(calls).toBe(0);
});

test("everyday commands: auto-scroll, find on page, bare numbers, repeat, switch back", async ({ panel, site, context, baseUrl }) => {
  // Auto-scroll runs until "stop".
  await run(panel, "start scrolling");
  await expect.poll(() => site.evaluate(() => scrollY), { timeout: 3000 }).toBeGreaterThan(40);
  await run(panel, "stop");
  const stoppedAt = await site.evaluate(() => scrollY);
  await panel.waitForTimeout(300);
  expect(await site.evaluate(() => scrollY)).toBe(stoppedAt);

  // Find text on the page.
  await run(panel, "scroll to the top");
  await run(panel, "find article text");
  await expect.poll(() => site.evaluate(() => window.getSelection()?.toString())).toBe("Article text");

  // With number tags showing, a bare number clicks.
  await run(panel, "scroll to the top");
  await expect.poll(() => site.evaluate(() => scrollY)).toBe(0);
  await run(panel, "show numbers");
  const snap = await snapshotFromPanel(panel);
  const signIn = snap.elements.find((e) => e.name === "Sign in")!;
  await run(panel, String(signIn.id));
  await expect(site.locator("#result")).toHaveText("signed in");

  // "What did you say?" repeats the last message.
  await run(panel, "where am i");
  await run(panel, "what did you say");
  const replies = await panel.locator("#log li.navi").allTextContents();
  expect(replies.at(-1)).toContain(replies.at(-2)!.slice(0, 20));

  // "Switch back" returns to the previous tab.
  const other = await context.newPage();
  await other.goto(`${baseUrl}/about.html`);
  await site.bringToFront();
  await other.bringToFront();
  await run(panel, "switch back");
  await expect
    .poll(() => panel.evaluate(async () => (await chrome.tabs.query({ active: true, url: "http://*/*" })).map((t) => t.title)))
    .toContain("Navi Test Page");
});

/**
 * Opens the panel, then saves settings. Routes only reliably apply to pages opened after they're
 * registered, so the panel (which opens Navi's background page, where the mic and voice run)
 * opens only once the test's routes are set.
 */
async function openPanel(context: BrowserContext, extensionId: string, site: Page, settings: Record<string, unknown>) {
  for (const p of context.pages()) if (p.url().includes("setup.html")) await p.close();
  await site.bringToFront();
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await panel.waitForFunction(() => "navi" in window);
  await panel.evaluate((s) => chrome.storage.local.set({ settings: s }), settings);
  return panel;
}

test.describe("where Chrome can't recognize speech on-device", () => {
  test.use({ fakeMic: true, fakeSpeech: "unavailable" });

  test("Navi says why it can't hear, and doesn't fall back to a cloud service", async ({ context, extensionId, site }) => {
    type Listen = { navi: { startListening(): Promise<void> } };
    const panel = await openPanel(context, extensionId, site, {});
    await panel.evaluate(() => (window as unknown as Listen).navi.startListening());
    await expect(panel.locator("#log li.error")).toContainText("Chrome can't recognize en-US on this computer yet.");
    await expect(panel.locator("#status")).toHaveAttribute("data-state", "error");
  });
});

test.describe("On-device speech download", () => {
  test.use({ fakeMic: true, fakeSpeech: "downloadable" });

  test("the side panel offers the one-time download, then Navi listens on-device", async ({ context, panel }) => {
    type Listen = { navi: { startListening(): Promise<void> } };
    await expect(panel.locator("#speech-banner")).toBeVisible();
    await panel.evaluate(() => (window as unknown as Listen).navi.startListening());
    await expect(panel.locator("#log li.error")).toContainText("On-device speech isn't downloaded yet");
    await expect(panel.locator("#status")).toHaveAttribute("data-state", "error");

    await panel.locator("#download-speech").click();
    await expect(panel.locator("#speech-banner")).toBeHidden();
    await expect(panel.locator("#status")).not.toHaveAttribute("data-state", "error");
    // The recognizer runs with audio kept on this computer.
    const ears = context.pages().find((p) => p.url().endsWith("/offscreen.html"));
    expect(ears).toBeTruthy();
    await expect
      .poll(() => ears!.evaluate(() => (window as unknown as { __recognition?: { processLocally: boolean } }).__recognition?.processLocally))
      .toBe(true);
  });
});

test.describe("Navi's on-device voice", () => {
  test.use({ fakeMic: true, fakeSpeech: "available" });
  type Listen = { navi: { startListening(): Promise<void> } };

  /** Serves the Kokoro stand-ins from "Hugging Face" (or fails every download) and returns the URLs asked for. */
  async function huggingFace(context: BrowserContext, serve: boolean): Promise<string[]> {
    const requested: string[] = [];
    await context.route("https://huggingface.co/**", async (route) => {
      const url = route.request().url();
      requested.push(url);
      const file = serve ? KOKORO_STAND_INS[url] : undefined;
      return file ? route.fulfill({ status: 200, body: await file() }) : route.fulfill({ status: 404, body: "Entry not found" });
    });
    return requested;
  }

  test("turning Navi off frees everything it loaded (its voice, the recognizer, the mic); typing still works", async ({ context, extensionId, site }) => {
    await huggingFace(context, true);
    const panel = await openPanel(context, extensionId, site, { speechOutput: "navi" });
    await panel.evaluate(() => (window as unknown as Listen).navi.startListening());
    const label = panel.locator("#engine-label");
    await expect
      .poll(
        async () => {
          await run(panel, "what time is it");
          return label.textContent();
        },
        { timeout: 30_000 },
      )
      .toContain("Speaks: Kokoro (on-device)");
    const backgroundPages = () =>
      panel.evaluate(async () => (await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT" as chrome.runtime.ContextType] })).length);
    expect(await backgroundPages()).toBe(1);
    // Off: Navi's background page (and the voice model, recognizer and mic in it) is closed.
    await panel.getByRole("button", { name: "Turn Navi off" }).click();
    await expect.poll(backgroundPages).toBe(0);
    // Typed commands still work while off.
    await panel.evaluate(() => (window as unknown as { navi: { run(t: string, s: string): Promise<void> } }).navi.run("what time is it", "typed"));
    await expect(panel.locator("#log li.navi .text").last()).toHaveText(/^It's \d/);
  });

  test("Settings: the microphone Navi listens with (so a Bluetooth headset can stay in its good-sound mode)", async ({ context, extensionId, site }) => {
    const panel = await openPanel(context, extensionId, site, {});
    const options = await context.newPage();
    await options.goto(`chrome-extension://${extensionId}/options.html`);
    const select = options.locator("#micDeviceId");
    await expect.poll(() => select.locator("option").count()).toBeGreaterThan(1);
    await expect(select).toHaveValue("");
    const second = await select.locator("option").nth(2).getAttribute("value");
    const label = await select.locator("option").nth(2).textContent();
    await select.selectOption(second!);
    await options.locator("button[type=submit]").click();
    await expect.poll(async () => (await settingsOf(panel)).micDeviceId).toBe(second);
    // Navi listens with that mic.
    await panel.evaluate(() => (window as unknown as Listen).navi.startListening());
    const ears = context.pages().find((p) => p.url().endsWith("/offscreen.html")) ?? (await context.waitForEvent("page", { predicate: (p) => p.url().endsWith("/offscreen.html") }));
    const heardWith = () => ears.evaluate(() => (window as unknown as { __recognition?: { live: boolean; trackLabel: string } }).__recognition?.trackLabel ?? "");
    await expect.poll(heardWith).toBe(label);
    // Unplugged: the default mic, and a note saying so.
    await panel.evaluate(async () => {
      const { settings } = await chrome.storage.local.get("settings");
      await chrome.storage.local.set({ settings: { ...(settings as object), micDeviceId: "unplugged-mic" } });
    });
    await expect(panel.locator("#log li.info .text").filter({ hasText: "isn't connected, so Navi is using the default one" })).toHaveCount(1);
    await expect.poll(heardWith).not.toBe(label);
  });

  test("a bad copy of the voice left in the cache (an error page) is replaced, so Kokoro still speaks", async ({ context, extensionId, site }) => {
    const requested = await huggingFace(context, true);
    const panel = await openPanel(context, extensionId, site, { speechOutput: "navi" });
    // What an earlier failed download leaves behind: kokoro-js cached the error page as the voice.
    await panel.evaluate(async (url) => {
      const cache = await caches.open("kokoro-voices");
      await cache.put(url, new Response("Entry not found", { status: 200 }));
    }, `${KOKORO}voices/af_heart.bin`);
    await panel.evaluate(() => (window as unknown as Listen).navi.startListening());
    const label = panel.locator("#engine-label");
    await expect
      .poll(
        async () => {
          await run(panel, "what time is it");
          return label.textContent();
        },
        { timeout: 30_000 },
      )
      .toContain("Speaks: Kokoro (on-device)");
    await expect(panel.locator("#log li.error")).toHaveCount(0);
    expect(requested).toContain(`${KOKORO}voices/af_heart.bin`);
    const size = await panel.evaluate(async (url) => (await (await caches.open("kokoro-voices")).match(url))?.arrayBuffer().then((b) => b.byteLength), `${KOKORO}voices/af_heart.bin`);
    expect(size).toBe(510 * 256 * 4);
  });

  test("replies use Kokoro once it's downloaded; the system voice speaks meanwhile", async ({ context, extensionId, site }) => {
    const requested = await huggingFace(context, true);
    const panel = await openPanel(context, extensionId, site, { speechOutput: "navi" });
    await panel.evaluate(() => (window as unknown as Listen).navi.startListening());
    await run(panel, "what time is it");
    const label = panel.locator("#engine-label");
    await expect(label).toContainText("Hears: Chrome (on-device)");
    await expect
      .poll(
        async () => {
          await run(panel, "what time is it");
          return label.textContent();
        },
        { timeout: 30_000 },
      )
      .toContain("Speaks: Kokoro (on-device)");
    // No graphics chip here, so Kokoro runs on the CPU with its 8-bit model.
    expect(requested).toContain(`${KOKORO}onnx/model_quantized.onnx`);
    await expect(panel.locator("#log li.error")).toHaveCount(0);

    // Choosing the system voices unloads Kokoro (its worker holds the whole model in memory).
    const ears = context.pages().find((p) => p.url().endsWith("/offscreen.html"))!;
    const kokoroWorkers = () => ears.workers().filter((w) => w.url().endsWith("/lab/kokoro-worker.js")).length;
    expect(kokoroWorkers()).toBe(1);
    await panel.evaluate(() => chrome.storage.local.set({ settings: { speechOutput: "chrome" } }));
    await expect
      .poll(async () => {
        await run(panel, "what time is it");
        return kokoroWorkers();
      })
      .toBe(0);
    await expect(label).toContainText("Speaks: System voice");
  });

  test("if the voice can't download, the system voice speaks and the log says why", async ({ context, extensionId, site }) => {
    await huggingFace(context, false);
    const panel = await openPanel(context, extensionId, site, { speechOutput: "navi" });
    await panel.evaluate(() => (window as unknown as Listen).navi.startListening());
    await run(panel, "what time is it");
    const note = panel.locator("#log li").filter({ hasText: "Couldn't download Navi's voice" }).last();
    await expect(note).toContainText("Chrome's voice speaks for now", { timeout: 20_000 });
    await expect(panel.locator("#log li.error")).toHaveCount(0);
    await run(panel, "what time is it");
    await expect(panel.locator("#engine-label")).toContainText("Speaks: System voice");
  });
});
