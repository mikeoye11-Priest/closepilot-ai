import { expect, test } from "@playwright/test";
import { gotoDemo, openPage } from "./ui-helpers";

const JOURNEY = [
  { screen: "Import & upload", snapshot: "01-import-upload.png" },
  { screen: "Overview", snapshot: "02-overview.png" },
  { screen: "Findings", snapshot: "03-findings.png" },
  { screen: "Review pack", snapshot: "04-review-pack.png" },
] as const;

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoDemo(page);
});

for (const step of JOURNEY) {
  test(`${step.screen} matches its approved visual baseline`, async ({ page }) => {
    await openPage(page, step.screen);
    await expect(page).toHaveScreenshot(step.snapshot, {
      animations: "disabled",
      caret: "hide",
      maxDiffPixelRatio: 0.01,
    });
  });
}
