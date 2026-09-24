// Bundles the extension into dist/ (load dist/ as an unpacked extension in Chrome).
import * as esbuild from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";

const watch = process.argv.includes("--watch");
const outdir = "dist";

const entryPoints = {
  background: "src/background.ts",
  content: "src/content/index.ts",
  sidepanel: "src/sidepanel/main.ts",
  setup: "src/setup/main.ts",
  options: "src/options/main.ts",
};

const staticFiles = [
  ["src/manifest.json", "manifest.json"],
  ["src/sidepanel/index.html", "sidepanel.html"],
  ["src/sidepanel/styles.css", "sidepanel.css"],
  ["src/setup/index.html", "setup.html"],
  ["src/options/index.html", "options.html"],
  ["src/shared.css", "shared.css"],
  ["src/icons", "icons"],
];

async function copyStatic() {
  for (const [from, to] of staticFiles) {
    await cp(from, `${outdir}/${to}`, { recursive: true });
  }
}

await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });

const options = {
  entryPoints,
  outdir,
  bundle: true,
  format: "iife",
  target: "chrome120",
  sourcemap: "linked",
  logLevel: "info",
  plugins: [{ name: "copy-static", setup: (b) => b.onEnd(copyStatic) }],
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
} else {
  await esbuild.build(options);
}
