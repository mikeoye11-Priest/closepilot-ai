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
  await openPage(page, "Review pack");

  await expectDownload(page, "Findings Schedule", /\.csv$/i);
  await expectDownload(page, "Evidence Archive", /\.json$/i);
  expect(errors, errors.join("\n")).toEqual([]);
});

test("VAT pack exports produce the exception CSV and evidence JSON", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await gotoDemo(page);
  await openPage(page, "VAT");

  await expectDownload(page, "VAT Evidence JSON", /\.json$/i);
  await expectDownload(page, "Exception CSV", /\.csv$/i);
  expect(errors, errors.join("\n")).toEqual([]);
});
