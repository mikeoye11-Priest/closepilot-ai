import { defineConfig } from "@playwright/test";

// Playwright drives the app through a real browser, so it needs a server that
// HYDRATES. `next start` on this WSL setup serves JS chunks with a text/plain MIME
// (the browser then refuses them and the app never becomes interactive), so the UI
// specs run against `next dev`, which serves chunks correctly. An explicitly
// supplied URL is treated as externally managed; otherwise Playwright owns a
// dedicated server and build directory, so an ordinary local dev server can
// continue running without sharing Next's lock.

const PORT = Number(process.env.CLOSEPILOT_QA_PORT ?? 3210);
const externalURL = process.env.CLOSEPILOT_QA_URL?.replace(/\/$/, "");
const baseURL = externalURL ?? `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "qa",
  testMatch: "**/*.spec.ts",
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: "line",
  use: { baseURL, browserName: "chromium" },
  webServer: externalURL ? undefined : {
    command: `node scripts/run-playwright-server.mjs ${PORT}`,
    url: `${baseURL}/demo`,
    reuseExistingServer: false,
    timeout: 180_000,
    gracefulShutdown: { signal: "SIGTERM", timeout: 10_000 },
  },
});
