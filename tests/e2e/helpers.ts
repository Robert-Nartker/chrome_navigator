// Shared by the e2e specs: which Chromium to run, and a tiny web server for the test pages.

import type { BrowserContext, Page } from "@playwright/test";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import path from "node:path";

/** Cloud sandboxes link their preinstalled Chromium here, whatever its version. */
const SANDBOX_CHROMIUM = "/opt/pw-browsers/chromium";
/** Playwright's own Chromium unless NAVI_CHROMIUM (or the sandbox build) is present. */
export const CHROMIUM = process.env.NAVI_CHROMIUM ?? (existsSync(SANDBOX_CHROMIUM) ? SANDBOX_CHROMIUM : undefined);

const FIXTURES = path.resolve("tests/fixtures");

/** Serves tests/fixtures/*.html on localhost (any other path is a 404). */
export function startServer(): Promise<{ server: Server; baseUrl: string }> {
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

/**
 * A tab that opens from now on and reaches an address `matches` accepts. Newer Chrome reports a tab
 * before its address is set, so checking the address when the tab appears can miss it.
 */
export async function openedPage(context: BrowserContext, matches: (url: string) => boolean, timeoutMs = 10_000): Promise<Page> {
  const before = new Set(context.pages());
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const page = context.pages().find((p) => !before.has(p) && matches(p.url()));
    if (page) return page;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("No new tab reached the address the test expected.");
}
