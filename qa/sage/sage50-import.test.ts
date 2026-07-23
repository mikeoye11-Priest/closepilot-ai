import test from "node:test";
import assert from "node:assert/strict";
import { recogniseFinanceDocument } from "../../apps/web/lib/import-engine/recogniser";
import { buildStatementsFromUploads } from "../../apps/web/lib/upload-statements";
import { buildManagementAccounts } from "../../apps/web/lib/management-accounts";

// Sage 50 has no cloud API — its exports flow through the upload path. Rows keyed
// as they appear after parsing (N/C → account_code alias, Name → name).
const sage50Tb = [
  { account_code: "4000", name: "Sales", debit: "0", credit: "200000" },
  { account_code: "5000", name: "Purchases", debit: "80000", credit: "0" },
  { account_code: "7100", name: "Rent", debit: "30000", credit: "0" },
  { account_code: "8000", name: "Depreciation", debit: "10000", credit: "0" },
  { account_code: "0020", name: "Plant and Machinery", debit: "60000", credit: "0" },
  { account_code: "1100", name: "Trade Debtors", debit: "40000", credit: "0" },
  { account_code: "1200", name: "Bank Current Account", debit: "20000", credit: "0" },
  { account_code: "2100", name: "Trade Creditors", debit: "0", credit: "30000" },
  { account_code: "3000", name: "Share Capital", debit: "0", credit: "1000" },
  { account_code: "3200", name: "Retained Earnings", debit: "0", credit: "9000" },
];

test("Sage 50 export headers are recognised as a trial balance (N/C alias) from Sage", () => {
  const detection = recogniseFinanceDocument("sage-50-nominal-trial-balance.csv", ["N/C", "Name", "Debit", "Credit"], sage50Tb);
  assert.equal(detection.fileType, "trial_balance");
  assert.equal(detection.detectedVendor, "Sage");
});

test("Sage 50 trial balance → balancing accounts via the upload path", () => {
  const file = { upload: { id: "u", tenantId: "t", companyId: "c", fileType: "trial_balance", fileName: "sage-tb.csv", uploadedAt: "2026-12-31" }, headers: ["account_code", "name", "debit", "credit"], rows: sage50Tb, isParsed: true };
  const statements = buildStatementsFromUploads([file] as never, { companyName: "Sage 50 Ltd" });
  assert.ok(statements, "statements built from the Sage 50 TB");
  const ma = buildManagementAccounts(statements!);
  assert.equal(ma.pl.revenue, 200000);
  assert.equal(ma.pl.netProfit, 80000);
  assert.ok(Math.abs(ma.bs.netAssets - ma.bs.totalEquity) <= 1, "balances (current-year earnings added)");
});
