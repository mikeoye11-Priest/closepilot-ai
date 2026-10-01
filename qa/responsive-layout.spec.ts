import { expect, test } from "@playwright/test";
import { gotoDemo, openPage, primaryNav } from "./ui-helpers";

const BREAKPOINTS = [
  { name: "small mobile", width: 320, height: 780 },
  { name: "tablet", width: 768, height: 900 },
  { name: "small desktop", width: 1024, height: 800 },
  { name: "wide desktop", width: 1440, height: 900 },
] as const;

const CORE_SCREENS = ["Overview", "Import & upload", "Findings", "Review pack"] as const;

for (const viewport of BREAKPOINTS) {
  test(`core journey fits the ${viewport.name} breakpoint`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await gotoDemo(page);

    for (const screen of CORE_SCREENS) {
      await openPage(page, screen);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${screen} overflows at ${viewport.width}px`).toBeLessThanOrEqual(1);
    }

    await openPage(page, "Overview");
    if (viewport.width < 768) {
      await expect(page.getByTestId("top-finding-cards")).toBeVisible();
      await expect(page.getByLabel("Top findings table")).toBeHidden();
      await expect(primaryNav(page)).toBeHidden();
      await expect(page.getByRole("button", { name: "Menu", exact: true })).toBeVisible();
      await openPage(page, "Review pack");
      await page.getByLabel("Pack Type").selectOption("audit");
      await expect(page.getByTestId("audit-summary-cards")).toBeVisible();
      await expect(page.getByTestId("pack-finding-cards")).toBeVisible();
    } else {
      await expect(page.getByLabel("Top findings table")).toBeVisible();
    }

    if (viewport.width >= 1024) {
      await expect(primaryNav(page)).toBeVisible();
      await expect(page.getByRole("button", { name: "Menu", exact: true })).toBeHidden();
    }
  });
}
