import { expect, test } from "@playwright/test";

const baseURL = process.env.CLOSEPILOT_QA_URL ?? "http://127.0.0.1:3004";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (!window.sessionStorage.getItem("closepilot.qa.initialised")) {
      window.localStorage.clear();
      window.sessionStorage.setItem("closepilot.qa.initialised", "true");
    }
    window.print = () => {};
  });
});

test("pilot demo walkthrough opens the right workflow context", async ({ page }) => {
  test.setTimeout(60000);
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];

  page.on("console", (msg) => {
    if (msg.type() === "error" && !msg.text().includes("Download the React DevTools")) {
      consoleErrors.push(msg.text());
    }
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto(baseURL);
  await expect(page.getByRole("heading", { name: "Onboarding" })).toBeVisible();
  await page.getByRole("button", { name: "Load Pilot Demo" }).click();

  await expect(page.getByRole("heading", { name: "Findings", exact: true })).toBeVisible();
  await expect(page.getByText("Pilot Walkthrough")).toBeVisible();
  await expect(page.locator("header p").filter({ hasText: "Brightlane Manufacturing Ltd" })).toBeVisible();
  await expect(page.getByText("Partner conclusion recorded")).toBeVisible();
  await expect(page.locator("header").getByText("85%", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: /Inspect Evidence/ }).click();
  await expect(page.getByRole("region", { name: "Evidence-to-decision trace" })).toBeVisible();
  await expect(page.getByText("From source row to partner sign-off")).toBeVisible();
  await expect(page.getByText("Included in locked review pack")).toBeVisible();
  await expect(page.getByText("VAT control difference resolved").first()).toBeVisible();
  await expect(page.getByRole("link", { name: /vat-control-reconciliation/ })).toBeVisible();
  await page.getByRole("button", { name: "Close", exact: true }).click();

  await page.getByRole("button", { name: /Manager Review/ }).click();
  await expect(page.getByText("Aged debtor concentration reviewed and accepted").first()).toBeVisible();
  await expect(page.getByText("Manager Review").last()).toBeVisible();
  await expect(page.getByText("Approved. Evidence supports recoverability conclusion.")).toBeVisible();
  await page.getByRole("button", { name: "Close", exact: true }).click();

  await page.getByRole("button", { name: /Partner Sign-Off/ }).click();
  await expect(page.getByText("Suspense balance cleared before close").first()).toBeVisible();
  await expect(page.getByText("Escalated for partner awareness because the adjustment was material.")).toBeVisible();
  await page.getByRole("button", { name: "Close", exact: true }).click();

  await page.getByRole("button", { name: /Export Pack/ }).click();
  await expect(page.getByRole("heading", { name: "Review Pack" })).toBeVisible();
  await expect(page.getByText("Partner Sign-Off").first()).toBeVisible();
  await expect(page.getByText("Signed by Priya Desai")).toBeVisible();
  await expect(page.getByLabel("Conclusion")).toHaveValue("Approved and locked following partner sign-off.");

  await page.getByRole("button", { name: "VAT Assurance", exact: true }).click();
  await expect(page.getByText("Pilot Walkthrough")).toHaveCount(0);

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Reload Demo" }).click();
  await expect(page.getByRole("heading", { name: "Findings", exact: true })).toBeVisible();
  await expect(page.locator("header").getByText(/6 finance exports reviewed, 0 items to resolve/)).toBeVisible();
  await expect(page.getByText("Partner conclusion recorded")).toBeVisible();

  await page.reload();
  await expect(page.locator("header p").filter({ hasText: "Brightlane Manufacturing Ltd" })).toBeVisible();
  await expect(page.locator("header").getByText(/6 finance exports reviewed, 0 items to resolve/)).toBeVisible();

  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test("presentation route opens a clean preloaded demo", async ({ page }) => {
  await page.goto(`${baseURL}/demo`);

  await expect(page.getByRole("heading", { name: "Overview", exact: true }).first()).toBeVisible();
  await expect(page.locator("header p").filter({ hasText: "Brightlane Manufacturing Ltd" })).toBeVisible();
  await expect(page.locator("header").getByText("85%", { exact: true })).toBeVisible();
  await expect(page.getByText("Interactive demo · fictional data")).toBeVisible();
  await expect(page.getByRole("button", { name: "Onboard" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Reload Demo" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Guide", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Settings", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Sign out" })).toHaveCount(0);

  await page.getByRole("button", { name: "Review Pack", exact: true }).click();
  await expect(page.getByRole("button", { name: /5 Export Pack/ })).toHaveAttribute("aria-pressed", "true");
});
