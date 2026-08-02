import { defineConfig } from "@playwright/test";

// Playwright drives the app through a real browser, so it needs a server that
// HYDRATES. `next start` on this WSL setup serves JS chunks with a text/plain MIME
// (the browser then refuses them and the app never becomes interactive), so the UI
// specs run against `next dev`, which serves chunks correctly. The web server is
// started automatically and reused if one is already up on the port.

const PORT = Number(process.env.CLOSEPILOT_QA_PORT ?? 3210);
const baseURL = process.env.CLOSEPILOT_QA_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "qa",
  testMatch: "**/*.spec.ts",
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: "line",
  use: { baseURL, browserName: "chromium" },
  webServer: {
    command: `CLOSEPILOT_AUTH_DISABLED=1 npx next dev apps/web -p ${PORT}`,
    url: `${baseURL}/demo`,
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
