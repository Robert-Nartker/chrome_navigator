import { defineConfig } from "@playwright/test";

// Records the demo video (scripts/demo-video/README.md): one long "test" that drives the real extension.
process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS = "1";
process.env.PW_CHROMIUM_ATTACH_TO_OTHER = "1";

export default defineConfig({
  testDir: ".",
  testMatch: "record.spec.ts",
  timeout: 10 * 60_000,
  workers: 1,
  reporter: "list",
});
