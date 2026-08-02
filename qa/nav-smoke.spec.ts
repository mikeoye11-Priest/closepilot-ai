import { test, expect, type Page } from "@playwright/test";

// Robust navigation + runtime smoke against the stable /demo route (presentation
// mode — no auth, no onboarding). Replaces the older button/walkthrough specs that
// hard-coded a pre-refresh nav (flat, different labels).
//
// The traversal runs on a mobile viewport, where the sidebar collapses to a flat
// scroll rail: every page's nav button is directly visible (no group expansion)
// and the collapsible group headers drop out (display:none), so navigating is
// simple and stable. A separate desktop check guards the responsive layout.

const BASE = process.env.CLOSEPILOT_QA_URL ?? "http://localhost:3010";
const MOBILE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 800 };

// The display labels of every page reachable in presentation mode (mirrors
// PAGE_LABELS in app-shell.tsx; the advanced "Help & admin" group is hidden here).
const PAGES = [
  "Overview",
  "Findings", "Finance review", "VAT", "Controls & fraud", "Audit readiness", "Review pack",
  "Accounts", "Inventory & WIP",
  "Cash flow", "Collections", "Changes", "Month-end close", "Ask ClosePilot",
  "Import & upload", "All clients", "Practice metrics", "Scheduled reports",
];

// The real "page failed to render" signal is an uncaught JS exception (pageerror).
// Console errors here are dominated by environment noise — demo-mode APIs returning
// 500 without backend config, and `next start` serving static chunks with a
// text/plain MIME under this WSL setup — none of which are app render bugs, so
// those specific classes are filtered out.
function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (msg) => {
    const text = msg.text();
    const ignorable = /DevTools|Download the React|Failed to load resource|net::ERR|status of (4|5)\d\d|Refused to execute script|MIME type/i.test(text);
    if (msg.type() === "error" && !ignorable) errors.push(`console: ${text}`);
  });
  return errors;
}

test("every demo page renders with no runtime errors", async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize(MOBILE);
  const errors = collectErrors(page);
  await page.goto(`${BASE}/demo`);
  const nav = page.locator("nav[aria-label='Primary']");
  await expect(nav).toBeVisible();

  for (const label of PAGES) {
    const button = nav.getByRole("button", { name: label, exact: true });
    await button.scrollIntoViewIfNeeded();
    await button.click();
    // The clicked item becomes the active one (active styling adds bg-white).
    await expect(button).toHaveClass(/bg-white/, { timeout: 10_000 });
    await expect(page.getByRole("main")).toBeVisible();
  }
  expect(errors, errors.join("\n")).toEqual([]);
});

test("charts mount and the desktop layout stays intact", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  const errors = collectErrors(page);
  await page.goto(`${BASE}/demo`);
  await expect(page.locator("nav[aria-label='Primary']")).toBeVisible();

  // Tailwind is applied (branded shell, not an unstyled fallback).
  await expect(page.getByText("ClosePilot", { exact: false }).first()).toBeVisible();
  await expect(page.getByRole("main")).toBeVisible();
  // On desktop the shell must not scroll horizontally (responsive layout intact).
  const noHorizontalScroll = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2);
  expect(noHorizontalScroll, "the page body must not scroll horizontally").toBeTruthy();
  expect(errors, errors.join("\n")).toEqual([]);
});
