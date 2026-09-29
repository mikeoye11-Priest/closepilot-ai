import { expect, test } from "@playwright/test";

test("browser responses enforce CSP without local HSTS", async ({ page }) => {
  const response = await page.goto("/demo", { waitUntil: "networkidle" });
  expect(response).not.toBeNull();
  const headers = response!.headers();
  expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(headers["content-security-policy"]).toContain("object-src 'none'");
  expect(headers["strict-transport-security"]).toBeUndefined();
  await expect(page.getByText("ClosePilot", { exact: false }).first()).toBeVisible();
});
