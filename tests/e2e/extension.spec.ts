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

type Fixtures = { context: BrowserContext; extensionId: string; baseUrl: string; site: Page; panel: Page };

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
  baseUrl: async ({}, use) => {
    const { server, baseUrl } = await startServer();
    await use(baseUrl);
    server.close();
  },
  context: async ({}, use) => {
    const userDataDir = await mkdtemp(path.join(tmpdir(), "navi-e2e-"));
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
  await panel.evaluate(() => chrome.storage.local.set({ settings: { apiKey: "sk-ant-test" } }));
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
    chrome.storage.local.set({ settings: { apiKey: "sk-ant-test", blockedSites: ["localhost"] } }),
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
  await panel.evaluate(() => chrome.storage.local.set({ settings: { apiKey: "sk-ant-test", fastMode: true, routerModel: "off" } }));
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
  await panel.evaluate(() => chrome.storage.local.set({ settings: { apiKey: "sk-ant-test", routerModel: "off" } }));
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
  await panel.evaluate(() => chrome.storage.local.set({ settings: { apiKey: "sk-ant-test" } }));
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
  await panel.evaluate(() => chrome.storage.local.set({ settings: { apiKey: "sk-ant-test" } }));
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
  await panel.evaluate(() => chrome.storage.local.set({ settings: { apiKey: "sk-ant-test" } }));
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
