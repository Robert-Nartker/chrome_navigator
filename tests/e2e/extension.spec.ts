// Loads the built extension (dist/) into Chromium and drives it through the
// side panel's command pipeline against local test pages.

import { type BrowserContext, type Page, chromium, expect, test as base } from "@playwright/test";
import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const DIST = path.resolve("dist");
const FIXTURES = path.resolve("tests/fixtures");
const CHROMIUM = process.env.NAVI_CHROMIUM ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

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
  expect(firstReq.body.model).toBe("claude-opus-5");
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
