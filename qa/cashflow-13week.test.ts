import test from "node:test";
import assert from "node:assert/strict";
import { buildThirteenWeekCashflow, thirteenWeekInputFromStatements } from "../apps/web/lib/cashflow-13week";
import { pilotStatements } from "../apps/web/lib/data";

test("weekly chain is internally consistent and schedules AR/AP by ageing", () => {
  const result = buildThirteenWeekCashflow({
    openingCash: 1000,
    startDate: "2026-06-01",
    agedReceivables: [{ amount: 500, daysOverdue: 40 }], // overdue → chased into week 1
    agedPayables: [{ amount: 200, daysOverdue: 0 }], // current → paid ~week 5 (30-day terms)
  });
  assert.equal(result.weeks.length, 13);
  // opening of each week equals the previous week's closing; closing = opening + net
  for (let i = 0; i < result.weeks.length; i += 1) {
    const w = result.weeks[i];
    assert.equal(w.closing, w.opening + w.net, `week ${w.week} closing = opening + net`);
    if (i > 0) assert.equal(w.opening, result.weeks[i - 1].closing, "opening rolls from prior closing");
  }
  assert.equal(result.weeks[0].receipts, 500, "overdue receivable lands in week 1");
  assert.equal(result.weeks[0].closing, 1500);
  assert.equal(result.weeks[4].payments, 200, "current payable settles ~week 5");
  assert.equal(result.closingCash, 1300);
  assert.equal(result.totalReceipts, 500);
  assert.equal(result.totalPayments, 200);
  assert.equal(result.lowestWeek, 5);
  assert.equal(result.lowestBalance, 1300);
  assert.equal(result.firstNegativeWeek, null);
});

test("flags the week cash turns negative", () => {
  const result = buildThirteenWeekCashflow({
    openingCash: 100,
    agedPayables: [{ amount: 500, daysOverdue: 120 }], // very overdue → paid week 1
  });
  assert.equal(result.firstNegativeWeek, 1);
  assert.equal(result.weeks[0].negative, true);
  assert.equal(result.lowestBalance, -400);
});

test("conservative scenario writes down 90+ day debtors vs base", () => {
  const statements = { agedDebtors: [{ amount: "10000", days_overdue: "120" }], bank: [{ closing_balance: "5000" }] };
  const base = buildThirteenWeekCashflow(thirteenWeekInputFromStatements(statements, "base"));
  const conservative = buildThirteenWeekCashflow(thirteenWeekInputFromStatements(statements, "conservative"));
  assert.equal(base.totalReceipts, 10000, "base collects the full doubtful debt");
  assert.equal(conservative.totalReceipts, 5000, "conservative applies a 50% write-down to 90+ day debt");
});

test("derives a full model from pilot statements (opening cash, run-rates, VAT one-off)", () => {
  const input = thirteenWeekInputFromStatements(pilotStatements, "base");
  assert.equal(input.openingCash, 142000, "opening cash = bank closing balances (128k + 14k)");
  assert.ok((input.weeklyPayroll ?? 0) > 0, "payroll run-rate derived from the P&L");
  assert.ok((input.weeklyOverheads ?? 0) > 0, "overhead run-rate derived from the P&L");
  assert.equal(input.oneOffs?.[0]?.label, "VAT payment", "VAT liability scheduled as a one-off payment");

  const result = buildThirteenWeekCashflow(input);
  assert.equal(result.weeks.length, 13);
  assert.equal(result.openingCash, 142000);
  assert.equal(result.totalReceipts, 268000, "all aged debtors scheduled (120k+78k+44k+26k)");
  assert.ok(result.totalPayments > 196000, "payments exceed the £196k creditors (payroll + overheads + VAT added)");
  assert.ok(result.assumptions.length >= 4, "assumptions surfaced for the manager to review");
});
