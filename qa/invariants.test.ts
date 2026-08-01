import test from "node:test";
import assert from "node:assert/strict";
import { checkInvariants } from "../apps/web/lib/invariants";
import { buildDebtorLedger } from "../apps/web/lib/debtor-ledger";
import { pilotStatements } from "../apps/web/lib/data";

const get = (report: ReturnType<typeof checkInvariants>, id: string) => report.invariants.find((i) => i.id === id);

test("pilot statements reconcile across all accounts invariants (incl. the modelled dividend)", () => {
  const report = checkInvariants({ statements: pilotStatements });
  assert.equal(get(report, "INV-01")?.status, "pass", "balance sheet balances");
  assert.equal(get(report, "INV-04")?.status, "pass", "trade creditors = aged creditors");
  assert.equal(get(report, "INV-06")?.status, "pass", "bank = balance-sheet cash");
  // £837,700 opening + £162,000 profit − £52,900 dividends = £946,800 closing → reconciles.
  assert.equal(get(report, "INV-02")?.status, "pass");
  assert.match(get(report, "INV-02")!.detail, /distributions/i);
});

test("an unexplained reserves movement (no modelled distribution) trips INV-02 to review", () => {
  const noBridge = { ...pilotStatements, equityMovements: [] };
  const report = checkInvariants({ statements: noBridge });
  assert.equal(get(report, "INV-02")?.status, "review");
  assert.match(get(report, "INV-02")!.detail, /not explained|confirm the equity/i);
});

test("a mis-signed / out-of-balance sheet fails INV-01", () => {
  const broken = {
    ...pilotStatements,
    balanceSheet: [
      { category: "Current Assets", item: "Cash at bank", amount: "100000" },
      { category: "Capital and reserves", item: "Retained earnings", amount: "50000" }, // net assets 100k ≠ equity 50k
    ],
    priorProfitLoss: [],
  };
  const report = checkInvariants({ statements: broken as never });
  assert.equal(get(report, "INV-01")?.status, "fail");
  assert.match(get(report, "INV-01")!.detail, /out of balance/i);
});

test("debtor invariants: TB↔aged reconcile; duplicates fail one-invoice-once", () => {
  const clean = buildDebtorLedger({ agedDebtors: [{ customer: "A", invoice_id: "1", amount: "1000", days_overdue: "10" }], tbControl: 1000 });
  const cleanReport = checkInvariants({ debtorLedger: clean });
  assert.equal(get(cleanReport, "INV-03")?.status, "pass");
  assert.equal(get(cleanReport, "INV-05")?.status, "pass");

  const dup = buildDebtorLedger({ tenantId: "t", companyId: "c", sourceProvider: "xero", agedDebtors: [
    { customer: "A", invoice_id: "1", amount: "1000", days_overdue: "10" },
    { customer: "A", invoice_id: "1", amount: "1000", days_overdue: "10" },
  ], tbControl: 3000 });
  const dupReport = checkInvariants({ debtorLedger: dup });
  assert.equal(get(dupReport, "INV-05")?.status, "fail", "duplicate balance breaks one-invoice-once");
  assert.equal(get(dupReport, "INV-03")?.status, "review", "TB 3000 vs aged 2000 needs explanation");
});

test("evidence coverage overmatch fails INV-07", () => {
  assert.equal(get(checkInvariants({ coverage: { sourceLinked: 1024, totalExposure: 950 } }), "INV-07")?.status, "fail");
  assert.equal(get(checkInvariants({ coverage: { sourceLinked: 900, totalExposure: 950 } }), "INV-07")?.status, "pass");
});
