import test from "node:test";
import assert from "node:assert/strict";
import { buildConcentration } from "../apps/web/lib/concentration";
import { pilotStatements } from "../apps/web/lib/data";

test("measures customer concentration from aged debtors (pilot is high)", () => {
  const report = buildConcentration(pilotStatements);
  assert.equal(report.available, true);
  assert.equal(report.totalAr, 268_000);
  assert.equal(report.customers[0].name, "Delphi Retail Group");
  assert.ok(Math.abs(report.customers[0].share - 120_000 / 268_000) < 0.001);
  assert.ok(Math.abs(report.top1Share - 120_000 / 268_000) < 0.001); // ~44.8%
  assert.ok(report.top3Share > 0.85, "top 3 customers are >85% of AR");
  assert.ok(report.hhi > 2500, "HHI signals high concentration");
  assert.equal(report.level, "high", "one customer at ~45% → high dependency");
});

test("a mostly-unattributed book is not assessable and reports no top customer", () => {
  const report = buildConcentration({ agedDebtors: [
    { customer: "Acme", amount: "100" },
    { amount: "9000" }, // no customer → unattributed, dominates
  ] });
  assert.equal(report.available, true);
  assert.equal(report.attributable, false, "cannot assess when >50% unattributed");
  assert.equal(report.level, "low", "does not claim high concentration");
  assert.ok(Math.abs(report.unattributedShare - 9000 / 9100) < 0.001);
  assert.equal(report.unattributed, 9000);
});

test("aggregates duplicate customer rows and handles empty input", () => {
  const dup = buildConcentration({ agedDebtors: [
    { customer: "Acme", amount: "100" },
    { customer: "Acme", amount: "300" },
    { customer: "Beta", amount: "400" },
  ] });
  assert.equal(dup.customers[0].name, "Acme");
  assert.equal(dup.customers[0].balance, 400, "duplicate rows summed");
  assert.equal(dup.customers.length, 2);
  assert.equal(buildConcentration({ agedDebtors: [] }).available, false);
});
