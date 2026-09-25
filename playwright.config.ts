import { defineConfig } from "@playwright/test";

// Navi runs in the background: the AI is called from its service worker, and the mic, speech and voice
// live in an offscreen document. These let tests intercept the worker's requests, and treat the offscreen
// document as a page (so routes, WebSocket routes and init scripts apply to it too).
process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS = "1";
process.env.PW_CHROMIUM_ATTACH_TO_OTHER = "1";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 45_000,
  workers: 1,
  reporter: "list",
});
