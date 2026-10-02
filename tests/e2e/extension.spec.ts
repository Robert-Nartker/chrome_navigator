// Loads the built extension (dist/) into Chromium and drives it through the
// side panel's command pipeline against local test pages.

import { type BrowserContext, type Page, chromium, expect, test as base } from "@playwright/test";
import { mkdtemp, writeFile } from "node:fs/promises";

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

test("“open” opens a new tab and “go back” there returns to where you were; “go to” stays in this tab", async ({
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
  // The new tab has nothing to go back to: it closes, back to the page it came from.
  await run(panel, "go back");
  await expect.poll(() => opened.isClosed()).toBe(true);
  await expect(panel.locator("#log li.navi").last()).toContainText("Back to");
  // "Go to" replaces the page, and "go back" is ordinary history.
  await run(panel, `go to 127.0.0.1:${port}/about.html`);
  await expect(site).toHaveURL(/127\.0\.0\.1.*about\.html/);
  await run(panel, "go back");
  await expect(site).toHaveURL(/localhost.*index\.html/);
  expect(webTabs().length).toBe(1);
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
