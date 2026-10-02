import { test, expect, type Page } from "@playwright/test";
import { MOBILE, gotoDemo, openPage } from "./ui-helpers";

// Export-flow coverage off the stable /demo route (preloaded pilot data). Exercises
// the review-pack and VAT-pack export buttons end to end and asserts each produces
// the expected download — the deliverables an accountant actually hands over.

test.beforeEach(async ({ page }) => {
  // window.print() would block on the "Print pack" controls; make it a no-op.
  await page.addInitScript(() => { window.print = () => {}; });
  await page.setViewportSize(MOBILE);
});

async function expectDownload(page: Page, buttonName: string, pattern: RegExp) {
  const download = page.waitForEvent("download");
  await page.getByRole("main").getByRole("button", { name: buttonName, exact: true }).click();
  expect((await download).suggestedFilename()).toMatch(pattern);
}

test("review pack exports produce the findings CSV and evidence JSON", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await gotoDemo(page);
  await openPage(page, "Reports");

  await expectDownload(page, "Findings Schedule", /\.csv$/i);
  await expectDownload(page, "Evidence Archive", /\.json$/i);
  expect(errors, errors.join("\n")).toEqual([]);
});

test("review pack opens on the decision summary with supporting detail on demand", async ({ page }) => {
  await gotoDemo(page);
  await openPage(page, "Review pack");

  const main = page.getByRole("main");
  await expect(main.getByText("Partner conclusion", { exact: true })).toBeVisible();
  await expect(main.getByLabel("Pack Type")).toBeHidden();
  await expect(main.getByRole("heading", { name: "Financial Exposure Explanation" })).toBeHidden();
  await expect(main.getByRole("heading", { name: "Evidence Appendix" })).toBeHidden();
  const visibleWords = await main.evaluate((element) => (element as HTMLElement).innerText.trim().split(/\s+/).length);
  expect(visibleWords).toBeLessThan(900);

  await main.getByRole("button", { name: "Pack settings" }).click();
  await expect(main.getByLabel("Pack Type")).toBeVisible();
  await main.getByRole("button", { name: "Supporting schedules" }).click();
  await expect(main.getByRole("heading", { name: "Financial Exposure Explanation" })).toBeVisible();
  await main.getByRole("button", { name: "Evidence & audit trail" }).click();
  await expect(main.getByRole("heading", { name: "Evidence Appendix" })).toBeVisible();
});

test("VAT pack exports produce the exception CSV and evidence JSON", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await gotoDemo(page);
  await openPage(page, "Review");
  await page.getByRole("navigation", { name: "Review views" }).getByRole("button", { name: "VAT", exact: true }).click();

  await expectDownload(page, "VAT Evidence JSON", /\.json$/i);
  await expectDownload(page, "Exception CSV", /\.csv$/i);
  expect(errors, errors.join("\n")).toEqual([]);
});
