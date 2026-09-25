// Loads the built extension (dist/) into Chromium and drives it through the
// side panel's command pipeline against local test pages.

import { type BrowserContext, type Page, chromium, expect, test as base } from "@playwright/test";
import { createServer, type Server } from "node:http";
import { mkdtemp, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";

import { tmpdir } from "node:os";
import path from "node:path";

const DIST = path.resolve("dist");
const FIXTURES = path.resolve("tests/fixtures");
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
};

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
  baseUrl: async ({}, use) => {
    const { server, baseUrl } = await startServer();
    await use(baseUrl);
    server.close();
  },
  context: async ({ fakeMic }, use) => {
    const userDataDir = await mkdtemp(path.join(tmpdir(), "navi-e2e-"));
    const media = fakeMic ? ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] : [];
    const context = await chromium.launchPersistentContext(userDataDir, {
      executablePath: CHROMIUM,
      headless: true,
      args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`, ...media],
    });
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

async function run(panel: Page, command: string) {
  await panel.evaluate((text) => (window as unknown as { navi: { run(t: string): Promise<void> } }).navi.run(text), command);
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
  await panel.evaluate(() => chrome.storage.local.set({ settings: { apiKey: "sk-ant-test", model: "claude-opus-5-5", routerModel: "claude-sonnet-5" } }));
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
  await expect(reopened.locator("#log li.info").filter({ hasText: "Hi!" })).toHaveCount(1);
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
    chrome.storage.local.set({ settings: { apiKey: "sk-ant-test", model: "claude-opus-5-5", routerModel: "claude-sonnet-5", blockedSites: ["localhost"] } }),
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

test("mouse grid: zoom in by numbers and click an exact spot", async ({ panel, site }) => {
  const target = await site.evaluate(() => {
    const r = document.getElementById("signin")!.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: innerWidth, h: innerHeight };
  });
  // Work out which blocks a person would say to reach the button.
  const path: number[] = [];
  let region = { x: 0, y: 0, w: target.w, h: target.h };
  for (let level = 0; level < 4; level++) {
    const col = Math.min(2, Math.floor(((target.x - region.x) / region.w) * 3));
    const row = Math.min(2, Math.floor(((target.y - region.y) / region.h) * 3));
    path.push(row * 3 + col + 1);
    region = { x: region.x + (col * region.w) / 3, y: region.y + (row * region.h) / 3, w: region.w / 3, h: region.h / 3 };
  }
  await run(panel, "show grid");
  expect(await site.evaluate(() => !!document.querySelector("navi-grid"))).toBe(true);
  for (const n of path) await run(panel, String(n));
  await run(panel, "click");
  await expect(site.locator("#result")).toHaveText("signed in");
  expect(await site.evaluate(() => !!document.querySelector("navi-grid"))).toBe(false);
  // "go back" after the grid closes means browser back again, not zoom out.
  await run(panel, "show grid");
  await run(panel, "5");
  await run(panel, "go back");
  await expect(site).toHaveURL(/index\.html/);
  await run(panel, "hide grid");
  expect(await site.evaluate(() => !!document.querySelector("navi-grid"))).toBe(false);
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
  await panel.evaluate(() => chrome.storage.local.set({ settings: { apiKey: "sk-ant-test", model: "claude-opus-5-5", routerModel: "claude-sonnet-5" } }));
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
  await panel.evaluate(() => chrome.storage.local.set({ settings: { apiKey: "sk-ant-test", model: "claude-opus-5-5", routerModel: "claude-sonnet-5" } }));
  await panel.waitForFunction(() => document.getElementById("key-banner")?.hidden === true);
  await run(panel, "yo can you smash that sub thingy");
  // The router runs without extended thinking so it stays fast.
  expect(bodies[0].thinking).toEqual({ type: "disabled" });
  await expect(site.locator("#subs")).toHaveText("1");
  expect(models).toEqual(["claude-sonnet-5"]);
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
  await panel.evaluate(() => chrome.storage.local.set({ settings: { apiKey: "sk-ant-test", model: "claude-opus-5-5", routerModel: "claude-sonnet-5" } }));
  await panel.waitForFunction(() => document.getElementById("key-banner")?.hidden === true);
  const final = (text: string) =>
    panel.evaluate((t) => (window as unknown as { navi: { handleFinal(t: string): void } }).navi.handleFinal(t), text);
  await final("hey navi");
  // Keyboard clatter: caught locally, no API call at all.
  await final("tiktok tiktok tiktok");
  await expect(panel.locator("#log li.step").filter({ hasText: "Ignored “tiktok tiktok tiktok”" })).toHaveCount(1);
  expect(models).toEqual([]);
  // Someone talking nearby: the quick model says ignore, the main model is never called.
  await final("and then she told me the car was still in the shop");
  await expect(panel.locator("#log li.step").filter({ hasText: "Ignored “and then she told me" })).toHaveCount(1);
  expect(models).toEqual(["claude-sonnet-5"]);
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
  await expect(panel.locator("#log li.navi").last()).toContainText("$0.0002");
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
    chrome.storage.local.set({ settings: { openaiKey: "sk-openai-test", model: "gpt-6-sol", effort: "low", routerModel: "off" } }),
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

test("GPT: a missing OpenAI key skips the router and explains what's needed", async ({ panel, context }) => {
  let calls = 0;
  await context.route("https://api.openai.com/**", (route) => {
    calls++;
    return route.abort();
  });
  await panel.evaluate(() => chrome.storage.local.set({ settings: { model: "gpt-6-sol", routerModel: "gpt-6-luna" } }));
  await panel.waitForFunction(() => document.getElementById("key-banner")?.hidden === false);
  await run(panel, "which of these plans is the best deal");
  await expect(panel.locator("#log li.step").last()).toContainText("add an AI API key");
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

test.describe("ElevenLabs speech", () => {
  test.use({ fakeMic: true });

  type Hooks = {
    navi: {
      handleFinal(t: string): void;
      chromeFinal(t: string, c: number): void;
      feedScribe(level: number, chunks: number): void;
      startListening(): Promise<void>;
      stopListening(): void;
      scribeLive: boolean;
      speaker: { busy: boolean };
      session: { current: string };
    };
  };

  /** 0.4 s of a quiet 440 Hz tone as 24 kHz 16-bit PCM, like ElevenLabs' pcm_24000 stream. */
  function tonePcm(): Buffer {
    const samples = 24000 * 0.4;
    const buf = Buffer.alloc(samples * 2);
    for (let i = 0; i < samples; i++) buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / 24000) * 3000), i * 2);
    return buf;
  }

  test("awake commands are transcribed by Scribe; replies stream from ElevenLabs", async ({ panel: firstPanel, context }) => {
    const sockets: string[] = [];
    const tts: { url: string; body: Record<string, unknown>; key?: string }[] = [];
    let chunks = 0;
    let tokenKey = "";
    await context.route("https://api.elevenlabs.io/v1/single-use-token/realtime_scribe", (route) => {
      tokenKey = route.request().headers()["xi-api-key"] ?? "";
      return route.fulfill({ json: { token: "single-use-test-token" } });
    });
    await context.route("https://api.elevenlabs.io/v1/text-to-speech/**", (route) => {
      tts.push({
        url: route.request().url(),
        body: route.request().postDataJSON() as Record<string, unknown>,
        key: route.request().headers()["xi-api-key"],
      });
      return route.fulfill({ status: 200, contentType: "application/octet-stream", body: tonePcm() });
    });
    await context.routeWebSocket(/api\.elevenlabs\.io/, (ws) => {
      sockets.push(ws.url());
      let answered = false;
      ws.onMessage((message) => {
        const data = JSON.parse(String(message)) as { message_type: string; audio_base_64?: string };
        if (data.message_type !== "input_audio_chunk") return;
        chunks++;
        // 100 ms of 16 kHz 16-bit mono per chunk.
        expect(Buffer.from(data.audio_base_64 ?? "", "base64").length).toBe(3200);
        if (answered) return;
        answered = true;
        ws.send(JSON.stringify({ message_type: "partial_transcript", text: "what time" }));
        ws.send(JSON.stringify({ message_type: "committed_transcript", text: "what time is it" }));
      });
    });

    await firstPanel.evaluate(() => chrome.storage.local.set({ settings: { elevenLabsKey: "el-test-key" } }));
    // WebSocket routes only apply to pages opened after they're registered, so use a fresh panel.
    await firstPanel.evaluate(() => (window as unknown as Hooks).navi.stopListening());
    const panel = await context.newPage();
    await panel.goto(firstPanel.url());
    await firstPanel.close();
    await panel.waitForFunction(() => "navi" in window);
    await panel.evaluate(() => (window as unknown as Hooks).navi.startListening());
    // Asleep: Chrome's on-device recognizer listens for the name; nothing goes to ElevenLabs.
    await panel.waitForTimeout(300);
    expect(sockets).toHaveLength(0);

    await panel.evaluate(() => (window as unknown as Hooks).navi.chromeFinal("hey navi", 0.9));
    // Awake but quiet: no connection, so nothing is billed.
    await panel.waitForTimeout(600);
    expect(sockets).toHaveLength(0);
    // Speaking opens the connection and sends the speech, including the moment before it was detected.
    await panel.evaluate(() => (window as unknown as Hooks).navi.feedScribe(0.3, 8));
    await expect.poll(() => sockets.length).toBe(1);
    const url = new URL(sockets[0]);
    expect(url.pathname).toBe("/v1/speech-to-text/realtime");
    expect(url.searchParams.get("model_id")).toBe("scribe_v2_realtime");
    expect(url.searchParams.get("token")).toBe("single-use-test-token");
    expect(url.searchParams.get("filter_background_audio")).toBe("true");
    expect(url.searchParams.get("audio_format")).toBe("pcm_16000");
    expect(url.searchParams.getAll("keyterms")).toContain("Navi");
    // The key only goes in the token request header, never in the socket URL.
    expect(tokenKey).toBe("el-test-key");
    expect(sockets[0]).not.toContain("el-test-key");

    // Scribe's transcript runs as a command, and the answer is spoken with ElevenLabs.
    await expect(panel.locator("#log li.navi").last()).toContainText(/It's \d/);
    await expect.poll(() => tts.length).toBe(1);
    expect(tts[0].url).toContain("/v1/text-to-speech/EXAVITQu4vr4xnSDxMaL/stream");
    expect(tts[0].url).toContain("output_format=pcm_24000");
    expect(tts[0].body.model_id).toBe("eleven_flash_v2_5");
    expect(String(tts[0].body.text)).toMatch(/It's \d/);
    expect(tts[0].key).toBe("el-test-key");
    expect(chunks).toBeGreaterThan(0);
    // No ElevenLabs errors or fallbacks. (Chrome's own recognizer can't reach Google in CI.)
    await expect(panel.locator("#log li.error").filter({ hasNotText: "Speech service unreachable" })).toHaveCount(0);

    // The streamed reply plays to the end, then Navi listens again.
    await expect.poll(() => panel.evaluate(() => (window as unknown as Hooks).navi.speaker.busy)).toBe(false);

    // While ElevenLabs is transcribing, Chrome's copy of the same speech is ignored.
    const before = await panel.locator("#log li").count();
    await panel.evaluate(() => (window as unknown as Hooks).navi.chromeFinal("what time is it", 0.9));
    await panel.waitForTimeout(300);
    expect(await panel.locator("#log li").count()).toBe(before);

    // Sleeping closes the ElevenLabs connection.
    await panel.evaluate(() => (window as unknown as Hooks).navi.handleFinal("go to sleep"));
    await expect.poll(() => panel.evaluate(() => (window as unknown as Hooks).navi.scribeLive)).toBe(false);
  });

  test("a rejected key falls back to Chrome's recognizer and voice", async ({ panel, context }) => {
    await context.route("https://api.elevenlabs.io/**", (route) =>
      route.fulfill({ status: 401, json: { detail: { status: "invalid_api_key" } } }),
    );
    await panel.evaluate(() => chrome.storage.local.set({ settings: { elevenLabsKey: "bad-key" } }));
    await panel.evaluate(() => (window as unknown as Hooks).navi.startListening());
    await panel.evaluate(() => (window as unknown as Hooks).navi.chromeFinal("hey navi", 0.9));
    await panel.evaluate(() => (window as unknown as Hooks).navi.feedScribe(0.3, 8));
    await expect(panel.locator("#log li.error").filter({ hasText: "Using Chrome's speech recognition" })).toHaveCount(1);
    expect(await panel.evaluate(() => (window as unknown as Hooks).navi.scribeLive)).toBe(false);

    // Chrome's recognizer now handles commands, and replies use Chrome's voice.
    await panel.evaluate(() => (window as unknown as Hooks).navi.chromeFinal("what time is it", 0.9));
    await expect(panel.locator("#log li.navi").last()).toContainText(/It's \d/);
    await expect(panel.locator("#log li.error").filter({ hasText: "Using Chrome's voice" })).toHaveCount(1);
  });
});
