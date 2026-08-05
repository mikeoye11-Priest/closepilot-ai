import test from "node:test";
import assert from "node:assert/strict";
import { buildWorkingCapital } from "../apps/web/lib/working-capital";
import { pilotStatements } from "../apps/web/lib/data";

const approx = (actual: number | null, expected: number, tol = 1) => {
  assert.ok(actual !== null && Math.abs(actual - expected) <= tol, `expected ~${expected}, got ${actual}`);
};

test("computes DSO/DPO/DIO/CCC + the cash-release lever from pilot statements", () => {
  const wc = buildWorkingCapital(pilotStatements);
  assert.equal(wc.available, true);
  assert.equal(wc.revenue, 2_080_000);
  assert.equal(wc.cogs, 1_340_000);
  assert.equal(wc.debtors, 268_000);
  assert.equal(wc.creditors, 196_000);
  assert.equal(wc.inventory, 310_000);

  approx(wc.dso, (268_000 / 2_080_000) * 365); // ~47 days
  approx(wc.dpo, (196_000 / 1_340_000) * 365); // ~53 days
  approx(wc.dio, (310_000 / 1_340_000) * 365); // ~84 days
  approx(wc.ccc, (wc.dso ?? 0) + (wc.dio ?? 0) - (wc.dpo ?? 0));
  approx(wc.cashPerDsoDay, 2_080_000 / 365); // ~£5.7k released per DSO day
});

test("one invoice once: a duplicated debtor line does not overstate DSO", () => {
  // Same P&L as pilot, but the aged debtors carry a duplicated £120k line.
  const withDup = {
    ...pilotStatements,
    agedDebtors: [...pilotStatements.agedDebtors!, { customer: "Delphi Retail Group", amount: "120000", days_overdue: "0" }],
  };
  const wc = buildWorkingCapital(withDup);
  assert.equal(wc.debtors, 268_000, "debtors stay at the de-duplicated £268k, not £388k");
  approx(wc.dso, (268_000 / 2_080_000) * 365, 1);
});

test("gracefully unavailable with no revenue", () => {
  const wc = buildWorkingCapital({ asOfDate: "2026-12-31", profitLoss: [], balanceSheet: [], agedDebtors: [], agedCreditors: [], bank: [], trialBalance: [] } as never);
  assert.equal(wc.available, false);
  assert.equal(wc.dso, null);
  assert.equal(wc.ccc, null);
});
