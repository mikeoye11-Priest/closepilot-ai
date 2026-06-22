import { expect, test } from "@playwright/test";

const baseURL = process.env.CLOSEPILOT_QA_URL ?? "http://127.0.0.1:3010";

test("user guide is discoverable and opens the guided workflow", async ({ page }) => {
  await page.goto(baseURL, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Guide", exact: true }).click();

  await expect(page.getByRole("heading", { name: "User Guide" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Follow one review from evidence to partner sign-off" })).toBeVisible();
  await expect(page.getByText("Do not upload, email or paste real client information during a demonstration.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Load Safe Pilot Demo" })).toBeVisible();
  await expect(page.getByText("60-Minute Demonstration")).toBeVisible();

  await page.getByRole("button", { name: "Load Safe Pilot Demo" }).click();
  await expect(page.getByRole("button", { name: "Reload Demo" })).toBeVisible();
  await page.getByRole("button", { name: "VAT Assurance" }).click();
  await expect(page.getByText("£15,200").first()).toBeVisible();
  await expect(page.getByText("142 VAT transaction(s) analysed.")).toBeVisible();
  await page.getByRole("button", { name: "Guide", exact: true }).click();
  await expect(page.getByRole("button", { name: "Reload Demo Data" })).toBeVisible();
});
