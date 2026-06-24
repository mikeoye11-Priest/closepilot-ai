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

  await expect(page.getByRole("heading", { name: "Partner Summary", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Primary review journey" })).toContainText("Findings → Evidence → Resolution → Sign-off");
  await expect(page.getByRole("region", { name: "Next action" })).toContainText("Review the accepted debtor risk");
  await page.getByRole("button", { name: "Findings", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Findings", exact: true })).toBeVisible();
  await expect(page.getByText("Pilot Walkthrough")).toBeVisible();
  await expect(page.locator("header p").filter({ hasText: "Brightlane Manufacturing Ltd" })).toBeVisible();
  await expect(page.getByText("Partner conclusion recorded")).toBeVisible();

  await page.getByRole("button", { name: /Inspect Evidence/ }).click();
  await expect(page.getByRole("region", { name: "Review trail" })).toBeVisible();
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
  await expect(page.getByRole("heading", { name: "Review Pack", exact: true })).toBeVisible();
  await expect(page.getByText("Partner Sign-Off").first()).toBeVisible();
  await expect(page.getByText("Signed by Priya Desai")).toBeVisible();
  await expect(page.getByLabel("Conclusion")).toHaveValue("Approved and locked following partner sign-off.");

  await page.getByRole("button", { name: "VAT Assurance", exact: true }).click();
  await expect(page.getByText("Pilot Walkthrough")).toHaveCount(0);

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Reload Demo" }).click();
  await expect(page.getByRole("heading", { name: "Partner Summary", exact: true })).toBeVisible();
  await expect(page.locator("header").getByText(/6 finance exports reviewed, 0 items to resolve/)).toBeVisible();
  await expect(page.getByText("Review Quality").first()).toBeVisible();

  await page.reload();
  await expect(page.locator("header p").filter({ hasText: "Brightlane Manufacturing Ltd" })).toBeVisible();
  await expect(page.locator("header").getByText(/6 finance exports reviewed, 0 items to resolve/)).toBeVisible();

  await page.getByRole("button", { name: "Collections Intelligence", exact: true }).click();
  await page.getByRole("button", { name: "Manage collection case for Cobalt Retail Group" }).click();
  const collectionCase = page.getByRole("dialog", { name: "Collection case" });
  await collectionCase.getByLabel("Status").selectOption("promised");
  await collectionCase.getByLabel("Promise amount").fill("12000");
  await collectionCase.getByLabel("Promise date").fill("2026-07-15");
  await collectionCase.getByLabel("Contact note").fill("Customer committed to a staged payment after dispute evidence was accepted.");
  await collectionCase.getByRole("button", { name: "Save Collection Case" }).click();
  await expect(page.getByText("£12,000 · 2026-07-15")).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.localStorage.getItem("closepilot.workspace.v2")?.includes('"promiseAmount":12000'))).toBe(true);

  await page.reload();
  await page.getByRole("button", { name: "Collections Intelligence", exact: true }).click();
  await expect(page.getByText("£12,000 · 2026-07-15")).toBeVisible();
  await page.getByRole("button", { name: "Manage collection case for Cobalt Retail Group" }).click();
  await expect(page.getByRole("dialog", { name: "Collection case" })).toContainText("Customer committed to a staged payment after dispute evidence was accepted.");
  await page.getByRole("dialog", { name: "Collection case" }).getByRole("button", { name: "Close" }).click();

  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test("presentation route opens a clean preloaded demo", async ({ page }) => {
  await page.goto(`${baseURL}/demo`);

  await expect(page.getByRole("heading", { name: "Partner Summary", exact: true }).first()).toBeVisible();
  await expect(page.locator("header p").filter({ hasText: "Brightlane Manufacturing Ltd" })).toBeVisible();
  await expect(page.getByText("85/100", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Interactive demo · fictional data")).toBeVisible();
  await expect(page.getByRole("button", { name: "Onboard" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Reload Demo" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Guide", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Settings", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Sign out" })).toHaveCount(0);

  await page.getByRole("button", { name: "Review Pack", exact: true }).click();
  await expect(page.getByRole("button", { name: /5 Export Pack/ })).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("button", { name: "Collections Intelligence", exact: true }).click();
  const collectionsSummary = page.getByRole("region", { name: "Collections summary" });
  await expect(collectionsSummary.getByText("£42,600").first()).toBeVisible();
  await expect(collectionsSummary.getByText("£33,400").first()).toBeVisible();
  await expect(collectionsSummary.getByText("£9,200").first()).toBeVisible();
  await expect(page.getByText("Harbour Components")).toBeVisible();
  await expect(page.getByText("Cobalt Retail Group")).toBeVisible();
  await page.getByRole("button", { name: "Draft email for Harbour Components" }).click();
  await expect(page.getByRole("dialog", { name: "Collection email preview" })).toContainText("Payment date confirmation: Harbour Components");
  await page.getByRole("dialog", { name: "Collection email preview" }).getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: "View evidence for Harbour Components" }).click();
  await expect(page.getByRole("region", { name: "Review trail" })).toBeVisible();
});

test("audit readiness uses one evidence-backed control plan", async ({ page }) => {
  await page.goto(`${baseURL}/demo`);
  await page.getByRole("button", { name: "Audit Readiness", exact: true }).click();

  const summary = page.getByRole("region", { name: "Audit readiness summary" });
  await expect(summary.getByText("85%", { exact: true }).first()).toBeVisible();
  await expect(summary.getByText("6/7", { exact: true })).toBeVisible();
  await expect(summary.getByText("Current 85% → 98% audit-ready")).toBeVisible();
  await expect(summary.getByText(/Partner sign-off locked:/)).toBeVisible();

  const bankControl = page.locator("tr", { hasText: "Bank reconciled" });
  await expect(bankControl.getByText("+13")).toBeVisible();
  await expect(bankControl).toContainText("Clear the outstanding bank timing item");

  const arControl = page.locator("tr", { hasText: "AR reconciled" });
  await arControl.getByRole("button", { name: "View Evidence" }).click();
  await expect(page.getByRole("region", { name: "Review trail" })).toBeVisible();
});

test("change and cash intelligence disclose evidence and assumptions", async ({ page }) => {
  await page.goto(`${baseURL}/demo`);
  await page.getByRole("button", { name: "Change Intelligence", exact: true }).click();

  const changeSummary = page.getByRole("region", { name: "Change intelligence summary" });
  await expect(changeSummary.getByText("£78,120")).toBeVisible();
  await expect(changeSummary.getByText("£35,520")).toBeVisible();
  await expect(changeSummary.getByText("£42,600")).toBeVisible();
  await expect(changeSummary.getByText("Period movement unavailable.")).toBeVisible();
  await expect(page.getByText("Revenue, Margin & Cash — 6 Months")).toHaveCount(0);

  await page.getByRole("button", { name: "Cash Intelligence", exact: true }).click();
  const cashSummary = page.getByRole("region", { name: "Cash intelligence summary" });
  await expect(cashSummary.getByText("£18,800")).toBeVisible();
  await expect(cashSummary.getByText("£21,720")).toBeVisible();
  await expect(cashSummary.getByText(/no evidenced opening bank balance/i)).toBeVisible();
  await expect(page.getByText("Promise £18,800 by 2026-06-22")).toBeVisible();
  await page.getByRole("button", { name: "Conservative" }).click();
  await expect(page.locator("article", { hasText: "30-Day Recovery" }).getByText("£18,800")).toBeVisible();
});

test("controls and fraud presents reviewable exceptions with evidence", async ({ page }) => {
  await page.goto(`${baseURL}/demo`);
  await page.getByRole("button", { name: "Controls & Fraud", exact: true }).click();

  const summary = page.getByRole("region", { name: "Controls and fraud summary" });
  await expect(summary.getByText("Control exceptions requiring professional judgement")).toBeVisible();
  await expect(summary.getByText("£23,220")).toBeVisible();
  await expect(summary.getByText("No open control blocker")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Control Exception Register" })).toBeVisible();
  await expect(page.getByText("Potential duplicate supplier invoice closed")).toBeVisible();
  await expect(page.getByText("Suspense balance cleared before close")).toBeVisible();
  await expect(page.getByText(/not allegations or proof of fraud/i)).toBeVisible();
});
