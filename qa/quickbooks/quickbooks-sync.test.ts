import test from "node:test";
import assert from "node:assert/strict";
import {
  flattenQboProfitAndLoss,
  flattenQboBalanceSheet,
  flattenQboTrialBalance,
  flattenQboAged,
  txnVatRow,
} from "../../apps/web/lib/integrations/quickbooks-sync";
import { buildManagementAccounts } from "../../apps/web/lib/management-accounts";
import { buildStatutoryAccounts } from "../../apps/web/lib/statutory-accounts";

// Representative (simplified) QuickBooks report JSON — nested sections + ColData.
const money = (v: string) => ({ value: v });
const data = (name: string, ...vals: string[]) => ({ type: "Data", ColData: [{ value: name, id: name }, ...vals.map(money)] });
const section = (title: string, rows: unknown[]) => ({ type: "Section", Header: { ColData: [{ value: title }] }, Rows: { Row: rows } });

const plReport = {
  Columns: { Column: [{ ColType: "Account" }, { ColType: "Money", ColTitle: "Total" }] },
  Rows: { Row: [
    section("Income", [data("Sales", "200000.00")]),
    section("Cost of Goods Sold", [data("Purchases", "80000.00")]),
    section("Expenses", [data("Rent", "30000.00"), data("Depreciation", "10000.00")]),
  ] },
};
const bsReport = {
  Columns: { Column: [{ ColType: "Account" }, { ColType: "Money", ColTitle: "Total" }] },
  Rows: { Row: [
    section("ASSETS", [
      section("Current Assets", [
        section("Bank", [data("Checking", "20000.00")]),
        section("Accounts Receivable", [data("A/R", "40000.00")]),
      ]),
      section("Fixed Assets", [data("Plant & Machinery", "60000.00")]),
    ]),
    section("LIABILITIES AND EQUITY", [
      section("Liabilities", [section("Accounts Payable", [data("A/P", "30000.00")])]),
      section("Equity", [data("Retained Earnings", "10000.00"), data("Net Income", "80000.00")]),
    ]),
  ] },
};
const tbReport = {
  Columns: { Column: [{ ColType: "Account" }, { ColTitle: "Debit", ColType: "Money" }, { ColTitle: "Credit", ColType: "Money" }] },
  Rows: { Row: [data("Checking", "20000.00", ""), data("Sales", "", "200000.00")] },
};
const arReport = {
  Columns: { Column: [
    { ColTitle: "Customer", ColType: "Customer" },
    { ColTitle: "Current", ColType: "Money" }, { ColTitle: "1 - 30", ColType: "Money" },
    { ColTitle: "31 - 60", ColType: "Money" }, { ColTitle: "61 - 90", ColType: "Money" },
    { ColTitle: "91 and over", ColType: "Money" }, { ColTitle: "Total", ColType: "Money" },
  ] },
  Rows: { Row: [data("Acme Ltd", "1000", "500", "0", "0", "250", "1750")] },
};

test("P&L flattener signs income + / costs − and feeds correct revenue & net profit", () => {
  const pl = flattenQboProfitAndLoss(plReport as never);
  assert.equal(pl.find((r) => r.description === "Sales")?.amount, "200000");
  assert.equal(pl.find((r) => r.description === "Purchases")?.amount, "-80000");
  const statements = { asOfDate: "2026-12-31", periodStart: "2026-01-01", currency: "GBP", companyName: "QBO Test Ltd", profitLoss: pl, balanceSheet: flattenQboBalanceSheet(bsReport as never), agedDebtors: [], agedCreditors: [], bank: [], trialBalance: [] };
  const ma = buildManagementAccounts(statements as never);
  assert.equal(ma.pl.revenue, 200000);
  assert.equal(ma.pl.grossProfit, 120000, "200k − 80k COGS");
  assert.equal(ma.pl.netProfit, 80000);
});

test("Balance sheet flattener classifies sections and balances (Net Income in equity)", () => {
  const statements = { asOfDate: "2026-12-31", periodStart: "2026-01-01", currency: "GBP", companyName: "QBO Test Ltd", profitLoss: flattenQboProfitAndLoss(plReport as never), balanceSheet: flattenQboBalanceSheet(bsReport as never), agedDebtors: [], agedCreditors: [], bank: [], trialBalance: [] };
  const ma = buildManagementAccounts(statements as never);
  assert.equal(ma.bs.totalFixed, 60000);
  assert.equal(ma.bs.totalCurrentAssets, 60000);
  assert.equal(ma.bs.totalLiabilities, 30000);
  assert.equal(ma.bs.netAssets, 90000);
  assert.ok(Math.abs(ma.bs.netAssets - ma.bs.totalEquity) <= 1, "balances");
  assert.equal(buildStatutoryAccounts(statements as never).balanced, true);
});

test("Trial balance flattener → debit/credit/balance", () => {
  const tb = flattenQboTrialBalance(tbReport as never);
  assert.deepEqual(tb.find((r) => r.account_name === "Checking"), { account_code: "Checking", account_name: "Checking", debit: "20000", credit: "0", balance: "20000" });
  assert.equal(tb.find((r) => r.account_name === "Sales")?.balance, "-200000");
});

test("Aged flattener emits one row per non-zero bucket with representative days_overdue", () => {
  const rows = flattenQboAged(arReport as never, "customer_name");
  assert.equal(rows.length, 3, "Current, 1-30, 91+ (zero buckets and Total skipped)");
  assert.equal(rows.reduce((sum, r) => sum + Number(r.amount), 0), 1750);
  assert.deepEqual(rows.map((r) => r.days_overdue).sort(), ["0", "100", "15"].sort());
  assert.ok(rows.every((r) => r.customer_name === "Acme Ltd"));
});

test("VAT rows: sales positive, purchases positive, credits negated; net = total − tax", () => {
  const invoice = txnVatRow({ TotalAmt: 1200, TxnTaxDetail: { TotalTax: 200 }, CustomerRef: { name: "Acme" }, TxnDate: "2026-03-10" }, { name: "Invoice", type: "Sale", negate: false });
  assert.deepEqual({ net: invoice!.net_amount, vat: invoice!.vat_amount, gross: invoice!.gross_amount, type: invoice!.type }, { net: "1000", vat: "200", gross: "1200", type: "Sale" });

  const credit = txnVatRow({ TotalAmt: 120, TxnTaxDetail: { TotalTax: 20 }, CustomerRef: { name: "Acme" } }, { name: "CreditMemo", type: "Sale", negate: true });
  assert.deepEqual({ net: credit!.net_amount, vat: credit!.vat_amount, gross: credit!.gross_amount }, { net: "-100", vat: "-20", gross: "-120" });

  const bill = txnVatRow({ TotalAmt: 600, TxnTaxDetail: { TotalTax: 100 }, VendorRef: { name: "Supplier" } }, { name: "Bill", type: "Purchase", negate: false });
  assert.deepEqual({ net: bill!.net_amount, vat: bill!.vat_amount, type: bill!.type, party: bill!.party }, { net: "500", vat: "100", type: "Purchase", party: "Supplier" });

  assert.equal(txnVatRow({ TotalAmt: 0, TxnTaxDetail: { TotalTax: 0 } }, { name: "Invoice", type: "Sale", negate: false }), null, "no amounts → skipped");
});
