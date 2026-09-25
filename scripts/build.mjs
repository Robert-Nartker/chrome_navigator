// Bundles the extension into dist/ (load dist/ as an unpacked extension in Chrome).
// For day-to-day testing use `npm run dev`, which rebuilds and reloads automatically.
import * as esbuild from "esbuild";
import { mkdir, rm } from "node:fs/promises";
import { copyStatic, esbuildOptions } from "./build-config.mjs";

const outdir = "dist";
await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });
await esbuild.build(esbuildOptions({ outdir }));
await copyStatic(outdir);
