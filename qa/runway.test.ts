import test from "node:test";
import assert from "node:assert/strict";
import { buildRunway } from "../apps/web/lib/runway";
import { pilotStatements } from "../apps/web/lib/data";

test("pilot is cash-generative with sub-1-month cash cover", () => {
  const r = buildRunway(pilotStatements);
  assert.equal(r.status, "generative");
  assert.equal(r.cashOnHand, 142_000);
  // (net profit 162k + depreciation 74k) / 12 ≈ +£19.7k/month
  assert.ok(Math.abs(r.monthlyOperatingCash - (162_000 + 74_000) / 12) < 1);
  assert.equal(r.runwayMonths, null, "no finite runway while generating cash");
  // cash cover = 142k / ((1,340k + 578k − 74k)/12) ≈ 0.92 months
  assert.ok(r.cashCoverMonths > 0.7 && r.cashCoverMonths < 1.2, `cover ~0.9, got ${r.cashCoverMonths}`);
});

test("a loss-making pack reports a finite runway and burn date", () => {
  const loss = {
    ...pilotStatements,
    profitLoss: [
      { category: "Turnover", description: "Sales", amount: "300000" },
      { category: "Overheads", description: "Salaries", amount: "-500000" },
      { category: "Overheads", description: "Depreciation", amount: "-20000" },
    ],
    priorProfitLoss: [],
  };
  const r = buildRunway(loss as never);
  assert.equal(r.status, "burning");
  assert.ok((r.burnRateMonthly ?? 0) > 0);
  assert.ok((r.runwayMonths ?? 0) > 0, "finite runway");
  assert.ok(r.runwayDate && /^\d{4}-\d{2}-\d{2}$/.test(r.runwayDate), "burn date computed");
});
