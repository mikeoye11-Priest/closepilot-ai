import { expect, type Page } from "@playwright/test";

// Shared helpers for the interactive UI specs. Not a *.spec file, so Playwright
// does not collect it as a test.

export const MOBILE = { width: 390, height: 844 };
export const DESKTOP = { width: 1280, height: 800 };

export const primaryNav = (page: Page) => page.locator("nav[aria-label='Primary']");

async function revealPrimaryNav(page: Page) {
  const nav = primaryNav(page);
  if (!(await nav.isVisible())) await page.getByRole("button", { name: "Menu", exact: true }).click();
  await expect(nav).toBeVisible();
  return nav;
}

const SUBVIEWS: Record<string, { parent: string; navigation: string; label: string }> = {
  Findings: { parent: "Review", navigation: "Review views", label: "Work queue" },
  "Finance review": { parent: "Review", navigation: "Review views", label: "Finance" },
  VAT: { parent: "Review", navigation: "Review views", label: "VAT" },
  "Controls & fraud": { parent: "Review", navigation: "Review views", label: "Controls" },
  "Audit readiness": { parent: "Review", navigation: "Review views", label: "Audit readiness" },
  "Month-end close": { parent: "Review", navigation: "Review views", label: "Month-end" },
  "Review pack": { parent: "Reports", navigation: "Report views", label: "Review pack" },
  Accounts: { parent: "Reports", navigation: "Report views", label: "Accounts" },
  "Cash flow": { parent: "Reports", navigation: "Report views", label: "Cash flow" },
  Collections: { parent: "Reports", navigation: "Report views", label: "Collections" },
  Changes: { parent: "Reports", navigation: "Report views", label: "Changes" },
  "Inventory & WIP": { parent: "Reports", navigation: "Report views", label: "Inventory & WIP" },
};

// Load /demo and wait until the app is actually interactive. On a cold `next dev`
// server the first page load compiles + hydrates lazily, so a click can land before
// React attaches its handlers; we retry a real navigation until it takes effect
// (`shadow-sm` is present only on the active nav button).
export async function gotoDemo(page: Page) {
  await page.goto("/demo");
  await page.evaluate(() => window.scrollTo(0, 0));
  const nav = await revealPrimaryNav(page);
  const probe = nav.locator('button[data-screen="Findings"]');
  await expect(async () => {
    await probe.click({ timeout: 2000 });
    await expect(probe).toHaveClass(/shadow-sm/, { timeout: 2000 });
  }).toPass({ timeout: 60_000 });
}

// Navigate to a page by its sidebar display label and confirm it became active.
export async function openPage(page: Page, label: string) {
  const nav = await revealPrimaryNav(page);
  let button = nav.getByRole("button", { name: label, exact: true });
  const subview = SUBVIEWS[label];
  if (await button.count() === 0 && subview) {
    await openPage(page, subview.parent);
    button = page.getByRole("navigation", { name: subview.navigation }).getByRole("button", { name: subview.label, exact: true });
    await button.click();
    await expect(button).toHaveClass(/bg-slate-900/, { timeout: 10_000 });
    return;
  }
  if (!(await button.isVisible())) {
    const groupButtons = nav.locator('button[aria-expanded]');
    for (let index = 0; index < await groupButtons.count(); index += 1) {
      const groupButton = groupButtons.nth(index);
      if ((await groupButton.getAttribute("aria-expanded")) !== "true") await groupButton.click();
      if (await button.isVisible()) break;
    }
  }
  await button.scrollIntoViewIfNeeded();
  await button.click();
  await expect(page.getByRole("main").getByRole("heading", { level: 1, name: label, exact: true })).toBeVisible({ timeout: 10_000 });
}
