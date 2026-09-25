// Live development loop. Leave it running while you test:
//   1. pulls new commits on your current branch from GitHub every few seconds,
//   2. rebuilds the extension into dist/ whenever a source file changes,
//   3. tells the open Navi side panel to reload itself (and the extension, when needed).
//
//   npm run dev              (load dist/ in chrome://extensions once; after that, nothing to click)
//   npm run dev -- --no-pull (rebuild and reload only, no git)
import * as esbuild from "esbuild";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { watch } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { promisify } from "node:util";
import { copyStatic, esbuildOptions } from "./build-config.mjs";

const run = promisify(execFile);
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const option = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : fallback;
};

const outdir = option("outdir", "dist");
const port = Number(option("port", 35729));
const pullEverySec = Number(option("pull-interval", 10));

const time = () => new Date().toLocaleTimeString();
const log = (msg) => console.log(`[${time()}] ${msg}`);

// --- Server-sent events: the side panel listens here for new builds ----------
const clients = new Set();
let state = { buildId: 0, fullHash: "", commit: "", at: "" };

createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.url === "/events") {
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
    res.write(`data: ${JSON.stringify(state)}\n\n`);
    clients.add(res);
    req.on("close", () => clients.delete(res));
    return;
  }
  res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(state));
}).listen(port, "127.0.0.1", () => log(`Live reload server on http://localhost:${port}`));

// Keep connections open through idle periods.
setInterval(() => clients.forEach((c) => c.write(": ping\n\n")), 20_000);

function broadcast() {
  clients.forEach((c) => c.write(`data: ${JSON.stringify(state)}\n\n`));
}

// --- Build --------------------------------------------------------------------
async function hashOf(files) {
  const h = createHash("sha1");
  for (const f of files) h.update(await readFile(`${outdir}/${f}`).catch(() => ""));
  return h.digest("hex").slice(0, 12);
}

async function lastCommit() {
  try {
    const { stdout } = await run("git", ["log", "-1", "--format=%h %s"]);
    return stdout.trim();
  } catch {
    return "";
  }
}

await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });
const ctx = await esbuild.context(esbuildOptions({ outdir, dev: true }));

let building = false;
let queued = false;
async function rebuild(reason) {
  if (building) {
    queued = true;
    return;
  }
  building = true;
  try {
    const started = Date.now();
    const result = await ctx.rebuild().catch((err) => err);
    if (result?.errors?.length) {
      log(`Build failed (fix the error above; the extension keeps the last good build)`);
      return;
    }
    await copyStatic(outdir);
    // Changes to these need a full extension reload; anything else reloads just the panel and pages.
    const fullHash = await hashOf(["manifest.json", "background.js"]);
    const full = state.fullHash && fullHash !== state.fullHash;
    state = { buildId: state.buildId + 1, fullHash, commit: await lastCommit(), at: new Date().toISOString() };
    await writeFile(`${outdir}/dev-build.json`, JSON.stringify(state));
    log(`Built #${state.buildId} in ${Date.now() - started} ms (${reason})${full ? ", extension will restart" : ""}`);
    broadcast();
  } finally {
    building = false;
    if (queued) {
      queued = false;
      void rebuild("more changes");
    }
  }
}

await rebuild("startup");

let debounce;
watch("src", { recursive: true }, (_event, file) => {
  clearTimeout(debounce);
  debounce = setTimeout(() => void rebuild(`changed ${file}`), 120);
});

// --- Pull new commits from GitHub ----------------------------------------------
async function git(...args) {
  const { stdout } = await run("git", args);
  return stdout.trim();
}

let warnedDirty = false;
async function pull() {
  try {
    const branch = await git("rev-parse", "--abbrev-ref", "HEAD");
    await git("fetch", "-q", "origin", branch);
    const behind = Number(await git("rev-list", "--count", `HEAD..origin/${branch}`));
    if (!behind) return;
    const dirty = await git("status", "--porcelain", "--untracked-files=no");
    if (dirty) {
      if (!warnedDirty) log(`New commits on origin/${branch}, but you have local edits, so auto-pull is paused.`);
      warnedDirty = true;
      return;
    }
    warnedDirty = false;
    const changed = await git("diff", "--name-only", `HEAD..origin/${branch}`);
    const subjects = await git("log", "--format=  • %s", `HEAD..origin/${branch}`);
    await git("merge", "-q", "--ff-only", `origin/${branch}`);
    log(`Pulled ${behind} commit${behind === 1 ? "" : "s"}:\n${subjects}`);
    if (/^package(-lock)?\.json$/m.test(changed)) {
      log("Dependencies changed, running npm install…");
      await run("npm", ["install", "--no-audit", "--no-fund"]);
    }
    // The file watcher rebuilds automatically; this covers watchers that miss git's writes.
    await rebuild("pulled from GitHub");
  } catch (err) {
    log(`Auto-pull skipped: ${String(err.message ?? err).split("\n")[0]}`);
  }
}

if (!flag("no-pull")) {
  log(`Auto-pulling from GitHub every ${pullEverySec}s`);
  setInterval(() => void pull(), pullEverySec * 1000);
}
