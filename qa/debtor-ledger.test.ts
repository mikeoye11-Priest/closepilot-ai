import test from "node:test";
import assert from "node:assert/strict";
import { buildDebtorLedger, forecastRecovery } from "../apps/web/lib/debtor-ledger";

// Pre-pilot acceptance criteria for the canonical debtor bridge (engine level).

test("TB control agrees to aged debtors; unique reconciles to the aged report", () => {
  const l = buildDebtorLedger({
    agedDebtors: [
      { customer: "Acme", invoice_id: "1", amount: "3000", days_overdue: "10" },
      { customer: "Beta", invoice_id: "2", amount: "2282", days_overdue: "40" },
    ],
    tbControl: 5282,
  });
  assert.equal(l.bridge.agedTotal, 5282);
  assert.equal(l.bridge.difference, 0);
  assert.equal(l.bridge.reconciled, true);
  assert.equal(l.bridge.uniqueInvoiceBalance, 5282, "unique invoice balances reconcile to the aged report");
  assert.equal(l.validationBlockers.length, 0);
});

test("a duplicate canonical match does not increase exposure and raises a blocker", () => {
  const l = buildDebtorLedger({
    tenantId: "t", companyId: "c", sourceProvider: "xero",
    agedDebtors: [
      { customer: "Acme", invoice_id: "1", amount: "1000", days_overdue: "95" },
      { customer: "Acme", invoice_id: "1", amount: "1000", days_overdue: "95" },
    ],
  });
  assert.equal(l.bridge.agedTotal, 2000, "aged report shows both rows");
  assert.equal(l.bridge.uniqueInvoiceBalance, 1000, "counted once");
  assert.equal(l.bridge.duplicatesExcluded, 1000);
  assert.equal(l.unique.length, 1, "one canonical invoice");
  assert.ok(l.validationBlockers.some((b) => /duplicate/i.test(b)));
});

test("a 90+ invoice appears once; its ageing/risk signals are children, not extra balance", () => {
  const l = buildDebtorLedger({ agedDebtors: [{ customer: "Acme", invoice_id: "9", amount: "500", days_overdue: "120" }] });
  assert.equal(l.unique.length, 1);
  assert.equal(l.unique[0].band, "d90plus");
  assert.ok(l.unique[0].signals.includes("90+ days") && l.unique[0].signals.includes("high collection risk"));
  assert.equal(l.bridge.uniqueInvoiceBalance, 500, "balance counts once despite several signals");
});

test("customer totals equal their unique invoices", () => {
  const l = buildDebtorLedger({
    agedDebtors: [
      { customer: "Acme", invoice_id: "1", amount: "1000", days_overdue: "5" },
      { customer: "Acme", invoice_id: "2", amount: "500", days_overdue: "40" },
      { customer: "Beta", invoice_id: "3", amount: "800", days_overdue: "5" },
    ],
  });
  const acme = l.unique.filter((r) => r.customer === "Acme").reduce((s, r) => s + r.balance, 0);
  assert.equal(acme, 1500);
  assert.equal(l.bridge.customerAttributed, 2300);
});

test("unattributed balances are isolated and excluded from the base forecast", () => {
  const l = buildDebtorLedger({ agedDebtors: [
    { customer: "Acme", invoice_id: "1", amount: "1000", days_overdue: "10" },
    { amount: "400", days_overdue: "10" }, // no customer → unattributed
  ] });
  assert.equal(l.bridge.customerAttributed, 1000);
  assert.equal(l.bridge.unattributed, 400);
  const base = forecastRecovery(l, "base");
  assert.equal(base.excludedUnattributed, 400);
  assert.equal(base.expected, 900, "attributed £1,000 at 1–30 (0.90); unattributed excluded");
});

test("recovery forecast draws only on eligible unique balances; scenarios are ordered", () => {
  const l = buildDebtorLedger({ agedDebtors: [{ customer: "Acme", invoice_id: "1", amount: "1000", days_overdue: "75" }] }); // 61–90
  assert.equal(forecastRecovery(l, "conservative").expected, 350); // ×0.35
  assert.equal(forecastRecovery(l, "base").expected, 650); // ×0.65
  assert.equal(forecastRecovery(l, "upside").expected, 850); // ×0.85
});

test("valid promise uses the promise probability; a broken promise is reduced", () => {
  const today = "2026-08-01";
  const valid = buildDebtorLedger({ today, agedDebtors: [{ customer: "Acme", invoice_id: "1", amount: "1000", days_overdue: "75" }], collectionCases: [{ customer: "Acme", status: "promised", promiseAmount: 1000, promiseDate: "2026-08-20" }] });
  const broken = buildDebtorLedger({ today, agedDebtors: [{ customer: "Acme", invoice_id: "1", amount: "1000", days_overdue: "75" }], collectionCases: [{ customer: "Acme", status: "promised", promiseAmount: 1000, promiseDate: "2026-07-01" }] });
  assert.equal(valid.unique[0].profile, "valid_promise");
  assert.equal(broken.unique[0].profile, "overdue_promise");
  assert.equal(forecastRecovery(valid, "base", undefined, today).expected, 950); // 1000 × 0.95
  assert.equal(forecastRecovery(broken, "base", undefined, today).expected, 500); // 1000 × 0.50
});

test("disputed invoices score at the dispute probability (excluded in conservative)", () => {
  const l = buildDebtorLedger({ agedDebtors: [{ customer: "Acme", invoice_id: "1", amount: "1000", days_overdue: "20" }], collectionCases: [{ customer: "Acme", status: "disputed" }] });
  assert.equal(l.unique[0].profile, "disputed");
  assert.equal(l.bridge.disputed, 1000);
  assert.equal(forecastRecovery(l, "base").expected, 200); // ×0.20
  assert.equal(forecastRecovery(l, "conservative").expected, 0); // excluded
});

test("canonical key confidence + TB mismatch blocker", () => {
  assert.equal(buildDebtorLedger({ agedDebtors: [{ customer: "Acme", invoice_id: "1", amount: "100", days_overdue: "0" }] }).unique[0].keyConfidence, "high");
  assert.equal(buildDebtorLedger({ agedDebtors: [{ customer: "Acme", reference: "R1", date: "2026-06-01", amount: "100", days_overdue: "0" }] }).unique[0].keyConfidence, "low");
  const mismatch = buildDebtorLedger({ agedDebtors: [{ customer: "Acme", invoice_id: "1", amount: "1000", days_overdue: "0" }], tbControl: 1200 });
  assert.equal(mismatch.bridge.reconciled, false);
  assert.equal(mismatch.bridge.difference, 200);
  assert.ok(mismatch.validationBlockers.some((b) => /does not agree/i.test(b)));
});
