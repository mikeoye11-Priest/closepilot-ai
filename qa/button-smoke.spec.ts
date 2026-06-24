import { expect, test } from "@playwright/test";

const baseURL = process.env.CLOSEPILOT_QA_URL ?? "http://127.0.0.1:3007";

const navItems = [
  "Partner Summary",
  "Finance Review",
  "Assurance Engine",
  "Upload Finance Pack",
  "Audit Readiness",
  "Review Pack",
  "Change Intelligence",
  "Cash Intelligence",
  "VAT Assurance",
  "Controls & Fraud",
  "Collections Intelligence",
  "Close Review",
  "Ask ClosePilot",
  "Practice Portal",
  "Settings",
];

function sidebarNav(page: import("@playwright/test").Page) {
  return page.locator("aside nav");
}

async function clickSidebarNav(page: import("@playwright/test").Page, name: string) {
  const button = sidebarNav(page).getByRole("button", { name, exact: true });
  await expect(button).toBeVisible({ timeout: 10000 });
  for (let attempt = 0; attempt < 2; attempt++) {
    await button.click({ timeout: 5000 }).catch(async () => {
      await button.evaluate((element) => (element as HTMLButtonElement).click());
    });
    const activeHeading = page.getByRole("heading", { name }).first();
    if (await activeHeading.isVisible({ timeout: 1500 }).catch(() => false)) return;
  }
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.clear();
    window.print = () => {};
  });
});

async function onboardCompany(page: import("@playwright/test").Page) {
  await page.goto(baseURL);
  await expect(page.getByRole("heading", { name: "Onboarding" })).toBeVisible();
  await page.getByRole("button", { name: "Single company" }).click();
  await page.getByLabel("Company name").fill("QA Smoke Client Ltd");
  await page.getByLabel("Industry").fill("Professional Services");
  await page.getByRole("button", { name: "Create Workspace" }).click();
}

async function uploadDemoPack(page: import("@playwright/test").Page) {
  await clickSidebarNav(page, "Upload Finance Pack");
  await expect(page.getByRole("heading", { level: 1, name: "Upload Finance Pack" })).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles([
    "demo-data/trial-balance-may.csv",
    "demo-data/profit-loss-may.csv",
    "demo-data/balance-sheet-may.csv",
    "demo-data/aged-debtors-may.csv",
    "demo-data/aged-creditors-may.csv",
    "demo-data/vat-detail-may.csv",
  ]);
  await expect(page.getByRole("heading", { level: 1, name: "Finance Review" })).toBeVisible({ timeout: 30000 });
}

test("login page buttons toggle and report missing credentials", async ({ page }) => {
  await page.goto(`${baseURL}/login`);
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page.getByRole("heading", { name: "Create your account" })).toBeVisible();
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  await page.getByRole("button", { name: "Sign in" }).first().click();
  await expect(page.getByText(/Supabase is not configured|Invalid login credentials|Email/i)).toBeVisible();
});

test("sidebar module navigation works", async ({ page }) => {
  test.setTimeout(60000);
  await onboardCompany(page);

  for (const item of navItems) {
    await clickSidebarNav(page, item);
    await expect(page.getByRole("heading", { name: item }).first()).toBeVisible({ timeout: 10000 });
  }
});

test("workflow buttons, downloads and review pack controls work", async ({ page }) => {
  test.setTimeout(120000);
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error" && !msg.text().includes("Download the React DevTools")) consoleErrors.push(msg.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await onboardCompany(page);
  await uploadDemoPack(page);

  await clickSidebarNav(page, "Finance Review");
  await page.getByRole("button", { name: "Open Assurance Engine" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Assurance Engine" })).toBeVisible();
  await clickSidebarNav(page, "Finance Review");
  await page.getByRole("button", { name: "Explain Score" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Ask ClosePilot" })).toBeVisible();

  await clickSidebarNav(page, "Review Pack");
  await expect(page.getByRole("heading", { level: 1, name: "Review Pack" })).toBeVisible();
  await page.getByLabel("Prepared By").fill("QA Reviewer");
  await page.getByLabel("Reviewed By").fill("QA Partner");
  await page.getByLabel("Pack Type").selectOption("client");
  await expect(page.getByText("QA Partner").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Close Sign-Off Reconciliations" })).toBeVisible();
  await expect(page.getByText("P&L agrees to trial balance movement").first()).toBeVisible();

  const csvDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Findings CSV" }).click();
  await expect((await csvDownload).suggestedFilename()).toContain("findings.csv");

  const jsonDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Evidence JSON" }).click();
  await expect((await jsonDownload).suggestedFilename()).toMatch(/review_pack\.json$/);

  await page.getByRole("button", { name: "Export PDF" }).click();

  await clickSidebarNav(page, "Settings");
  await page.getByRole("button", { name: "Save Settings" }).click();
  await expect(page.getByText("Settings saved.")).toBeVisible();

  await page.getByRole("button", { name: "Export Review" }).click();
  await expect(page.getByRole("heading", { name: "QA Smoke Client Ltd" })).toBeVisible();
  await page.getByRole("button", { name: "Manager Summary" }).click();
  await expect(page.getByRole("heading", { name: "Manager Summary" })).toBeVisible();
  await expect(page.getByText("Manager Sign-Off Focus")).toBeVisible();
  await page.getByRole("button", { name: "Evidence Appendix" }).click();
  await expect(page.getByRole("heading", { name: "Evidence Appendix" })).toBeVisible();
  await expect(page.getByText("Full Evidence Register")).toBeVisible();
  await page.getByRole("button", { name: "Client Pack" }).click();
  await expect(page.getByRole("heading", { name: "Client Pack" })).toBeVisible();
  await expect(page.getByText("Client Summary")).toBeVisible();
  const modalCsv = page.waitForEvent("download");
  await page.getByRole("button", { name: "CSV" }).click();
  await expect((await modalCsv).suggestedFilename()).toContain("findings.csv");
  const modalJson = page.waitForEvent("download");
  await page.getByRole("button", { name: "Evidence Pack" }).click();
  await expect((await modalJson).suggestedFilename()).toMatch(/review_pack\.json$/);
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();

  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test("clearing uploaded data resets review statistics", async ({ page }) => {
  test.setTimeout(60000);
  await onboardCompany(page);
  await uploadDemoPack(page);

  page.on("dialog", (dialog) => dialog.accept());
  await clickSidebarNav(page, "Upload Finance Pack");
  await page.getByRole("button", { name: "Clear Review" }).click();

  await expect(page.getByText("No files uploaded yet.").first()).toBeVisible();
  await expect(page.getByText(/0 finance exports reviewed, 0 items to resolve/)).toBeVisible();
  await expect(page.getByText("No validation checks yet. Upload a finance pack to begin.")).toBeVisible();
  await expect(page.getByText("VAT Report uploaded")).not.toBeVisible();

  await clickSidebarNav(page, "Partner Summary");
  await expect(page.getByText(/0 finance exports reviewed, 0 items to resolve/)).toBeVisible();
  await expect(page.getByText("Awaiting upload").first()).toBeVisible();
  await expect(page.getByText("93/100")).not.toBeVisible();

  await clickSidebarNav(page, "VAT Assurance");
  await expect(page.getByRole("heading", { name: "Upload VAT transactions or a VAT return export." })).toBeVisible();
  await expect(page.getByText("HMRC VAT Return Ready for Review")).not.toBeVisible();
});

test("VAT review pack controls render after VAT upload", async ({ page }) => {
  test.setTimeout(60000);
  await onboardCompany(page);
  await clickSidebarNav(page, "Upload Finance Pack");
  await page.locator('input[type="file"]').setInputFiles(["demo-data/vat-detail-may.csv"]);
  await expect(page.getByRole("heading", { level: 1, name: "Finance Review" })).toBeVisible({ timeout: 30000 });

  await clickSidebarNav(page, "VAT Assurance");
  await expect(page.getByRole("heading", { name: "VAT Review Pack" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Print VAT Pack" })).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "VAT Evidence JSON" }).click();
  await expect((await download).suggestedFilename()).toBe("closepilot_vat_evidence_pack.json");
});
