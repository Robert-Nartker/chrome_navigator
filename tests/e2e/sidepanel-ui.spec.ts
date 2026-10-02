// The side panel's view: live caption, command cards with collapsible steps, labels, and the log restore.
// Set NAVI_SCREENSHOTS=1 to also save the screenshots in docs/screenshots/.

import { type BrowserContext, type Page, type Route, chromium, expect, test as base } from "@playwright/test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";

import { tmpdir } from "node:os";
import path from "node:path";

import { installFakeRecognizer } from "./fake-speech";
import { CHROMIUM, startServer } from "./helpers";

const DIST = path.resolve("dist");
const SCREENSHOTS = path.resolve("docs/screenshots");

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
  /** With fakeMic: the microphone plays this WAV file once instead of a tone. */
  micFile: string | undefined;
};

const test = base.extend<Fixtures>({
  fakeMic: [false, { option: true }],
  fakeSpeech: [false, { option: true }],
  micFile: [undefined, { option: true }],
  baseUrl: async ({}, use) => {
    const { server, baseUrl } = await startServer();
    await use(baseUrl);
    server.close();
  },
  context: async ({ fakeMic, fakeSpeech, micFile, deviceScaleFactor }, use) => {
    const userDataDir = await mkdtemp(path.join(tmpdir(), "navi-e2e-"));
    const media = fakeMic
      ? [
          "--use-fake-device-for-media-stream",
          "--use-fake-ui-for-media-stream",
          ...(micFile ? [`--use-file-for-fake-audio-capture=${micFile}%noloop`] : []),
        ]
      : [];
    const context = await chromium.launchPersistentContext(userDataDir, {
      executablePath: CHROMIUM,
      headless: true,
      deviceScaleFactor,
      args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`, ...media],
    });
    if (fakeSpeech) await context.addInitScript(installFakeRecognizer, "available");
    // Navi's on-device voice downloads its model from Hugging Face; tests never do.
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

type Hooks = {
  navi: {
    run(t: string, source?: "typed" | "voice"): Promise<void>;
    lastReply(): string;
    startListening(): Promise<void>;
    stopListening(): void;
    lastSaid: Promise<string>;
    speaker: { busy: boolean };
  };
};

const lastSaid = (panel: Page) => panel.evaluate(() => (window as unknown as Hooks).navi.lastSaid);

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
      // Only what was just heard counts, not the recent commands listed before it.
      const said = JSON.stringify(body.messages).match(/Heard: \\"(.*?)\\"/)?.[1] ?? "";
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

test("a reply that only confirms is shown with a chime, not read aloud; an answer is read aloud", async ({ panel, site, context }) => {
  await mockClaude(context, { reply: "[done] Subscribed to the channel." });
  await useClaude(panel);
  await run(panel, "hit the subscribe thing for me");
  await expect(site.locator("#subs")).toHaveText("1");
  const reply = panel.locator("#log > li.turn").last().locator("li.navi");
  await expect(reply).toContainText("Subscribed to the channel.");
  await expect(reply).not.toContainText("[done]");
  await panel.waitForTimeout(300);
  expect(await lastSaid(panel)).not.toContain("Subscribed");

  await context.unroute("https://api.anthropic.com/**");
  await mockClaude(context, { reply: "Done, and you now follow 2 channels." });
  await run(panel, "hit the subscribe thing again");
  await expect.poll(() => lastSaid(panel)).toContain("you now follow 2 channels");
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
  await expect(panel.locator("#status-text")).toHaveText("Off");
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
  await expect(panel.locator("#log li.user .text").filter({ hasText: "scroll down" })).toHaveCount(0);
  await expect(panel.locator("#status-text")).toHaveText("Off");
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
  await expect(panel.locator("#log li.navi .text").last()).toContainText("Subscribed.");

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
    chrome.storage.local.set({
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

test.describe("threads", () => {
  type Chat = { asked: string; users: string[] };
  /**
   * Mocks Claude as a chat: it answers "Answer to: <what was asked>", and records each request's user
   * messages. Answers to questions containing `slow` wait for `hold`.
   */
  async function mockChat(context: BrowserContext, opts: { slow?: string; hold?: Promise<void> } = {}) {
    const chats: Chat[] = [];
    await context.route("https://api.anthropic.com/**", async (route: Route) => {
      const body = route.request().postDataJSON() as { model: string; messages: { role: string; content: unknown }[] };
      const text = (c: unknown) =>
        typeof c === "string" ? c : Array.isArray(c) ? c.map((b: { text?: string }) => b.text ?? "").join("") : "";
      const users = body.messages.filter((m) => m.role === "user").map((m) => text(m.content)).filter(Boolean);
      const asked = /(?:Typed message|Command): "(.*)"/.exec(users.at(-1) ?? "")?.[1] ?? "";
      chats.push({ asked, users });
      if (opts.slow && asked.includes(opts.slow)) await opts.hold;
      await route
        .fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            id: "msg", type: "message", role: "assistant", model: body.model, stop_sequence: null, stop_reason: "end_turn",
            usage: { input_tokens: 900, output_tokens: 20 },
            content: [{ type: "text", text: `Answer to: ${asked}` }],
          }),
        })
        .catch(() => undefined);
    });
    return chats;
  }
  const type = (panel: Page, text: string) => panel.evaluate((t) => (window as unknown as Hooks).navi.run(t, "typed"), text);
  const feedText = (panel: Page) => panel.locator("#log").innerText();

  test("each thread has its own feed and AI conversation: new thread, back by name, list", async ({ panel, context }) => {
    const chats = await mockChat(context);
    await useClaude(panel);
    await type(panel, "my favorite color is green");
    await expect(panel.locator("#thread-title")).toHaveText("My favorite color is green");

    // A new thread starts empty, with a fresh conversation (said, so no AI call for the command itself).
    await run(panel, "new thread");
    await expect(panel.locator("#thread-title")).toHaveText("New thread");
    await expect(panel.locator("#log > li")).toHaveCount(0);
    await expect(panel.locator("#feed-empty")).toBeVisible();
    expect(chats).toHaveLength(1);
    await type(panel, "what's my favorite color?");
    expect(chats[1].users).toHaveLength(1);
    expect(chats[1].users[0]).not.toContain("green");
    await expect(panel.locator("#feed-empty")).toBeHidden();
    expect(await feedText(panel)).not.toContain("my favorite color is green");

    // Back by name: its feed, and the same conversation continues.
    await run(panel, "go back to the favorite color thread");
    await expect(panel.locator("#thread-title")).toHaveText("My favorite color is green");
    await expect(panel.locator("#log li.user .text")).toHaveText(["my favorite color is green"]);
    await type(panel, "and my favorite food is pizza");
    expect(chats[2].users.map((u) => /"(.*)"/.exec(u)?.[1])).toEqual(["my favorite color is green", "and my favorite food is pizza"]);

    // "Previous thread" goes to the one used before; asking for an unknown one lists them.
    await run(panel, "previous thread");
    await expect(panel.locator("#thread-title")).toHaveText("What's my favorite color");
    await run(panel, "switch to the taxes thread");
    await expect(panel.locator("#log > li.solo.navi .text").last()).toHaveText(
      "I couldn't tell which thread you meant by “taxes”. Your threads: What's my favorite color, My favorite color is green.",
    );
    await expect.poll(() => lastSaid(panel)).toContain("I couldn't tell which thread");
    await run(panel, "list my threads");
    await expect(panel.locator("#log > li.solo.navi .text").last()).toHaveText(
      "You have 2 threads: What's my favorite color (this one), My favorite color is green.",
    );
    await run(panel, "rename this thread to quiz");
    await expect(panel.locator("#thread-title")).toHaveText("Quiz");

    // Once a thread's conversation has expired, the AI gets a recap of it instead.
    await run(panel, "go to the first thread");
    await panel.evaluate(() => (window as unknown as { navi: { resetConversation(): Promise<void> } }).navi.resetConversation());
    await type(panel, "what did I tell you?");
    const recap = chats.at(-1)!;
    expect(recap.users).toHaveLength(1);
    expect(recap.users[0]).toContain("Earlier in this thread (“My favorite color is green”), oldest first:\nUser: my favorite color is green\nNavi: Answer to: my favorite color is green\nUser: and my favorite food is pizza");
  });

  test("a task keeps running in its own thread while you start another; the next command waits its turn", async ({ panel, context }) => {
    let release = () => {};
    const hold = new Promise<void>((resolve) => (release = resolve));
    const chats = await mockChat(context, { slow: "research standing desks", hold });
    await useClaude(panel);
    const first = type(panel, "research standing desks");
    await expect(panel.locator("#log > li.turn")).toHaveAttribute("data-state", "working");

    // "New thread" said while it works: it doesn't wait. The running task is named, and can't be deleted.
    await run(panel, "new thread");
    await expect(panel.locator("#thread-title")).toHaveText("New thread");
    await expect(panel.locator("#thread-running")).toHaveText("Working in “Research standing desks”");
    await panel.locator("#thread-current").click();
    const menu = panel.locator("#thread-list li");
    await expect(menu).toHaveCount(2);
    await expect(menu.filter({ hasText: "Research standing desks" }).locator(".when")).toHaveText("working");
    await expect(menu.filter({ hasText: "Research standing desks" }).getByRole("button", { name: /^Delete/ })).toBeDisabled();
    await panel.keyboard.press("Escape");
    await expect(panel.locator("#thread-menu")).toBeHidden();

    // Typed here meanwhile: noted here, and run here once the task is done, even after switching away.
    const second = type(panel, "what time is it in tokyo");
    await expect(panel.locator("#log > li.solo.info .text")).toHaveText("Next: “what time is it in tokyo”");
    expect(chats).toHaveLength(1);
    await panel.locator("#thread-running").click();
    await expect(panel.locator("#thread-title")).toHaveText("Research standing desks");
    // Its card is still working.
    await expect(panel.locator("#log > li.turn")).toHaveAttribute("data-state", "working");
    release();
    await first;
    await second;
    await expect(panel.locator("#log li.navi .text")).toHaveText(["Answer to: research standing desks"]);
    await expect(panel.locator("#log > li.turn")).toHaveAttribute("data-state", "done");
    expect(await feedText(panel)).not.toContain("tokyo");
    expect(chats[1]).toMatchObject({ asked: "what time is it in tokyo" });
    // A fresh conversation: nothing from the desk research.
    expect(chats[1].users).toHaveLength(1);
    expect(chats[1].users[0]).not.toContain("desks");
    await expect(panel.locator("#thread-running")).toBeHidden();

    await panel.locator("#thread-current").click();
    await panel.locator(".thread-pick", { hasText: "What time is it in tokyo" }).click();
    await expect(panel.locator("#thread-menu")).toBeHidden();
    await expect(panel.locator("#log li.navi .text")).toHaveText(["Answer to: what time is it in tokyo"]);
  });

  test("threads and their feeds survive the worker restarting and the panel reopening; deleting one forgets its feed", async ({ panel, context }) => {
    await mockChat(context);
    await useClaude(panel);
    await type(panel, "plan a trip to denver");
    // The panel's + starts a thread too.
    await panel.locator("#thread-new").click();
    await expect(panel.locator("#thread-title")).toHaveText("New thread");
    await expect(panel.locator("#command-input")).toBeFocused();
    await run(panel, "rename this thread to taxes");
    await expect(panel.locator("#thread-title")).toHaveText("Taxes");
    await type(panel, "when are taxes due");
    await panel.waitForTimeout(500); // saves are batched

    const cdp = await context.newCDPSession(panel);
    await cdp.send("ServiceWorker.enable");
    await cdp.send("ServiceWorker.stopAllWorkers");
    const reopened = await context.newPage();
    await reopened.goto(panel.url());
    await panel.close();
    await reopened.waitForFunction(() => "navi" in window);
    await expect(reopened.locator("#thread-title")).toHaveText("Taxes");
    await expect(reopened.locator("#log li.user .text")).toHaveText(["when are taxes due"]);

    await reopened.locator("#thread-current").click();
    await reopened.getByRole("button", { name: "Delete thread Taxes" }).click();
    await expect(reopened.locator("#thread-title")).toHaveText("Plan a trip to denver");
    await expect(reopened.locator("#log li.user .text")).toHaveText(["plan a trip to denver"]);
    await expect(reopened.locator("#thread-list li")).toHaveCount(1);
    await reopened.waitForTimeout(500);
    const saved = await reopened.evaluate(async () => (await chrome.storage.local.get("panelLog")).panelLog as { text: string }[]);
    expect(saved.map((e) => e.text)).not.toContain("when are taxes due");
  });
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
    // A finished phrase without the name shows briefly, so a missed "Hey Navi" is easy to spot.
    await hear(panel, "so I told my friend", true);
    await expect(panel.locator("#caption-hint")).toHaveText("Heard “so I told my friend”. Start with “Hey Navi”.");
    await expect(panel.locator("#log li.user .text").filter({ hasText: "so I told my friend" })).toHaveCount(0);

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
    await expect(panel.locator("#status-text")).toHaveText("Off");
    await expect(panel.locator("#mic")).toHaveAttribute("aria-pressed", "false");
  });

  test("“stop” on its own ends a task any time, even asleep and without the name", async ({ panel, context }) => {
    let release = () => {};
    const hold = new Promise<void>((resolve) => (release = resolve));
    await mockClaude(context, { hold });
    await useClaude(panel);
    await panel.evaluate(() => (window as unknown as Hooks).navi.startListening());
    await expect(panel.locator("#voice")).toHaveAttribute("data-state", "sleeping");
    const working = run(panel, "hit the subscribe thing for me");
    const card = panel.locator("#log > li.turn").last();
    await expect(card.locator(".trace-label")).toHaveText("Step 2…");
    await hear(panel, "Stop.", true);
    await working;
    await expect(card.locator("li.info").last()).toContainText("Cancelled.");
    await expect(card).toHaveAttribute("data-state", "done");
    release();
  });

  test("talking over Navi cuts its reply short, but its own voice coming back through the mic doesn't", async ({ panel, context }) => {
    const answer =
      "Your inbox has three new emails: one from Sarah about the study session on Thursday, one from Professor Pritchard about the case analysis, and one from Mike about rides to the game on Saturday.";
    await mockClaude(context, { reply: answer });
    await useClaude(panel);
    await panel.evaluate(() => (window as unknown as Hooks).navi.startListening());
    await hear(panel, "hey navi", true);
    const busy = () => panel.evaluate(() => (window as unknown as Hooks).navi.speaker.busy);
    await run(panel, "hit the subscribe thing for me");
    await expect.poll(busy).toBe(true);
    // Its own words: ignored.
    await hear(panel, "one from Sarah about the study session");
    expect(await busy()).toBe(true);
    // The user: Navi stops talking right away (the reply alone lasts several seconds) and runs the new command.
    await hear(panel, "scroll down a");
    await expect.poll(busy, { timeout: 500 }).toBe(false);
    await hear(panel, "scroll down a little", true);
    await expect(panel.locator("#log > li.turn").last().locator("li.user")).toContainText("scroll down a little");
  });

  test("saying “turn off” turns Navi off (not just asleep) and says how to turn it back on", async ({ panel }) => {
    await panel.evaluate(() => (window as unknown as Hooks).navi.startListening());
    await expect(panel.locator("#voice")).toHaveAttribute("data-state", "sleeping");
    await run(panel, "turn off");
    await expect(panel.locator("#status-text")).toHaveText("Off");
    await expect(panel.locator("#log li.navi .text").last()).toContainText("Press Alt+Shift+M or click the mic");
    expect(await lastSaid(panel)).toContain("turn it back on");
    expect(await panel.evaluate(async () => (await chrome.storage.local.get("naviOff")).naviOff)).toBe(true);
    await expect(panel.locator("#caption-hint")).toContainText("stays off, even after Chrome restarts");
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

  test("the talk-now shortcut wakes Navi without its name, and puts it back to sleep", async ({ panel }) => {
    const voice = panel.locator("#voice");
    const shortcut = () => panel.evaluate(() => chrome.runtime.sendMessage({ type: "navi:test", action: "wake" }));
    await expect(voice).toHaveAttribute("data-state", "sleeping");
    await shortcut();
    await expect(voice).toHaveAttribute("data-state", "awake");
    await hear(panel, "scroll down a little", true);
    await expect(panel.locator("#log > li.turn").last().locator("li.user")).toContainText("scroll down a little");
    await shortcut();
    await expect(voice).toHaveAttribute("data-state", "sleeping");
    // Mic off: the shortcut turns it on and listens right away.
    await panel.evaluate(() => (window as unknown as Hooks).navi.stopListening());
    await expect(voice).toHaveAttribute("data-state", "off");
    await shortcut();
    await expect(voice).toHaveAttribute("data-state", "awake");
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
    await expect(panel.locator("#log li.user .text")).toHaveCount(0);

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
    await expect(panel.locator("#log li.user .text")).toHaveCount(0);
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

test.describe("on and off across Chrome restarts", () => {
  /** Chrome with Navi and a fake microphone, on one profile that survives a restart. */
  async function launch(dir: string) {
    const context = await chromium.launchPersistentContext(dir, {
      executablePath: CHROMIUM,
      headless: true,
      args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`, "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
    });
    await context.route("https://huggingface.co/**", (route) => route.abort());
    const isNavi = (w: import("@playwright/test").Worker) => w.url().startsWith("chrome-extension://") && w.url().endsWith("/background.js");
    const worker = context.serviceWorkers().find(isNavi) ?? (await context.waitForEvent("serviceworker", { predicate: isNavi }));
    // Chrome attaches the extension APIs a moment after the worker starts.
    await expect.poll(() => worker.evaluate(() => typeof chrome !== "undefined" && !!chrome.runtime?.sendMessage).catch(() => false)).toBe(true);
    return { context, worker, id: new URL(worker.url()).host };
  }
  const openPanel = async (context: BrowserContext, id: string) => {
    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${id}/sidepanel.html`);
    await panel.waitForFunction(() => "navi" in window);
    return panel;
  };
  const listening = (worker: import("@playwright/test").Worker) =>
    worker.evaluate(async () => (await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT" as chrome.runtime.ContextType] })).length > 0);

  test("Navi listens from the moment Chrome starts, with no clicks; turned off, it stays off until turned on", async () => {
    test.setTimeout(120_000);
    const dir = await mkdtemp(path.join(tmpdir(), "navi-restart-"));

    // First run: once the mic is allowed (setup does this), Navi starts listening by itself.
    let chrome1 = await launch(dir);
    await chrome1.worker.evaluate(() => chrome.runtime.sendMessage({ type: "navi:mic-granted" }).catch(() => undefined));
    await expect.poll(() => listening(chrome1.worker), { timeout: 15_000 }).toBe(true);
    await chrome1.context.close();

    // Chrome starts again: listening with no panel, no click.
    chrome1 = await launch(dir);
    await expect.poll(() => listening(chrome1.worker), { timeout: 15_000 }).toBe(true);
    // Turned off: the mic stops.
    const panel = await openPanel(chrome1.context, chrome1.id);
    await panel.getByRole("button", { name: "Turn Navi off" }).click();
    await expect(panel.locator("#status-text")).toHaveText("Off");
    await chrome1.context.close();

    // Next start: still off, and opening the panel doesn't turn it on.
    const chrome2 = await launch(dir);
    await new Promise((resolve) => setTimeout(resolve, 3000));
    expect(await listening(chrome2.worker)).toBe(false);
    const panel2 = await openPanel(chrome2.context, chrome2.id);
    await panel2.waitForTimeout(1500);
    await expect(panel2.locator("#status-text")).toHaveText("Off");
    expect(await listening(chrome2.worker)).toBe(false);

    // Open mic is for this session only: the next Chrome start listens for the name again.
    await panel2.getByRole("button", { name: "Turn Navi on" }).click();
    await panel2.evaluate(async () => {
      const { settings } = (await chrome.storage.local.get("settings")) as { settings?: Record<string, unknown> };
      await chrome.storage.local.set({ settings: { ...settings, listenMode: "open" } });
    });
    await chrome2.context.close();
    const chrome3 = await launch(dir);
    await expect.poll(() => listening(chrome3.worker), { timeout: 15_000 }).toBe(true);
    const mode = () =>
      chrome3.worker.evaluate(async () => ((await chrome.storage.local.get("settings")) as { settings: { listenMode: string } }).settings.listenMode);
    await expect.poll(mode).toBe("handsfree");
    await chrome3.context.close();
    await rm(dir, { recursive: true, force: true });
  });
});

test.describe("Parakeet recognizer", () => {
  test.use({ fakeMic: true, fakeSpeech: true, micFile: path.resolve("tests/fixtures/speech/three-commands-fan.wav") });

  const ears = (panel: Page, e: Record<string, unknown>) =>
    panel.evaluate((e) => chrome.runtime.sendMessage({ type: "navi:test", action: "ears", ears: { type: "ears:test", ...e } }), e);
  const useParakeet = (panel: Page) =>
    panel.evaluate(() => chrome.storage.local.set({ settings: { recognizer: "parakeet", listenMode: "open" } }));

  test("its speech detector splits the mic into phrases, and each one Parakeet hears runs (model stubbed)", async ({ panel }) => {
    // Hugging Face is out of reach here, so a stub stands in for the model; the mic, the speech detector,
    // live captions and commands are all real. The file: three commands over air-conditioner noise.
    await ears(panel, { action: "fakeParakeet", phrases: ["Scroll down a little.", "Scroll down.", "Go to the top."] });
    await useParakeet(panel);
    await panel.evaluate(() => (window as unknown as Hooks).navi.startListening());
    await expect(panel.locator("#engine-label")).toContainText("Hears: Parakeet (on-device, test model)");
    const said = panel.locator("#log li.user .text");
    await expect(said).toHaveText([/Scroll down a little/, /Scroll down\./, /Go to the top/], { timeout: 20_000 });
    await panel.waitForTimeout(1500);
    await expect(said).toHaveCount(3);
  });

  test("while Parakeet can't download, Chrome's recognizer keeps listening", async ({ panel, context }) => {
    const asked: string[] = [];
    await context.route("https://huggingface.co/**", (route) => {
      asked.push(route.request().url());
      return route.abort();
    });
    await useParakeet(panel);
    await panel.evaluate(() => (window as unknown as Hooks).navi.startListening());
    await expect(panel.locator("#log")).toContainText("Parakeet couldn't load", { timeout: 30_000 });
    await expect(panel.locator("#log")).toContainText("Chrome's recognizer is listening");
    // Its worker and runtime started, and went for the English model's files.
    expect(asked.some((url) => url.includes("parakeet-tdt-0.6b-v2"))).toBe(true);
    await expect(panel.locator("#engine-label")).toContainText("Hears: Chrome");
    await hear(panel, "scroll down a little", true);
    await expect(panel.locator("#log > li.turn").last().locator("li.user")).toContainText("scroll down a little");
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
      // Wait for the reply to finish, so the picture shows Navi idle.
      await expect.poll(() => panel.evaluate(() => (window as unknown as Hooks).navi.speaker.busy)).toBe(false);
      await hear(panel, "");
      await panel.locator("#log > li.turn").last().locator(".trace summary").click();
      await panel.mouse.move(0, 0);
      await panel.waitForTimeout(300);
      await panel.screenshot({ path: path.join(SCREENSHOTS, `panel-done-${scheme}.png`) });
    });
  }
});
