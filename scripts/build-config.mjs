// Shared esbuild setup for `npm run build` (production) and `npm run dev` (live reload).
import { cp } from "node:fs/promises";

export const entryPoints = {
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

export async function copyStatic(outdir) {
  for (const [from, to] of staticFiles) {
    await cp(from, `${outdir}/${to}`, { recursive: true });
  }
}

export function esbuildOptions({ outdir, dev = false }) {
  return {
    entryPoints,
    outdir,
    bundle: true,
    format: "iife",
    target: "chrome120",
    sourcemap: "linked",
    minify: !dev,
    define: { __DEV__: JSON.stringify(dev) },
    logLevel: dev ? "warning" : "info",
  };
}
