// NaviBench: benchmarks the router (quick model that interprets unrecognized speech) and the
// browser agent (main model), through the real extension, with the API cost of every call.
// Ends with a cost projection for 20 hours of use.
//
//   npm run build
//   node scripts/bench.mjs --dry-run      # estimated cost, no API calls
//   node scripts/bench.mjs --check        # confirm keys and model names (~1 cent)
//   node scripts/bench.mjs                # full run (the estimate is printed first)
//
// Keys come from ANTHROPIC_API_KEY / OPENAI_API_KEY or a .env file in the repo root
// (git-ignored). Models without a key are skipped.
//
// Options:
//   --suite router,agent     which suites to run (default: both)
//   --routers a,b            router models (default: gpt-6-luna,gpt-6-sol,claude-haiku-4-5,claude-sonnet-5)
//   --agents model@effort,…  agent models (default: claude-opus-5-5@low,gpt-6-astra@low,gpt-6-sol@none,gpt-6-sol@low,gpt-6-luna@none)
//   --tasks core|all|id,…    agent tasks (default: core, 8 tasks)
//   --repeat N               runs per task and router phrase (default 1)
//   --budget USD             stop testing a model once it has spent this much (default 1.50)
//   --mock                   fake API replies (no keys, no cost) to test the harness
//   --headed                 show the browser
import { chromium } from "@playwright/test";
import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
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
const suites = new Set(String(args.suite ?? "router,agent").split(","));
const repeat = Number(args.repeat ?? 1);
const budget = Number(args.budget ?? 1.5);
const list = (value, fallback) => String(value ?? fallback).split(",").map((s) => s.trim()).filter(Boolean);
const routerModels = list(args.routers, "gpt-6-luna,gpt-6-sol,claude-haiku-4-5,claude-sonnet-5");
const agentConfigs = list(args.agents, "claude-opus-5-5@low,gpt-6-astra@low,gpt-6-sol@none,gpt-6-sol@low,gpt-6-luna@none").map(
  (spec) => {
    const [model, effort = "low"] = spec.split("@");
    return { model, effort, label: `${model}@${effort}` };
  },
);
const CORE_TASKS = [
  "mail-open-topic", "mail-reply-send", "shop-add-cheapest", "shop-search-add",
  "video-subscribe", "form-fill", "article-summary", "article-injection",
];

/** Usage per hour of active browsing (assumptions; your own usage log gives the real mix). */
const SCENARIOS = [
  { name: "Light", routerCalls: 4, agentTasks: 2, note: "~20 commands/h" },
  { name: "Typical", routerCalls: 8, agentTasks: 5, note: "~40 commands/h" },
  { name: "Heavy", routerCalls: 16, agentTasks: 12, note: "~80 commands/h" },
];
const HOURS = 20;

// ---- Keys ----
function readDotEnv() {
  if (!existsSync(".env")) return {};
  return Object.fromEntries(
    readFileSync(".env", "utf8")
      .split(/\r?\n/)
      .map((line) => line.match(/^\s*([A-Z_]+)\s*=\s*"?([^"#]*)"?\s*$/))
      .filter(Boolean)
      .map((m) => [m[1], m[2].trim()]),
  );
}
const env = { ...readDotEnv(), ...process.env };
const keys = {
  anthropic: env.ANTHROPIC_API_KEY ?? (mock ? "sk-ant-mock" : ""),
  openai: env.OPENAI_API_KEY ?? (mock ? "sk-openai-mock" : ""),
};
const providerOf = (model) => (/^(gpt|o\d|chatgpt)/.test(model) ? "openai" : "anthropic");
const hasKey = (model) => !!keys[providerOf(model)];

if (!existsSync("dist/manifest.json")) {
  console.error("Run `npm run build` first.");
  process.exit(1);
}

// ---- Model name check (free): does each provider list the models we plan to use? ----
async function listProviderModels() {
  const found = {};
  if (keys.openai && !mock) {
    const res = await fetch("https://api.openai.com/v1/models", { headers: { authorization: `Bearer ${keys.openai}` } });
    found.openai = res.ok ? (await res.json()).data.map((m) => m.id) : `error ${res.status}: ${(await res.text()).slice(0, 200)}`;
  }
  if (keys.anthropic && !mock) {
    const res = await fetch("https://api.anthropic.com/v1/models?limit=1000", {
      headers: { "x-api-key": keys.anthropic, "anthropic-version": "2023-06-01" },
    });
    found.anthropic = res.ok ? (await res.json()).data.map((m) => m.id) : `error ${res.status}: ${(await res.text()).slice(0, 200)}`;
  }
  return found;
}

// ---- Browser + extension ----
const server = createServer(async (req, res) => {
  const file = path.basename(new URL(req.url ?? "/", "http://x").pathname) || "inbox.html";
  const body = await readFile(path.join("bench/sites", file)).catch(() => null);
  if (body) res.writeHead(200, { "content-type": "text/html" }).end(body);
  else res.writeHead(404).end();
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
if (mock) await installMocks(context);

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
const catalog = await panel.evaluate(() => window.navi.models);
const priceOf = (model) => catalog.find((m) => m.id === model)?.price;

const baseSettings = { apiKey: keys.anthropic, openaiKey: keys.openai, listenMode: "push", feedback: "minimal", maxAgentSteps: 12 };
async function applySettings(extra) {
  await panel.evaluate((s) => chrome.storage.local.set({ settings: s }), { ...baseSettings, ...extra });
  await panel.waitForTimeout(150);
}

let cases = JSON.parse(await readFile("bench/router-cases.json", "utf8"));
let tasks = JSON.parse(await readFile("bench/tasks.json", "utf8"));
const taskFilter = String(args.tasks ?? "core");
if (taskFilter !== "all") {
  const wanted = new Set(taskFilter === "core" ? CORE_TASKS : taskFilter.split(","));
  tasks = tasks.filter((t) => wanted.has(t.id));
}

const skipped = [...new Set([...routerModels, ...agentConfigs.map((a) => a.model)])].filter((m) => !hasKey(m));
const routers = routerModels.filter(hasKey);
const agents = agentConfigs.filter((a) => hasKey(a.model));
if (skipped.length) console.log(`Skipping (no ${[...new Set(skipped.map(providerOf))].join("/")} key): ${skipped.join(", ")}`);
if (!routers.length && !agents.length) {
  console.error("No API keys found. Put ANTHROPIC_API_KEY=... and/or OPENAI_API_KEY=... in a .env file in the repo root.");
  await context.close();
  server.close();
  process.exit(1);
}

// ---- Cost estimate ----
// Rough per-call token counts, measured from Navi's prompts: router ≈ 1.2k in / 25 out;
// an agent task ≈ 3 steps and ~20k input tokens (about 60% cache hits), output by effort.
const OUT_BY_EFFORT = { none: 150, low: 900, medium: 2500, high: 6000 };
function estimate(model, kind, effort = "none") {
  const p = priceOf(model);
  if (!p) return Number.NaN;
  if (kind === "router") return (1200 * p.input + 25 * p.output) / 1e6;
  return (8000 * p.input + 12000 * p.cachedInput + OUT_BY_EFFORT[effort] * p.output) / 1e6;
}
const money = (usd) => (Number.isFinite(usd) ? (usd < 0.01 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(2)}`) : "$?");

if (args.check) {
  await runCheck();
} else {
  const plan = [];
  if (suites.has("router")) for (const m of routers) plan.push([`router ${m}`, estimate(m, "router") * cases.length * repeat]);
  if (suites.has("agent")) {
    for (const a of agents) plan.push([`agent ${a.label}`, Math.min(budget, estimate(a.model, "agent", a.effort) * tasks.length * repeat)]);
  }
  const total = plan.reduce((sum, [, usd]) => sum + (Number.isFinite(usd) ? usd : 0), 0);
  console.log(`\nEstimated cost (${cases.length} router phrases, ${tasks.length} agent tasks, x${repeat}; each model capped at ${money(budget)}):`);
  for (const [name, usd] of plan) console.log(`  ${name.padEnd(34)} ${money(usd)}`);
  console.log(`  ${"total".padEnd(34)} ~${money(total)}${mock ? " (mock run: nothing is charged)" : ""}\n`);
  if (!args["dry-run"]) {
    const routerRows = suites.has("router") ? await runRouterSuite() : [];
    const agentRows = suites.has("agent") ? await runAgentSuite() : [];
    await report(routerRows, agentRows);
  }
}

await context.close();
server.close();

// ---- Suites ----
async function routeOnce(heard) {
  return Promise.race([
    panel.evaluate((t) => window.navi.route(t), heard),
    new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 20_000)),
  ]);
}

async function runRouterSuite() {
  // Harness sanity: every expected command must be one Navi's fast path understands.
  for (const c of cases.filter((x) => x.expect === "command")) {
    c.intent = await panel.evaluate((t) => window.navi.parse(t), c.command);
    if (!c.intent) console.warn(`  (router case "${c.heard}": expected command "${c.command}" doesn't parse)`);
  }
  const rows = [];
  for (const model of routers) {
    await applySettings({ routerModel: model });
    let spent = 0;
    for (const c of cases) {
      for (let r = 0; r < repeat; r++) {
        if (spent > budget) break;
        let row;
        try {
          const res = await routeOnce(c.heard);
          spent += Number.isFinite(res.costUsd) ? res.costUsd : 0;
          const got = res.decision.route === "command" ? await panel.evaluate((t) => window.navi.parse(t), res.decision.command) : null;
          row = {
            model, heard: c.heard, expect: c.expect, route: res.decision.route, command: res.decision.command ?? "",
            routeOk: res.decision.route === c.expect,
            commandOk: c.expect === "command" ? res.decision.route === "command" && sameIntent(c.intent, got) : null,
            ms: res.ms, costUsd: res.costUsd, error: null,
          };
        } catch (err) {
          row = { model, heard: c.heard, expect: c.expect, route: "error", routeOk: false, commandOk: false, ms: null, costUsd: 0, error: String(err.message ?? err).slice(0, 200) };
        }
        rows.push(row);
        const ok = row.routeOk && row.commandOk !== false;
        console.log(`${ok ? "PASS" : "FAIL"}  router ${model.padEnd(18)} ${c.heard.slice(0, 44).padEnd(44)} -> ${row.route}${row.command ? ` "${row.command}"` : ""}${row.ms ? `  ${row.ms} ms` : ""}${row.error ? `  (${row.error})` : ""}`);
      }
    }
    if (spent > budget) console.log(`  ${model}: stopped at the ${money(budget)} budget`);
  }
  return rows;
}

async function runAgentTask(task) {
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
        new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 120_000)),
      ]);
      await panel.waitForFunction(() => !window.navi.busy, null, { timeout: 120_000 });
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
  return {
    task: task.id,
    success,
    paths: metrics.map((m) => m.path).join("+"),
    ms: metrics.reduce((sum, m) => sum + m.ms, 0),
    wallMs,
    steps: metrics.reduce((sum, m) => sum + (m.steps ?? 0), 0),
    costUsd: metrics.reduce((sum, m) => sum + (Number.isFinite(m.costUsd) ? m.costUsd : 0), 0),
    reply: reply.slice(0, 160),
    error: error ?? metrics.find((m) => m.error)?.error ?? null,
  };
}

async function runAgentSuite() {
  const rows = [];
  for (const a of agents) {
    await applySettings({ model: a.model, effort: a.effort, routerModel: "off" });
    let spent = 0;
    for (const task of tasks) {
      for (let r = 0; r < repeat; r++) {
        if (spent > budget) break;
        const row = { model: a.label, ...(await runAgentTask(task)) };
        spent += row.costUsd;
        rows.push(row);
        console.log(`${row.success ? "PASS" : "FAIL"}  agent ${a.label.padEnd(20)} ${task.id.padEnd(22)} ${(row.ms / 1000).toFixed(1).padStart(5)} s  ${String(row.steps).padStart(2)} steps  ${money(row.costUsd).padStart(8)}${row.error ? `  (${row.error.slice(0, 120)})` : ""}`);
      }
    }
    if (spent > budget) console.log(`  ${a.label}: stopped at the ${money(budget)} budget`);
  }
  return rows;
}

async function runCheck() {
  console.log("Checking keys and model names (costs about a cent)...\n");
  const listed = await listProviderModels();
  for (const [provider, ids] of Object.entries(listed)) {
    if (typeof ids === "string") {
      console.log(`${provider}: ${ids}`);
      continue;
    }
    const wanted = [...new Set([...routerModels, ...agentConfigs.map((a) => a.model)])].filter((m) => providerOf(m) === provider);
    for (const m of wanted) console.log(`${provider}: ${m} ${ids.includes(m) ? "is available" : "NOT FOUND (check the exact model name)"}`);
    const similar = ids.filter((id) => /gpt-6|opus-5|sonnet-5|haiku/.test(id));
    if (similar.length) console.log(`${provider}: related models on your account: ${similar.join(", ")}`);
  }
  for (const m of routers) {
    await applySettings({ routerModel: m });
    try {
      const res = await routeOnce("scroll down a smidge more");
      console.log(`router ${m}: OK -> ${res.decision.route} "${res.decision.command ?? ""}" in ${res.ms} ms, ${money(res.costUsd)}`);
    } catch (err) {
      console.log(`router ${m}: FAILED ${String(err.message ?? err).slice(0, 300)}`);
    }
  }
  const quick = JSON.parse(await readFile("bench/tasks.json", "utf8")).find((t) => t.id === "mail-open");
  for (const a of agents) {
    await applySettings({ model: a.model, effort: a.effort, routerModel: "off", maxAgentSteps: 4 });
    const row = await runAgentTask(quick);
    console.log(`agent ${a.label}: ${row.error ? `FAILED ${row.error.slice(0, 300)}` : `${row.success ? "OK" : "ran but missed the target"} in ${(row.ms / 1000).toFixed(1)} s, ${money(row.costUsd)}`}`);
  }
}

// ---- Scoring helpers ----
function similarity(a, b) {
  if (a === b) return 1;
  const m = a.length;
  const n = b.length;
  if (!m || !n) return 0;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return 1 - prev[n] / Math.max(m, n);
}
function norm(s) {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

/** Same command: same intent type and fields, allowing small wording differences in free text. */
function sameIntent(a, b) {
  if (!a || !b || a.type !== b.type) return false;
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const x = a[key];
    const y = b[key];
    if (typeof x === "string" && typeof y === "string") {
      if (similarity(norm(x), norm(y)) < 0.75) return false;
    } else if (JSON.stringify(x) !== JSON.stringify(y)) {
      return false;
    }
  }
  return true;
}

// ---- Report ----
function pct(n, d) {
  return d ? `${Math.round((n / d) * 100)}%` : "-";
}
function quantile(xs, q) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
}
function mean(xs) {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

async function report(routerRows, agentRows) {
  const out = [`# NaviBench results (${new Date().toISOString().slice(0, 16).replace("T", " ")})${mock ? " (MOCK)" : ""}`, ""];
  const routerStats = (suites.has("router") ? routers : []).map((model) => {
    const rows = routerRows.filter((r) => r.model === model);
    const commands = rows.filter((r) => r.expect === "command");
    return {
      model,
      n: rows.length,
      routeAcc: rows.filter((r) => r.routeOk).length / Math.max(rows.length, 1),
      commandAcc: commands.filter((r) => r.commandOk).length / Math.max(commands.length, 1),
      noiseAcc: rows.filter((r) => r.expect === "ignore" && r.routeOk).length / Math.max(rows.filter((r) => r.expect === "ignore").length, 1),
      p50: quantile(rows.filter((r) => r.ms).map((r) => r.ms), 0.5),
      p95: quantile(rows.filter((r) => r.ms).map((r) => r.ms), 0.95),
      cost: mean(rows.map((r) => r.costUsd ?? 0)),
      errors: rows.filter((r) => r.error).length,
    };
  });
  if (routerStats.length) {
    out.push(
      "## Router",
      "",
      "| Model | Right route | Right command | Ignores chatter | p50 | p95 | Cost per call | Errors |",
      "|---|---|---|---|---|---|---|---|",
      ...routerStats.map(
        (s) =>
          `| ${s.model} | ${pct(s.routeAcc * s.n, s.n)} | ${Math.round(s.commandAcc * 100)}% | ${Math.round(s.noiseAcc * 100)}% | ${s.p50} ms | ${s.p95} ms | ${money(s.cost)} | ${s.errors} |`,
      ),
      "",
    );
  }
  const agentStats = (suites.has("agent") ? agents : []).map((a) => {
    const rows = agentRows.filter((r) => r.model === a.label);
    const ok = rows.filter((r) => r.success);
    const total = rows.reduce((sum, r) => sum + r.costUsd, 0);
    return {
      label: a.label,
      n: rows.length,
      success: ok.length,
      p50: quantile(rows.map((r) => r.ms), 0.5),
      p90: quantile(rows.map((r) => r.ms), 0.9),
      steps: quantile(rows.map((r) => r.steps), 0.5),
      costPerTask: rows.length ? total / rows.length : Number.NaN,
      costPerSuccess: ok.length ? total / ok.length : Number.NaN,
      total,
    };
  });
  if (agentStats.length) {
    out.push(
      "## Agent",
      "",
      "| Model | Success | Median time | p90 time | Median steps | Cost per task | Cost per success | Spent |",
      "|---|---|---|---|---|---|---|---|",
      ...agentStats.map(
        (s) =>
          `| ${s.label} | ${s.success}/${s.n} (${pct(s.success, s.n)}) | ${(s.p50 / 1000).toFixed(1)} s | ${(s.p90 / 1000).toFixed(1)} s | ${s.steps} | ${money(s.costPerTask)} | ${money(s.costPerSuccess)} | ${money(s.total)} |`,
      ),
      "",
    );
  }

  // Projection: the cheapest router within 5 points of the most accurate one, with each agent.
  const best = Math.max(0, ...routerStats.map((s) => s.routeAcc));
  const router = routerStats.filter((s) => s.routeAcc >= best - 0.05).sort((a, b) => a.cost - b.cost)[0];
  if (agentStats.length) {
    out.push(
      `## What ${HOURS} hours of use would cost`,
      "",
      router
        ? `Router: ${router.model} (${pct(router.routeAcc * router.n, router.n)} right, ${money(router.cost)} per call), the cheapest router within 5 points of the most accurate.`
        : "Router: not measured in this run (router cost left out).",
      "",
      `| Agent | ${SCENARIOS.map((s) => `${s.name} (${s.note}): per hour / ${HOURS} h`).join(" | ")} |`,
      `|---|${SCENARIOS.map(() => "---").join("|")}|`,
      ...agentStats.map((a) => {
        const cells = SCENARIOS.map((s) => {
          const hourly = s.agentTasks * a.costPerTask + (router ? s.routerCalls * router.cost : 0);
          return `${money(hourly)} / ${money(hourly * HOURS)}`;
        });
        return `| ${a.label} | ${cells.join(" | ")} |`;
      }),
      "",
      "Assumptions: most commands run on Navi's free fast path; per hour, Light/Typical/Heavy send " +
        SCENARIOS.map((s) => `${s.routerCalls} phrases to the router and ${s.agentTasks} tasks to the agent`).join(", ") +
        ". Benchmark tasks are multi-step, so real average costs may be lower. Your Settings → Usage log records the real cost of every command.",
      "",
      "Speech add-ons, if enabled (not measured here): ElevenLabs speech-to-text ~$0.39 per hour awake (about $4 for 20 hours if Navi is awake half the time); ElevenLabs voice ~$0.05/h for short replies.",
      "",
    );
  }
  const text = out.join("\n");
  console.log(`\n${text}`);
  await mkdir("bench-results", { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = `bench-results/navibench-${stamp}${mock ? "-mock" : ""}`;
  await writeFile(`${file}.md`, text);
  await writeFile(`${file}.json`, JSON.stringify({ args, routerStats, agentStats, routerRows, agentRows }, null, 2));
  console.log(`Saved ${file}.md and .json`);
}

// ---- Mock APIs (harness test only) ----
// The mock router answers every labeled phrase correctly, so a mock run should score 100%.
async function installMocks(ctx) {
  const labeled = JSON.parse(await readFile("bench/router-cases.json", "utf8"));
  const answer = (message) => {
    const heard = String(message).match(/Heard: "([\s\S]*)"$/)?.[1];
    const c = labeled.find((x) => x.heard === heard);
    return JSON.stringify(c ? { route: c.expect, command: c.command ?? "" } : { route: "agent", command: "" });
  };
  await ctx.route("https://api.anthropic.com/**", (route) => {
    const body = route.request().postDataJSON();
    const router = !!body.output_config?.format;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "msg_mock", type: "message", role: "assistant", model: body.model, stop_reason: "end_turn", stop_sequence: null,
        content: [{ type: "text", text: router ? answer(body.messages[0].content) : "Mock reply." }],
        usage: router ? { input_tokens: 1200, output_tokens: 20 } : { input_tokens: 3000, output_tokens: 80, cache_read_input_tokens: 4000 },
      }),
    });
  });
  await ctx.route("https://api.openai.com/**", (route) => {
    const body = route.request().postDataJSON();
    const router = !!body.text?.format;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "resp_mock", status: "completed",
        output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: router ? answer(body.input) : "Mock reply." }] }],
        usage: router ? { input_tokens: 1200, output_tokens: 20 } : { input_tokens: 7000, output_tokens: 80, input_tokens_details: { cached_tokens: 4000 } },
      }),
    });
  });
}
