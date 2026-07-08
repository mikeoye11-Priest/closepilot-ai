import { expect, test, type Page } from "@playwright/test";

const baseURL = process.env.CLOSEPILOT_QA_URL ?? "http://localhost:3010";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.clear();
    window.print = () => {};
  });
});

async function expectNoRuntimeErrors(page: Page, action: () => Promise<void>) {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];

  page.on("console", (msg) => {
    if (msg.type() === "error" && !msg.text().includes("Download the React DevTools")) {
      consoleErrors.push(msg.text());
    }
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await action();

  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
}

async function expectNoHorizontalOverflow(page: Page) {
  await expect.poll(
    () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    { message: "page should not require horizontal scrolling" },
  ).toBe(true);
}

async function expectTailwindStylesAreApplied(page: Page) {
  const shell = page.locator("aside").first();
  const primaryButton = page.getByRole("button", { name: "Export Review" });
  const heading = page.getByRole("heading", { name: "Partner Summary", exact: true }).first();

  await expect(shell).toBeVisible();
  await expect(primaryButton).toBeVisible();
  await expect(heading).toBeVisible();

  const styles = await page.evaluate(() => {
    const aside = document.querySelector("aside");
    const button = Array.from(document.querySelectorAll("button")).find((element) => element.textContent?.includes("Export Review"));
    const heading = Array.from(document.querySelectorAll("h1, h2")).find((element) => element.textContent?.includes("Partner Summary"));
    if (!aside || !button || !heading) return null;

    const asideStyle = getComputedStyle(aside);
    const buttonStyle = getComputedStyle(button);
    const headingStyle = getComputedStyle(heading);

    return {
      asideBackground: asideStyle.backgroundColor,
      buttonBackground: buttonStyle.backgroundColor,
      headingFontWeight: Number(headingStyle.fontWeight),
      headingFontSize: Number.parseFloat(headingStyle.fontSize),
    };
  });

  expect(styles).not.toBeNull();
  expect(styles?.asideBackground).not.toBe("rgba(0, 0, 0, 0)");
  expect(styles?.buttonBackground).not.toBe("rgba(0, 0, 0, 0)");
  expect(styles?.headingFontWeight).toBeGreaterThanOrEqual(700);
  expect(styles?.headingFontSize).toBeGreaterThanOrEqual(24);
}

async function expectRenderedCharts(page: Page) {
  const chartSvgs = page.locator(".recharts-wrapper svg");
  await expect(chartSvgs.first()).toBeVisible({ timeout: 10000 });
  await expect.poll(() => chartSvgs.count(), { message: "demo dashboard should render Recharts SVGs" }).toBeGreaterThanOrEqual(2);

  const chartStats = await chartSvgs.evaluateAll((svgs) =>
    svgs.map((svg) => {
      const rect = svg.getBoundingClientRect();
      return {
        width: rect.width,
        height: rect.height,
        shapeCount: svg.querySelectorAll("path,line,rect,circle,polygon,polyline").length,
      };
    }),
  );

  expect(chartStats.some((chart) => chart.width > 40 && chart.height > 40 && chart.shapeCount > 0)).toBe(true);
}

test("desktop demo shell keeps Tailwind layout and chart rendering intact", async ({ page }) => {
  await expectNoRuntimeErrors(page, async () => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(`${baseURL}/demo`);

    await expectTailwindStylesAreApplied(page);
    await expectRenderedCharts(page);
    await expectNoHorizontalOverflow(page);
  });
});

test("mobile demo shell remains usable after styling upgrades", async ({ page }) => {
  await expectNoRuntimeErrors(page, async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${baseURL}/demo`);

    await expect(page.getByRole("heading", { name: "Partner Summary", exact: true }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Finance Review", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Review Pack", exact: true })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
});
