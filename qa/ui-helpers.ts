import { expect, type Page } from "@playwright/test";

// Shared helpers for the interactive UI specs. Not a *.spec file, so Playwright
// does not collect it as a test.

export const MOBILE = { width: 390, height: 844 };
export const DESKTOP = { width: 1280, height: 800 };

export const primaryNav = (page: Page) => page.locator("nav[aria-label='Primary']");

// Load /demo and wait until the app is actually interactive. On a cold `next dev`
// server the first page load compiles + hydrates lazily, so a click can land before
// React attaches its handlers; we retry a real navigation until it takes effect
// (`shadow-sm` is present only on the active nav button).
export async function gotoDemo(page: Page) {
  await page.goto("/demo");
  const nav = primaryNav(page);
  await expect(nav).toBeVisible();
  const probe = nav.getByRole("button", { name: "Findings", exact: true });
  await expect(async () => {
    await probe.click({ timeout: 2000 });
    await expect(probe).toHaveClass(/shadow-sm/, { timeout: 2000 });
  }).toPass({ timeout: 60_000 });
}

// Navigate to a page by its sidebar display label and confirm it became active.
export async function openPage(page: Page, label: string) {
  const button = primaryNav(page).getByRole("button", { name: label, exact: true });
  await button.scrollIntoViewIfNeeded();
  await button.click();
  await expect(button).toHaveClass(/shadow-sm/, { timeout: 10_000 });
}
