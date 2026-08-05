import test from "node:test";
import assert from "node:assert/strict";
import { buildConcentration } from "../apps/web/lib/concentration";
import { buildDebtorLedger, debtorExposure } from "../apps/web/lib/debtor-ledger";
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
  assert.equal(dup.customers[0].balance, 400, "distinct invoices for one customer are summed");
  assert.equal(dup.customers.length, 2);
  assert.equal(buildConcentration({ agedDebtors: [] }).available, false);
});

test("one invoice once: a truly duplicated aged line is excluded, not double-counted", () => {
  // Same customer, same amount, no invoice id/ref/date → identical canonical
  // fingerprint → the second is a duplicate and must not inflate the share.
  const rows = [
    { customer: "Acme", amount: "300" },
    { customer: "Acme", amount: "300" }, // duplicate of the row above
    { customer: "Beta", amount: "200" },
  ];
  const report = buildConcentration({ agedDebtors: rows });
  assert.equal(report.totalAr, 500, "500, not 800 — the duplicate £300 line is excluded");
  assert.equal(report.customers.find((c) => c.name === "Acme")?.balance, 300, "Acme counted once");
});

test("concentration totalAr reconciles to the canonical debtor exposure", () => {
  // The migrated module and debtorExposure() must report ONE debtor total.
  const rows = [
    { customer: "Acme", amount: "300", invoice_id: "INV-1" },
    { customer: "Acme", amount: "300", invoice_id: "INV-1" }, // duplicate invoice
    { customer: "Beta", amount: "200", invoice_id: "INV-2" },
    { amount: "150" }, // unattributed
  ];
  const ledger = buildDebtorLedger({ agedDebtors: rows });
  const exposure = debtorExposure(ledger);
  const report = buildConcentration({ agedDebtors: rows }, ledger);
  assert.equal(report.totalAr, exposure.exposure, "totalAr == de-duplicated exposure");
  assert.equal(report.attributedTotal, exposure.supported, "attributed == supported balance");
  assert.equal(report.unattributed, exposure.unattributed);
});
