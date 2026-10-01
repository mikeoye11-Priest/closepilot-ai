import { expect, test } from "@playwright/test";
import { DESKTOP, gotoDemo, openPage } from "./ui-helpers";

const BUDGET = {
  routeTransitionMs: 2_000,
  resourceCount: 250,
  scriptTransferBytes: 8 * 1024 * 1024,
  domNodes: 5_000,
} as const;

test("interactive demo stays within the browser performance budget", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await gotoDemo(page);

  const startedAt = Date.now();
  await openPage(page, "Findings");
  const routeTransitionMs = Date.now() - startedAt;

  const metrics = await page.evaluate(() => {
    const resources = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
    const scripts = resources.filter((entry) => entry.initiatorType === "script" || entry.name.includes(".js"));
    return {
      resourceCount: resources.length,
      scriptTransferBytes: scripts.reduce((total, entry) => total + Math.max(0, entry.transferSize), 0),
      domNodes: document.getElementsByTagName("*").length,
    };
  });

  expect(routeTransitionMs, "Findings client-side route transition").toBeLessThanOrEqual(BUDGET.routeTransitionMs);
  expect(metrics.resourceCount, "loaded resource count").toBeLessThanOrEqual(BUDGET.resourceCount);
  expect(metrics.scriptTransferBytes, "script transfer bytes").toBeLessThanOrEqual(BUDGET.scriptTransferBytes);
  expect(metrics.domNodes, "rendered DOM nodes").toBeLessThanOrEqual(BUDGET.domNodes);
});

test("all major demo screens remain below the DOM complexity budget", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize(DESKTOP);
  await gotoDemo(page);

  for (const screen of ["Overview", "Findings", "VAT", "Audit readiness", "Review pack"] as const) {
    await openPage(page, screen);
    const domNodes = await page.locator("*").count();
    expect(domNodes, `${screen} DOM nodes`).toBeLessThanOrEqual(BUDGET.domNodes);
  }
});
