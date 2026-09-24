// NaviBench: runs voice-command tasks against small local web apps (bench/sites)
// through the real extension, and reports task success, latency, and steps per model.
//
//   npm run build
//   ANTHROPIC_API_KEY=sk-ant-... node scripts/bench.mjs --models claude-opus-5,claude-haiku-4-5
//
// Options: --models a,b  --tasks id1,id2  --repeat N  --effort low|medium|high  --mock (no API calls)
import { chromium } from "@playwright/test";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, arg, i, all) => {
    if (arg.startsWith("--")) acc.push([arg.slice(2), all[i + 1]?.startsWith("--") ? true : all[i + 1] ?? true]);
    return acc;
  }, []),
);
const mock = !!args.mock;
const models = String(args.models ?? "claude-opus-5").split(",");
const repeat = Number(args.repeat ?? 1);
const effort = String(args.effort ?? "low");
const apiKey = process.env.ANTHROPIC_API_KEY ?? (mock ? "sk-ant-mock" : "");
if (!apiKey) {
  console.error("Set ANTHROPIC_API_KEY (or pass --mock to check the harness without API calls).");
  process.exit(1);
}
if (!existsSync("dist/manifest.json")) {
  console.error("Run `npm run build` first.");
  process.exit(1);
}

let tasks = JSON.parse(await readFile("bench/tasks.json", "utf8"));
if (args.tasks) {
  const wanted = new Set(String(args.tasks).split(","));
  tasks = tasks.filter((t) => wanted.has(t.id));
}

const server = createServer(async (req, res) => {
  const file = path.basename(new URL(req.url ?? "/", "http://x").pathname) || "inbox.html";
  try {
    res.writeHead(200, { "content-type": "text/html" }).end(await readFile(path.join("bench/sites", file)));
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://localhost:${server.address().port}`;

const sandboxChromium = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const context = await chromium.launchPersistentContext(await mkdtemp(path.join(tmpdir(), "navibench-")), {
  executablePath: process.env.NAVI_CHROMIUM ?? (existsSync(sandboxChromium) ? sandboxChromium : undefined),
  headless: !args.headed,
  viewport: { width: 1280, height: 800 },
  args: [`--disable-extensions-except=${path.resolve("dist")}`, `--load-extension=${path.resolve("dist")}`],
});
if (mock) {
  await context.route("https://api.anthropic.com/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "msg_mock", type: "message", role: "assistant", model: "mock", stop_reason: "end_turn", stop_sequence: null,
        content: [{ type: "text", text: "Mock reply." }], usage: { input_tokens: 1, output_tokens: 1 },
      }),
    }),
  );
}

let [worker] = context.serviceWorkers();
worker ??= await context.waitForEvent("serviceworker");
const extId = new URL(worker.url()).host;
for (const p of context.pages()) if (p.url().includes("setup.html")) await p.close();
const site = context.pages()[0] ?? (await context.newPage());
await site.goto(`${base}/inbox.html`);
const panel = await context.newPage();
await panel.goto(`chrome-extension://${extId}/sidepanel.html`);
await panel.waitForFunction(() => "navi" in window);
await panel.evaluate(() => (window.navi.speaker.muted = true));

const results = [];
for (const model of models) {
  await panel.evaluate(
    (s) => chrome.storage.local.set({ settings: s }),
    { apiKey, model, effort, listenMode: "push", feedback: "minimal", maxAgentSteps: 12 },
  );
  await panel.waitForTimeout(200);
  for (const task of tasks) {
    for (let r = 0; r < repeat; r++) {
      await site.bringToFront();
      await site.goto(`${base}/${task.site}`);
      await site.click("body", { position: { x: 1, y: 1 } }).catch(() => undefined);
      await panel.evaluate(() => window.navi.resetConversation());
      const before = await panel.evaluate(() => window.navi.metrics.length);
      const started = Date.now();
      let error = null;
      try {
        for (const command of task.commands) {
          await Promise.race([
            panel.evaluate((c) => window.navi.run(c), command),
            new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 90_000)),
          ]);
          await panel.waitForFunction(() => !window.navi.busy, null, { timeout: 90_000 });
        }
      } catch (err) {
        error = String(err.message ?? err);
      }
      const wallMs = Date.now() - started;
      await site.waitForTimeout(700); // let smooth scrolling and UI updates settle
      const metrics = await panel.evaluate((n) => window.navi.metrics.slice(n), before);
      const reply = await panel.evaluate(() => window.navi.lastReply());
      let success = false;
      try {
        if (task.check.page) success = await site.evaluate((expr) => Boolean(eval(expr)), task.check.page);
        if (task.check.reply) success = new RegExp(task.check.reply, "i").test(reply);
      } catch {
        success = false;
      }
      const row = {
        model,
        task: task.id,
        success,
        paths: metrics.map((m) => m.path).join("+"),
        ms: metrics.reduce((sum, m) => sum + m.ms, 0),
        wallMs,
        steps: metrics.reduce((sum, m) => sum + (m.steps ?? 0), 0),
        reply: reply.slice(0, 160),
        error: error ?? metrics.find((m) => m.error)?.error ?? null,
      };
      results.push(row);
      console.log(`${success ? "PASS" : "FAIL"}  ${model.padEnd(18)} ${task.id.padEnd(24)} ${String(row.ms).padStart(6)} ms  ${row.paths}${row.error ? `  (${row.error})` : ""}`);
    }
  }
}

await context.close();
server.close();

const median = (xs) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : 0);
const lines = ["| Model | Success | Median latency | Median AI steps | Fast-path tasks |", "|---|---|---|---|---|"];
for (const model of models) {
  const rows = results.filter((r) => r.model === model);
  const ok = rows.filter((r) => r.success).length;
  const ai = rows.filter((r) => r.paths.includes("ai"));
  lines.push(
    `| ${model} | ${ok}/${rows.length} (${Math.round((ok / Math.max(rows.length, 1)) * 100)}%) | ${(median(rows.map((r) => r.ms)) / 1000).toFixed(2)} s | ${median(ai.map((r) => r.steps))} | ${rows.filter((r) => r.paths && !r.paths.includes("ai")).length} |`,
  );
}
console.log(`\n${lines.join("\n")}`);
await mkdir("bench-results", { recursive: true });
const out = `bench-results/navibench-${new Date().toISOString().replace(/[:.]/g, "-")}${mock ? "-mock" : ""}.json`;
await writeFile(out, JSON.stringify({ models, effort, repeat, results }, null, 2));
console.log(`\nSaved ${out}`);
