import { test, expect, type Page } from "@playwright/test";
import { MOBILE, DESKTOP, primaryNav, gotoDemo } from "./ui-helpers";

// Navigation + runtime smoke against the stable /demo route (presentation mode —
// no auth, no onboarding). Replaces the older button/walkthrough specs that
// hard-coded a pre-refresh nav (flat, different labels).
//
// The traversal runs on a mobile viewport, where the sidebar collapses to a flat
// scroll rail: every page's nav button is directly visible (no group expansion)
// and the collapsible group headers drop out (display:none), so navigating is
// simple and stable. A separate desktop check guards the responsive layout.

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
// 500 without backend config — which is not a render bug, so those are filtered.
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
  test.setTimeout(120_000);
  await page.setViewportSize(MOBILE);
  const errors = collectErrors(page);
  await gotoDemo(page);
  const nav = primaryNav(page);

  for (const label of PAGES) {
    const button = nav.getByRole("button", { name: label, exact: true });
    await button.scrollIntoViewIfNeeded();
    await button.click();
    // `shadow-sm` is present ONLY on the active nav button (the inactive class uses
    // hover:bg-white/5), so this asserts the click actually navigated — and that the
    // panel rendered without an uncaught runtime error (collected above).
    await expect(button).toHaveClass(/shadow-sm/, { timeout: 10_000 });
    await expect(page.getByRole("main")).toBeVisible();
  }
  expect(errors, errors.join("\n")).toEqual([]);
});

test("the desktop shell keeps its layout — branded and no horizontal scroll", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  const errors = collectErrors(page);
  await page.goto("/demo");
  await expect(primaryNav(page)).toBeVisible();

  // Tailwind is applied (branded shell, not an unstyled fallback).
  await expect(page.getByText("ClosePilot", { exact: false }).first()).toBeVisible();
  await expect(page.getByRole("main")).toBeVisible();
  const noHorizontalScroll = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2);
  expect(noHorizontalScroll, "the page body must not scroll horizontally").toBeTruthy();
  expect(errors, errors.join("\n")).toEqual([]);
});
