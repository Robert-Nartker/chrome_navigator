// The side panel's view: live caption, command cards with collapsible steps, labels, and the log restore.
// Set NAVI_SCREENSHOTS=1 to also save the screenshots in docs/screenshots/.

import { type BrowserContext, type Page, type Route, chromium, expect, test as base } from "@playwright/test";
import { createServer, type Server } from "node:http";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";

import { tmpdir } from "node:os";
import path from "node:path";

const DIST = path.resolve("dist");
const FIXTURES = path.resolve("tests/fixtures");
const SCREENSHOTS = path.resolve("docs/screenshots");
const SANDBOX_CHROMIUM = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
// Uses Playwright's own Chromium unless NAVI_CHROMIUM (or the sandbox build) is present.
const CHROMIUM = process.env.NAVI_CHROMIUM ?? (existsSync(SANDBOX_CHROMIUM) ? SANDBOX_CHROMIUM : undefined);

type Fixtures = {
  context: BrowserContext;
  extensionId: string;
  baseUrl: string;
  site: Page;
  panel: Page;
  /** Give Chromium a fake microphone (a test tone) that's allowed without a prompt. */
  fakeMic: boolean;
  /** Replace Chrome's speech recognizer in extension pages with a scripted one (see `hear`). */
  fakeSpeech: boolean;
};

/** A stand-in for Chrome's recognizer: always on-device, never errors, and hears what `__hear` says. */
function installFakeRecognizer() {
  if (location.protocol !== "chrome-extension:") return;
  type Handler = ((event?: unknown) => void) | null;
  class FakeRecognition {
    onresult: Handler = null;
    onerror: Handler = null;
    onend: Handler = null;
    onstart: Handler = null;
    constructor() {
      (window as unknown as { __recognition: FakeRecognition }).__recognition = this;
    }
    static available() {
      return Promise.resolve("available");
    }
    start() {
      setTimeout(() => this.onstart?.(), 0);
    }
    stop() {
      setTimeout(() => this.onend?.(), 0);
    }
    abort() {
      this.stop();
    }
  }
  const w = window as unknown as Record<string, unknown>;
  w.SpeechRecognition = w.webkitSpeechRecognition = FakeRecognition;
  w.__hear = (transcript: string, isFinal: boolean) => {
    const result = Object.assign([{ transcript, confidence: 0.95 }], { isFinal });
    (w.__recognition as FakeRecognition | undefined)?.onresult?.({ resultIndex: 0, results: [result] });
  };
}

function startServer(): Promise<{ server: Server; baseUrl: string }> {
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      const file = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
      try {
        const body = await readFile(path.join(FIXTURES, path.basename(file)));
        res.writeHead(200, { "content-type": "text/html" }).end(body);
      } catch {
        res.writeHead(404).end("not found");
      }
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({ server, baseUrl: `http://localhost:${port}` });
    });
  });
}

const test = base.extend<Fixtures>({
  fakeMic: [false, { option: true }],
  fakeSpeech: [false, { option: true }],
  baseUrl: async ({}, use) => {
    const { server, baseUrl } = await startServer();
    await use(baseUrl);
    server.close();
  },
  context: async ({ fakeMic, fakeSpeech, deviceScaleFactor }, use) => {
    const userDataDir = await mkdtemp(path.join(tmpdir(), "navi-e2e-"));
    const media = fakeMic ? ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] : [];
    const context = await chromium.launchPersistentContext(userDataDir, {
      executablePath: CHROMIUM,
      headless: true,
      deviceScaleFactor,
      args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`, ...media],
    });
    if (fakeSpeech) await context.addInitScript(installFakeRecognizer);
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

type Hooks = {
  navi: {
    run(t: string, source?: "typed" | "voice"): Promise<void>;
    lastReply(): string;
    startListening(): Promise<void>;
    stopListening(): void;
    speaker: { busy: boolean };
  };
};

/** A command as if spoken (these cards come from the voice pipeline: router, then the AI). */
async function run(panel: Page, command: string) {
  await panel.evaluate((text) => (window as unknown as Hooks).navi.run(text, "voice"), command);
}

/** Navi's background page (offscreen document), where the mic and recognizer run. */
async function earsPage(panel: Page): Promise<Page> {
  const isEars = (p: Page) => p.url().endsWith("/offscreen.html");
  return panel.context().pages().find(isEars) ?? (await panel.context().waitForEvent("page", { predicate: isEars }));
}

/** Speech from the fake recognizer: interim words, or a final phrase. */
async function hear(panel: Page, transcript: string, isFinal = false) {
  await (await earsPage(panel)).evaluate(
    ([text, final]) => (window as unknown as { __hear(t: string, f: boolean): void }).__hear(text, final),
    [transcript, isFinal] as const,
  );
}

/**
 * Mocks Claude: the quick router model sends everything to the agent, unless `routed` maps the phrase to a
 * command. The agent clicks Subscribe, then answers `reply`. `hold` delays the agent's final answer.
 */
async function mockClaude(
  context: BrowserContext,
  opts: { reply?: string; routed?: Record<string, string>; hold?: Promise<void> } = {},
) {
  await context.route("https://api.anthropic.com/**", async (route: Route) => {
    const body = route.request().postDataJSON() as {
      model: string;
      messages: { role: string; content: unknown }[];
      output_config?: { format?: unknown };
    };
    let content: unknown[];
    // The quick router asks for structured JSON.
    if (body.output_config?.format) {
      const said = JSON.stringify(body.messages);
      const hit = Object.entries(opts.routed ?? {}).find(([phrase]) => said.includes(phrase));
      content = [{ type: "text", text: JSON.stringify(hit ? { route: "command", command: hit[1] } : { route: "agent", command: "" }) }];
    } else if (body.messages.length === 1) {
      const id = Number(String(body.messages[0].content).match(/\[(\d+)\] button "Subscribe"/)?.[1]);
      content = [{ type: "tool_use", id: "toolu_1", name: "click", input: { element_id: id } }];
    } else {
      await opts.hold;
      content = [{ type: "text", text: opts.reply ?? "Subscribed." }];
    }
    // (A cancelled command has already dropped the request.)
    await route
      .fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "msg", type: "message", role: "assistant", model: body.model, stop_sequence: null,
          usage: { input_tokens: 900, output_tokens: 40 },
          stop_reason: (content[0] as { type: string }).type === "tool_use" ? "tool_use" : "end_turn",
          content,
        }),
      })
      .catch(() => undefined);
  });
}

async function useClaude(panel: Page, routerModel = "off") {
  await panel.evaluate(
    (router) => chrome.storage.local.set({ settings: { apiKey: "sk-ant-test", model: "claude-opus-5-5", routerModel: router } }),
    routerModel,
  );
  await panel.waitForFunction(() => document.getElementById("key-banner")?.hidden === true);
}

test("an AI command is one card: what you said, its steps in one collapsed row, and the reply", async ({ panel, site, context }) => {
  await mockClaude(context);
  await useClaude(panel);
  await run(panel, "hit the subscribe thing for me");
  await expect(site.locator("#subs")).toHaveText("1");

  const card = panel.locator("#log > li.turn").last();
  await expect(card.locator("li.user")).toContainText("hit the subscribe thing for me");
  await expect(card.locator("li.navi")).toContainText("Subscribed.");
  await expect(card.locator("li.navi .meta")).toContainText(/AI · 2 steps/);
  // Every step sits in the card's single step row, collapsed: in the page, but hidden.
  await expect(card.locator(".trace")).toHaveCount(1);
  await expect(card.locator("li.step")).toHaveText(["Thinking…", /^Clicking .*Subscribe/, "Step 2…"]);
  await expect(card.locator("li.step").first()).toBeHidden();
  const summary = card.locator(".trace summary");
  await expect(summary).toContainText("3 steps");
  await expect(card.locator(".trace")).toHaveAttribute("data-state", "ok");
  expect(await panel.evaluate(() => (window as unknown as Hooks).navi.lastReply())).toBe("Subscribed.");

  // Keyboard: Enter opens the row, Space closes it.
  await summary.focus();
  await panel.keyboard.press("Enter");
  await expect(card.locator("details")).toHaveAttribute("open", "");
  await expect(card.locator("li.step").nth(1)).toBeVisible();
  await panel.keyboard.press("Space");
  await expect(card.locator("details")).not.toHaveAttribute("open", "");
  await expect(card.locator("li.step").nth(1)).toBeHidden();

  // Screen readers hear the reply, not the steps.
  const spoken = await panel.locator("#announcer").textContent();
  expect(spoken).toContain("Subscribed.");
  expect(spoken).not.toContain("Thinking");
  await expect(panel.locator("#log")).not.toHaveAttribute("aria-live", /.+/);
});

test("while Navi works, the card shows a spinner with the latest step and the caption follows it", async ({ panel, context }) => {
  let release = () => {};
  const hold = new Promise<void>((resolve) => (release = resolve));
  await mockClaude(context, { hold });
  await useClaude(panel);
  const done = run(panel, "hit the subscribe thing for me");

  const card = panel.locator("#log > li.turn").last();
  await expect(card).toHaveAttribute("data-state", "working");
  await expect(card.locator(".trace")).toHaveAttribute("data-state", "working");
  await expect(card.locator(".trace-label")).toHaveText("Step 2…");
  await expect(card.locator(".trace-time")).toHaveText(/\d/);
  await expect(panel.locator("#status-text")).toHaveText("Working");
  await expect(panel.locator("#voice")).toHaveAttribute("data-state", "working");
  await expect(panel.locator("#caption-hint")).toHaveText("Step 2…");

  release();
  await done;
  await expect(card).toHaveAttribute("data-state", "done");
  await expect(card.locator(".trace-label")).toHaveText("3 steps");
  await expect(panel.locator("#status-text")).toHaveText("Mic off");
});

test("a command said mid-task is noted in the running card, and stop ends it", async ({ panel, context }) => {
  let release = () => {};
  const hold = new Promise<void>((resolve) => (release = resolve));
  await mockClaude(context, { hold });
  await useClaude(panel);
  const first = run(panel, "hit the subscribe thing for me");
  const card = panel.locator("#log > li.turn").filter({ hasText: "hit the subscribe thing" });
  await expect(card.locator(".trace-label")).toHaveText("Step 2…");

  await run(panel, "scroll down");
  await expect(card.locator("li.info")).toContainText("Next: “scroll down”");
  await run(panel, "stop");
  await first;
  await expect(card.locator("li.info").last()).toContainText("Cancelled.");
  await expect(card).toHaveAttribute("data-state", "done");
  await expect(card.locator(".trace")).not.toHaveAttribute("data-state", "working");
  // "stop" is its own card after the cancelled one; the queued command was dropped.
  const cards = panel.locator("#log > li.turn");
  await expect(cards.last().locator("li.user")).toContainText("stop");
  await expect(panel.locator("#log li.user").filter({ hasText: "scroll down" })).toHaveCount(0);
  await expect(panel.locator("#status-text")).toHaveText("Mic off");
  release();
});

test("fast commands and unrecognized ones stay compact; notes sit between cards", async ({ panel }) => {
  // The greeting is a standalone note, not a card.
  await expect(panel.locator("#log > li.info").filter({ hasText: "keeps listening" })).toHaveCount(1);

  await run(panel, "scroll down");
  const fast = panel.locator("#log > li.turn").last();
  await expect(fast.locator("li.navi")).toContainText("Scrolling down");
  await expect(fast.locator("li.step")).toHaveCount(1);
  await expect(fast.locator("li.step")).toContainText("Fast path");
  // Quick commands are just what you said and the result: no steps row.
  await expect(fast).toHaveAttribute("data-kind", "quick");
  await expect(fast.locator(".trace")).toBeHidden();

  // No AI key and no match: the outcome is the step itself, so it shows without opening the row.
  await run(panel, "flibbertigibbet the wobbly thing");
  const unknown = panel.locator("#log > li.turn").last();
  await expect(unknown.locator("li.navi")).toHaveCount(0);
  await expect(unknown.locator(".trace-label")).toBeVisible();
  await expect(unknown.locator(".trace-label")).toContainText("Not a built-in command");
  // Not understood: one faint line rather than a card.
  await expect(unknown).toHaveAttribute("data-kind", "quiet");
});

test("reopening the panel rebuilds the same cards", async ({ panel, site, context }) => {
  await mockClaude(context, { routed: { "smash that sub": "click subscribe" } });
  await useClaude(panel, "claude-sonnet-5-5");
  // (Not a scroll: a smooth scroll still moving could carry Subscribe off screen before the AI looks.)
  await run(panel, "what time is it");
  await run(panel, "yo smash that sub thingy");
  await run(panel, "hit the subscribe thing for me");
  await expect(site.locator("#subs")).toHaveText("2");
  await expect(panel.locator("#log li.navi").last()).toContainText("Subscribed.");

  const url = panel.url();
  await panel.waitForTimeout(500); // the log is saved shortly after each entry
  await panel.close();
  const reopened = await context.newPage();
  await reopened.goto(url);
  await reopened.waitForFunction(() => "navi" in window);

  const cards = reopened.locator("#log > li.turn");
  await expect(cards).toHaveCount(3);
  await expect(reopened.locator("#log > li.info").filter({ hasText: "keeps listening" })).toHaveCount(1);
  const routed = cards.nth(1);
  await expect(routed.locator("li.user")).toContainText("yo smash that sub thingy");
  await expect(routed.locator("li.step").first()).toContainText("Understood as “click subscribe”");
  // A routed command shows what the router made of the speech, and no steps row.
  await expect(routed.locator("li.heard")).toHaveText("heard as “click subscribe”");
  await expect(routed.locator(".trace")).toBeHidden();
  const ai = cards.nth(2);
  await expect(ai.locator("li.user")).toContainText("hit the subscribe thing for me");
  await expect(ai.locator("li.step")).toHaveCount(3);
  await expect(ai.locator("li.step").first()).toBeHidden();
  await expect(ai.locator(".trace-label")).toHaveText("3 steps");
  await expect(ai.locator(".trace-time")).toHaveText(/\d/);
  await expect(ai.locator("li.navi")).toContainText("Subscribed.");
  expect(await reopened.evaluate(() => (window as unknown as Hooks).navi.lastReply())).toBe("Subscribed.");

  // The rebuilt row still opens and closes.
  await ai.locator(".trace summary").click();
  await expect(ai.locator("li.step").first()).toBeVisible();

  // New commands after the restore start their own card.
  await run(reopened, "scroll up");
  await expect(cards).toHaveCount(4);
  await expect(cards.last().locator("li.navi")).toContainText("Scrolling up");
});

test("a log saved before cards existed is grouped by order, and survives the worker restarting", async ({ panel, context }) => {
  await panel.waitForTimeout(500); // let the greeting's save go first
  await panel.evaluate(() =>
    chrome.storage.session.set({
      panelLog: [
        { kind: "info", text: "Hi! Old greeting." },
        { kind: "user", text: "open the news" },
        { kind: "step", text: "Thinking…" },
        { kind: "step", text: "Opening example.com" },
        { kind: "navi", text: "Opened the news.", meta: "AI · 2 steps · 3.1s · $0.002" },
        { kind: "info", text: "Went to sleep." },
      ],
    }),
  );
  // Chrome stops idle workers; the next one loads the saved log.
  const cdp = await context.newCDPSession(panel);
  await cdp.send("ServiceWorker.enable");
  await cdp.send("ServiceWorker.stopAllWorkers");
  const reopened = await context.newPage();
  await reopened.goto(panel.url());
  await panel.close();
  await reopened.waitForFunction(() => "navi" in window);
  const card = reopened.locator("#log > li.turn");
  await expect(card).toHaveCount(1);
  await expect(card.locator("li.step")).toHaveCount(2);
  await expect(card.locator(".trace-label")).toHaveText("2 steps");
  await expect(card.locator("li.navi")).toContainText("Opened the news.");
  await expect(reopened.locator("#log > li.info")).toHaveText(["Hi! Old greeting.", "Went to sleep."]);
});

test("labels: listening modes and the Flags and Grid toggles", async ({ panel }) => {
  await expect(panel.locator("label:has(input[name=mode][value=handsfree])")).toHaveText("Hey Navi");
  await expect(panel.locator("label:has(input[name=mode][value=open])")).toHaveText("Open mic");
  await expect(panel.locator("#hint-handsfree")).toHaveText("Say “Hey Navi”, then talk.");
  await expect(panel.locator("#hint-open")).toHaveText("Everything is a command until you turn the mic off.");
  await expect(panel.locator("#toggle-numbers")).toHaveText("Flags");
  await expect(panel.locator("#toggle-grid")).toHaveText("Grid");
  await run(panel, "show numbers");
  await expect(panel.locator("#toggle-numbers")).toHaveText("Hide flags");
  await expect(panel.locator("#toggle-numbers")).toHaveAttribute("data-on", "true");
  await run(panel, "hide numbers");
  await expect(panel.locator("#toggle-numbers")).toHaveText("Flags");
});

test.describe("live caption", () => {
  test.use({ fakeMic: true, fakeSpeech: true });

  test("shows what Navi hears in large type, with a clear asleep / listening / off state", async ({ panel }) => {
    await panel.evaluate(() => (window as unknown as Hooks).navi.startListening());
    const voice = panel.locator("#voice");
    await expect(voice).toHaveAttribute("data-state", "sleeping");
    await expect(panel.locator("#status-text")).toHaveText("Asleep");
    await expect(panel.locator("#caption-hint")).toHaveText("Say “Hey Navi”");
    await expect(panel.locator("#mic")).toHaveAttribute("aria-pressed", "true");

    // Before the wake word nothing is shown (or acted on).
    await hear(panel, "so I told my friend");
    await expect(panel.locator("#interim")).toHaveText("");
    await expect(panel.locator("#caption-hint")).toBeVisible();

    await hear(panel, "hey navi", true);
    await expect(voice).toHaveAttribute("data-state", "awake");
    await expect(panel.locator("#status-text")).toHaveText("Listening");
    await expect(panel.locator("#voice .bars")).toBeVisible();

    await hear(panel, "scroll down a");
    await expect(panel.locator("#interim")).toHaveText("scroll down a");
    await expect(panel.locator("#interim")).toBeVisible();
    await expect(panel.locator("#caption-hint")).toBeHidden();
    const size = await panel.locator("#interim").evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(size).toBeGreaterThanOrEqual(18);

    // The final phrase becomes a command card, and the caption clears.
    await hear(panel, "scroll down a little", true);
    await expect(panel.locator("#interim")).toHaveText("");
    await expect(panel.locator("#log > li.turn").last().locator("li.user")).toContainText("scroll down a little");

    await panel.evaluate(() => (window as unknown as Hooks).navi.stopListening());
    await expect(voice).toHaveAttribute("data-state", "off");
    await expect(panel.locator("#status-text")).toHaveText("Mic off");
    await expect(panel.locator("#mic")).toHaveAttribute("aria-pressed", "false");
  });

  test("respects reduced motion", async ({ panel }) => {
    await panel.emulateMedia({ reducedMotion: "reduce" });
    await panel.evaluate(() => (window as unknown as Hooks).navi.startListening());
    await hear(panel, "hey navi", true);
    await hear(panel, "open");
    await expect(panel.locator("#voice .bars")).toBeVisible();
    const moving = await panel.evaluate(() =>
      [...document.querySelectorAll("#voice .bars i, #voice .mic-halo, #status .dot")].filter(
        (el) => getComputedStyle(el).animationName !== "none",
      ).length,
    );
    expect(moving).toBe(0);
  });

  test("dictation: the chat box's mic types what you say instead of running it", async ({ panel }) => {
    const input = panel.locator("#command-input");
    const dictate = panel.locator("#dictate");
    // Listening for the name: dictation borrows the mic, then Navi goes back to waiting for its name.
    await expect(panel.locator("#voice")).toHaveAttribute("data-state", "sleeping");
    await input.fill("remind me to");
    await dictate.click();
    await expect(dictate).toHaveAttribute("aria-pressed", "true");
    await expect(panel.locator("#caption-hint")).toHaveText("Dictating into the chat box…");
    await hear(panel, "scroll down");
    await expect(input).toHaveValue("remind me to scroll down");
    await hear(panel, "scroll down the page", true);
    await expect(input).toHaveValue("remind me to scroll down the page");
    await expect(dictate).toHaveAttribute("aria-pressed", "false");
    await expect(panel.locator("#voice")).toHaveAttribute("data-state", "sleeping");
    // Nothing ran: dictated words aren't commands.
    await expect(panel.locator("#log li.user")).toHaveCount(0);

    // Mic off: dictation turns it on for one phrase, then off again.
    await panel.evaluate(() => (window as unknown as Hooks).navi.stopListening());
    await expect(panel.locator("#voice")).toHaveAttribute("data-state", "off");
    await input.fill("");
    await dictate.click();
    await expect(dictate).toHaveAttribute("aria-pressed", "true");
    await hear(panel, "what is on this page", true);
    await expect(input).toHaveValue("what is on this page");
    await expect(panel.locator("#voice")).toHaveAttribute("data-state", "off");
    await expect(input).toBeFocused();
    await expect(panel.locator("#log li.user")).toHaveCount(0);
  });

  test("with the panel closed, Navi still listens, and a pill on the page shows what it hears and says", async ({
    panel,
    site,
    context,
    extensionId,
  }) => {
    // With the mic allowed, opening the panel starts listening for the name; then close it.
    await expect(panel.locator("#voice")).toHaveAttribute("data-state", "sleeping");
    const ears = await earsPage(panel);
    await panel.close();
    await site.bringToFront();
    const pill = site.locator("navi-pill .pill");
    const text = site.locator("navi-pill .text");
    const badge = () =>
      context.serviceWorkers().find((w) => w.url().includes(extensionId))!.evaluate(() => chrome.action.getBadgeText({}));

    // Asleep: nothing on the page; the toolbar badge says it's waiting.
    await expect.poll(badge).toBe("zz");
    await expect(pill).toHaveCount(0);
    const hear = (words: string, final = false) =>
      ears.evaluate(([t, f]) => (window as unknown as { __hear(t: string, f: boolean): void }).__hear(t, f), [words, final] as const);

    await hear("hey navi", true);
    await expect(pill).toHaveAttribute("data-shown", "true");
    await expect(text).toHaveText("Listening…");
    await expect.poll(badge).toBe("ON");

    await hear("what time");
    await expect(text).toHaveText("what time");
    await hear("what time is it", true);
    await expect(pill).toHaveAttribute("data-kind", "reply");
    await expect(text).toHaveText(/It's \d/);
    // The pill never takes clicks, and the AI never sees it.
    expect(await pill.evaluate((el) => getComputedStyle(el).pointerEvents)).toBe("none");

    // Reopening the panel shows the same command.
    const reopened = await context.newPage();
    await reopened.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await expect(reopened.locator("#log > li.turn").last().locator("li.user")).toContainText("what time is it");
    await expect(reopened.locator("#voice")).toHaveAttribute("data-state", "awake");
  });
});

test.describe("screenshots", () => {
  test.skip(!process.env.NAVI_SCREENSHOTS, "set NAVI_SCREENSHOTS=1 to refresh docs/screenshots/");
  test.use({ fakeMic: true, fakeSpeech: true, deviceScaleFactor: 2 });

  for (const scheme of ["light", "dark"] as const) {
    test(`side panel, ${scheme}`, async ({ panel, context }) => {
      await mkdir(SCREENSHOTS, { recursive: true });
      await panel.setViewportSize({ width: 360, height: 720 });
      await panel.emulateMedia({ colorScheme: scheme });
      let release = () => {};
      const hold = new Promise<void>((resolve) => (release = resolve));
      await mockClaude(context, { routed: { "smash that sub": "click subscribe" }, reply: "Subscribed to Navi Test Page.", hold });
      await useClaude(panel, "claude-sonnet-5-5");
      // With the mic allowed, opening the panel starts listening for the wake word.
      await expect(panel.locator("#voice")).toHaveAttribute("data-state", "sleeping");
      await hear(panel, "hey navi", true);

      await run(panel, "scroll down");
      await run(panel, "yo smash that sub thingy");
      const working = run(panel, "subscribe to this channel for me");
      await expect(panel.locator("#log > li.turn").last().locator(".trace-label")).toHaveText("Step 2…");
      await hear(panel, "and then open the latest vid");
      await panel.waitForTimeout(300);
      await panel.screenshot({ path: path.join(SCREENSHOTS, `panel-working-${scheme}.png`) });

      release();
      await working;
      // (Speech heard while Navi talks is ignored, so wait for the reply to finish.)
      await expect.poll(() => panel.evaluate(() => (window as unknown as Hooks).navi.speaker.busy)).toBe(false);
      await hear(panel, "");
      await panel.locator("#log > li.turn").last().locator(".trace summary").click();
      await panel.mouse.move(0, 0);
      await panel.waitForTimeout(300);
      await panel.screenshot({ path: path.join(SCREENSHOTS, `panel-done-${scheme}.png`) });
    });
  }
});
