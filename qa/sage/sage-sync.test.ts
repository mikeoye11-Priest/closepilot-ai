import test from "node:test";
import assert from "node:assert/strict";
import { deriveSageStatements } from "../../apps/web/lib/integrations/sage-sync";
import { buildManagementAccounts } from "../../apps/web/lib/management-accounts";
import { buildStatutoryAccounts } from "../../apps/web/lib/statutory-accounts";

// Representative Sage trial-balance accounts + the ledger-account classification
// map (Sage exposes the class per account). P&L uses the period movement
// (debit/credit), the balance sheet uses the closing balance.
const tbAccounts = [
  { displayed_as: "Sales", nominal_code: "4000", debit: 0, credit: 200000, closing_balance: { debit: 0, credit: 200000 } },
  { displayed_as: "Purchases", nominal_code: "5000", debit: 80000, credit: 0, closing_balance: { debit: 80000, credit: 0 } },
  { displayed_as: "Rent", nominal_code: "7100", debit: 30000, credit: 0, closing_balance: { debit: 30000, credit: 0 } },
  { displayed_as: "Depreciation", nominal_code: "8000", debit: 10000, credit: 0, closing_balance: { debit: 10000, credit: 0 } },
  { displayed_as: "Plant and Machinery", nominal_code: "0020", closing_balance: { debit: 60000, credit: 0 } },
  { displayed_as: "Trade Debtors", nominal_code: "1100", closing_balance: { debit: 40000, credit: 0 } },
  { displayed_as: "Bank Current Account", nominal_code: "1200", closing_balance: { debit: 20000, credit: 0 } },
  { displayed_as: "Trade Creditors", nominal_code: "2100", closing_balance: { debit: 0, credit: 30000 } },
  { displayed_as: "Share Capital", nominal_code: "3000", closing_balance: { debit: 0, credit: 1000 } },
  { displayed_as: "Retained Earnings", nominal_code: "3200", closing_balance: { debit: 0, credit: 9000 } },
];
const classByName = new Map<string, string>([
  ["Sales", "Sales"], ["Purchases", "Cost of Sales"], ["Rent", "Overheads"], ["Depreciation", "Overheads"],
  ["Plant and Machinery", "Fixed Assets"], ["Trade Debtors", "Current Assets"], ["Bank Current Account", "Current Assets"],
  ["Trade Creditors", "Current Liabilities"], ["Share Capital", "Equity"], ["Retained Earnings", "Equity"],
]);

test("Sage TB → derived P&L / balance sheet using ledger-account classification", () => {
  const { profitLoss, balanceSheet, trialBalance } = deriveSageStatements(tbAccounts as never, classByName);
  assert.ok(trialBalance.length >= 10, "trial balance rows produced");

  const statements = { asOfDate: "2026-12-31", periodStart: "2026-01-01", currency: "GBP", companyName: "Sage Ltd", profitLoss, balanceSheet, agedDebtors: [], agedCreditors: [], bank: [], trialBalance };
  const ma = buildManagementAccounts(statements as never);
  assert.equal(ma.pl.revenue, 200000, "income accounts → revenue");
  assert.equal(ma.pl.netProfit, 80000, "200k − 80k − 30k − 10k");
  assert.equal(ma.bs.totalFixed, 60000, "fixed-asset class → fixed assets");
  assert.equal(ma.bs.totalLiabilities, 30000);
  // Reserves get the current-year profit, so the derived sheet balances.
  assert.ok(Math.abs(ma.bs.netAssets - ma.bs.totalEquity) <= 1, "balance sheet balances");
  assert.equal(buildStatutoryAccounts(statements as never).balanced, true);
});

test("empty inputs → empty statements (no throw)", () => {
  const { profitLoss, balanceSheet, trialBalance } = deriveSageStatements([], new Map());
  assert.deepEqual([profitLoss.length, balanceSheet.length, trialBalance.length], [0, 0, 0]);
});
