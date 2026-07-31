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

test("conservative scenario writes down 90+ day debtors vs base (attributed)", () => {
  const statements = { agedDebtors: [{ customer: "Acme Ltd", amount: "10000", days_overdue: "120" }], bank: [{ closing_balance: "5000" }] };
  const base = buildThirteenWeekCashflow(thirteenWeekInputFromStatements(statements, "base"));
  const conservative = buildThirteenWeekCashflow(thirteenWeekInputFromStatements(statements, "conservative"));
  assert.equal(base.totalReceipts, 10000, "base collects the full attributed doubtful debt");
  assert.equal(conservative.totalReceipts, 5000, "conservative applies a 50% write-down to 90+ day debt");
});

test("unattributed receivables are scenario-weighted (base) and excluded (conservative)", () => {
  // no customer name → unattributed; days_overdue 10 so no doubtful-debt haircut.
  const statements = { agedDebtors: [{ amount: "10000", days_overdue: "10" }], bank: [{ closing_balance: "0" }] };
  const base = buildThirteenWeekCashflow(thirteenWeekInputFromStatements(statements, "base"));
  const conservative = buildThirteenWeekCashflow(thirteenWeekInputFromStatements(statements, "conservative"));
  const upside = buildThirteenWeekCashflow(thirteenWeekInputFromStatements(statements, "upside"));
  assert.equal(base.receivables.unattributed, 10000);
  assert.equal(base.receivables.attributed, 0);
  assert.equal(base.receivables.recognised, 7000, "base recognises 70% of unattributed");
  assert.equal(conservative.receivables.recognised, 0, "conservative excludes unattributed");
  assert.equal(upside.receivables.recognised, 10000, "upside recognises all");
});

test("every headline figure reconciles exactly", () => {
  const result = buildThirteenWeekCashflow(thirteenWeekInputFromStatements(pilotStatements, "base"));
  assert.equal(result.netMovement, result.closingCash - result.openingCash, "net movement = closing − opening");
  assert.equal(result.totalReceipts - result.totalPayments, result.netMovement, "receipts − payments = net movement");
  assert.equal(result.weeks[result.weeks.length - 1].closing, result.closingCash, "last week closing = headline closing");
  assert.equal(result.receivables.attributed + result.receivables.unattributed, result.receivables.aged, "attributed + unattributed = aged");
});

test("forecast starts the current week, not the (past) reporting date", () => {
  const result = buildThirteenWeekCashflow(thirteenWeekInputFromStatements(pilotStatements, "base"));
  const monday = new Date(`${result.weeks[0].weekStart}T00:00:00Z`);
  assert.equal(monday.getUTCDay(), 1, "week 1 begins on a Monday");
  assert.ok(result.weeks[0].weekStart >= new Date().toISOString().slice(0, 10), "week 1 is today or later — not 2026-05");
});

test("opening cash is flagged unevidenced when there is no bank balance", () => {
  const withBank = thirteenWeekInputFromStatements(pilotStatements, "base");
  assert.equal(buildThirteenWeekCashflow(withBank).openingCashEvidenced, true);
  const noBank = thirteenWeekInputFromStatements({ ...pilotStatements, bank: [] }, "base");
  assert.equal(buildThirteenWeekCashflow(noBank).openingCashEvidenced, false, "no bank rows → unevidenced opening");
});

test("what-if levers: collecting faster and paying later both lift the low point", () => {
  const base = thirteenWeekInputFromStatements(pilotStatements, "base");
  const baseLow = buildThirteenWeekCashflow(base).lowestBalance;
  // Collect 14 days faster → receipts land earlier → tightest point no worse.
  const faster = buildThirteenWeekCashflow({ ...base, receivableTermDays: (base.termDays ?? 30) - 14 });
  assert.ok(faster.lowestBalance >= baseLow, "faster collection does not worsen the low point");
  // Pay suppliers 21 days later → payments deferred → low point improves.
  const later = buildThirteenWeekCashflow({ ...base, payableTermDays: (base.termDays ?? 30) + 21 });
  assert.ok(later.lowestBalance >= baseLow, "deferring supplier payments lifts the low point");
  // A one-off finance drawdown lifts every subsequent closing balance.
  const drawdown = buildThirteenWeekCashflow({ ...base, oneOffs: [...(base.oneOffs ?? []), { week: 1, amount: 100_000, label: "Facility drawdown" }] });
  assert.equal(drawdown.closingCash, buildThirteenWeekCashflow(base).closingCash + 100_000);
});

test("weeklyReceipts override makes 13-week receipts equal the supplied recovery scenario", () => {
  const weekly = new Array(14).fill(0);
  weekly[1] = 1000; weekly[6] = 500;
  const r = buildThirteenWeekCashflow({ openingCash: 0, weeklyReceipts: weekly, receivablesOverride: { aged: 2000, attributed: 2000, unattributed: 0, recognised: 1500 } });
  assert.equal(r.totalReceipts, 1500, "receipts = the supplied recovery scenario, not re-scheduled aged debtors");
  assert.equal(r.receivables.recognised, 1500);
  assert.equal(r.weeks[0].receipts, 1000);
  assert.equal(r.weeks[5].receipts, 500);
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
