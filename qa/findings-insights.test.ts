import test from "node:test";
import assert from "node:assert/strict";
import { buildFindingsInsights } from "../apps/web/lib/findings-insights";

const finding = (over: Record<string, unknown>) => ({
  id: "f", tenantId: "t", companyId: "c", severity: "medium", category: "ar", title: "Finding", description: "", expectedImpact: "", status: "open", evidence: { sourceFile: "x" },
  ...over,
} as never);

test("ranks open findings by severity × exposure and skips closed ones", () => {
  const insights = buildFindingsInsights([
    finding({ id: "1", severity: "medium", category: "ar", title: "Small debtor query", amount: 5_000 }),
    finding({ id: "2", severity: "critical", category: "vat", title: "Unreconciled VAT control", amount: 40_000, evidenceStrength: "deterministic" }),
    finding({ id: "3", severity: "high", category: "ap", title: "Duplicate supplier payment", amount: 12_000 }),
    finding({ id: "4", severity: "high", category: "controls", title: "Resolved item", amount: 99_000, status: "resolved" }),
  ]);
  assert.equal(insights.available, true);
  assert.equal(insights.openCount, 3, "resolved finding excluded");
  assert.equal(insights.totalExposure, 57_000, "5k + 40k + 12k");
  assert.equal(insights.signals[0].title, "Unreconciled VAT control", "highest impact ranked first");
  assert.match(insights.signals[0].action, /Priority #1/);
  assert.match(insights.headline, /Unreconciled VAT control/);
  assert.match(insights.factSheet, /TOP PRIORITIES/);
});

test("no open findings → not available", () => {
  const insights = buildFindingsInsights([finding({ status: "approved" }), finding({ status: "closed" })]);
  assert.equal(insights.available, false);
  assert.match(insights.headline, /clear/i);
});
