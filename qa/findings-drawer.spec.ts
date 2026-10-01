import { expect, test } from "@playwright/test";
import { DESKTOP, MOBILE, gotoDemo } from "./ui-helpers";

test.beforeEach(async ({ page }) => {
  await page.setViewportSize(DESKTOP);
});

test("locked desktop finding pane exposes its evidence trail and prevents review mutations", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await gotoDemo(page);

  const register = page.getByText("Finding Register", { exact: true }).locator("xpath=ancestor::section[1]");
  await expect(register).toBeVisible();
  const trigger = register.locator("tbody tr").first().getByRole("button");
  await trigger.focus();
  await page.keyboard.press("Enter");

  const drawer = page.getByRole("complementary").filter({ hasText: "From source row to partner sign-off" });
  await expect(drawer).toBeVisible();
  await expect(drawer.locator("xpath=..")).toHaveCSS("position", "sticky");
  await expect(drawer.getByText("Fully traceable", { exact: true })).toBeVisible();
  await expect(drawer.getByText("Evidence Viewer", { exact: true })).toBeVisible();
  await expect(drawer.getByText("Why Triggered", { exact: true })).toBeVisible();

  const assignment = drawer.getByText("Assignment", { exact: true }).locator("xpath=ancestor::section[1]");
  await expect(assignment.getByRole("button", { name: "Save Assignment", exact: true })).toBeDisabled();
  await expect(assignment.getByRole("button", { name: "Assign To Me", exact: true })).toBeDisabled();
  await expect(assignment.getByRole("button", { name: "Clear", exact: true })).toBeDisabled();

  const evidence = drawer.getByText("Upload Evidence", { exact: true }).locator("xpath=ancestor::div[contains(@class,\"rounded-lg\")][1]");
  await expect(evidence.locator("input[type=file]")).toBeDisabled();

  const comments = drawer.getByText("Comments", { exact: true }).locator("xpath=ancestor::section[1]");
  await expect(comments.getByRole("button", { name: "Add Comment", exact: true })).toBeDisabled();

  const reviewer = drawer.getByText("Reviewer Workflow", { exact: true }).locator("xpath=ancestor::section[1]");
  await expect(reviewer.getByRole("button", { name: "Assign / Review", exact: true })).toBeDisabled();
  await expect(reviewer.getByRole("button", { name: "Request Evidence", exact: true })).toBeDisabled();
  await expect(reviewer.getByRole("button", { name: "Resolve", exact: true })).toBeDisabled();

  const manager = drawer.getByText("Manager Review", { exact: true }).locator("xpath=ancestor::section[1]");
  await expect(manager.getByRole("button", { name: "Approve", exact: true })).toBeDisabled();
  await expect(manager.getByRole("button", { name: "Return", exact: true })).toBeDisabled();
  await expect(manager.getByRole("button", { name: "Escalate", exact: true })).toBeDisabled();

  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await expect(trigger).toBeFocused();
  expect(errors, errors.join("\n")).toEqual([]);
});

test("finding detail remains a full-screen drawer on mobile", async ({ page }) => {
  await page.setViewportSize({ ...MOBILE, width: 320 });
  await gotoDemo(page);

  const register = page.getByText("Finding Register", { exact: true }).locator("xpath=ancestor::section[1]");
  const cards = register.getByTestId("finding-register-cards");
  await expect(cards).toBeVisible();
  await expect(register.locator("table")).toBeHidden();
  const trigger = cards.locator("li button").first();
  await trigger.focus();
  await page.keyboard.press("Enter");

  const drawer = page.getByRole("complementary", { name: "Finding detail" });
  await expect(drawer).toBeVisible();
  await expect(drawer.locator("xpath=..")).toHaveCSS("position", "fixed");
  const evidenceCards = drawer.getByTestId("evidence-row-cards");
  if (await evidenceCards.count()) {
    await expect(evidenceCards).toBeVisible();
    await expect(evidenceCards.locator("xpath=following-sibling::div[1]")).toBeHidden();
  }
  const horizontalOverflow = await page.evaluate(() => ({
    width: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    offenders: Array.from(document.querySelectorAll("body *")).filter((element) => element.getBoundingClientRect().right > document.documentElement.clientWidth + 1).slice(0, 6).map((element) => ({ tag: element.tagName, className: element.className, right: Math.round(element.getBoundingClientRect().right) })),
  }));
  expect(horizontalOverflow.width, JSON.stringify(horizontalOverflow.offenders)).toBeLessThanOrEqual(1);
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await expect(trigger).toBeFocused();
});
