import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { DESKTOP, gotoDemo, openPage } from "./ui-helpers";

const SCREENS = ["Overview", "Findings", "Review pack"] as const;

test.beforeEach(async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await gotoDemo(page);
});

for (const screen of SCREENS) {
  test(`${screen} has no serious or critical WCAG A/AA violations`, async ({ page }) => {
    await openPage(page, screen);
    const results = await new AxeBuilder({ page })
      .include("main")
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    const blocking = results.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical");

    expect(
      blocking.map((violation) => ({
        id: violation.id,
        impact: violation.impact,
        help: violation.help,
        targets: violation.nodes.flatMap((node) => node.target.map(String)).slice(0, 8),
      })),
      "serious/critical accessibility violations",
    ).toEqual([]);
  });
}
