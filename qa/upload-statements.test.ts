import test from "node:test";
import assert from "node:assert/strict";
import { buildStatementsFromUploads } from "../apps/web/lib/upload-statements";
import { buildManagementAccounts } from "../apps/web/lib/management-accounts";
import { buildStatutoryAccounts } from "../apps/web/lib/statutory-accounts";
import { withReportingPeriod } from "../apps/web/lib/report-statements";

// Minimal ParsedFile stand-ins: only fields the adapter reads.
const file = (fileType: string, rows: Record<string, string>[]) => ({
  upload: { id: "u", tenantId: "t", companyId: "c", fileType, fileName: `${fileType}.csv`, uploadedAt: "2026-03-31" },
  headers: rows.length ? Object.keys(rows[0]) : [],
  rows,
  isParsed: true,
});

test("explicit P&L + BS files → balancing pack with correct revenue/net profit", () => {
  const files = [
    file("profit_loss", [
      { account_name: "Sales", amount: "200000" },
      { account_name: "Cost of Sales", amount: "80000" },
      { account_name: "Rent", amount: "30000" },
      { account_name: "Depreciation", amount: "10000" },
      { account_name: "Total expenses", amount: "40000" }, // computed row — must be skipped
    ]),
    file("balance_sheet", [
      { account_name: "Plant & Machinery", category: "Fixed Assets", amount: "60000" },
      { account_name: "Trade Debtors", category: "Current Assets", amount: "40000" },
      { account_name: "Bank", category: "Current Assets", amount: "20000" },
      { account_name: "Trade Creditors", category: "Current Liabilities", amount: "30000" },
      { account_name: "Share Capital", category: "Equity", amount: "1000" },
      { account_name: "Retained Earnings", category: "Equity", amount: "89000" },
    ]),
  ];
  const statements = buildStatementsFromUploads(files as never, { companyName: "Uploadco Ltd" });
  assert.ok(statements, "statements built");
  const ma = buildManagementAccounts(statements!);
  assert.equal(ma.pl.revenue, 200000);
  assert.equal(ma.pl.cogs, -80000);
  assert.equal(ma.pl.netProfit, 80000, "200k − 80k COGS − 40k overheads");
  assert.ok(Math.abs(ma.bs.netAssets - ma.bs.totalEquity) <= 1, "balance sheet balances");
  assert.equal(ma.bs.netAssets, 90000);
  assert.equal(buildStatutoryAccounts(statements!).balanced, true);
});

test("trial-balance-only → derived P&L + BS that balance (current-year earnings added)", () => {
  // Signed TB: debits positive, credits negative; sums to zero.
  const tb = file("trial_balance", [
    { account_name: "Sales", balance: "-200000" },
    { account_name: "Cost of Sales", balance: "80000" },
    { account_name: "Rent", balance: "30000" },
    { account_name: "Depreciation", balance: "10000" },
    { account_name: "Plant & Machinery", balance: "60000" },
    { account_name: "Trade Debtors", balance: "40000" },
    { account_name: "Bank", balance: "20000" },
    { account_name: "Trade Creditors", balance: "-30000" },
    { account_name: "Share Capital", balance: "-1000" },
    { account_name: "Retained Earnings", balance: "-9000" },
  ]);
  const statements = buildStatementsFromUploads([tb] as never, {});
  assert.ok(statements);
  const ma = buildManagementAccounts(statements!);
  assert.equal(ma.pl.revenue, 200000);
  assert.equal(ma.pl.netProfit, 80000);
  // Reserves get the £80k current-year profit, so the derived sheet balances.
  assert.ok(Math.abs(ma.bs.netAssets - ma.bs.totalEquity) <= 1, "derived BS balances");
  assert.equal(ma.bs.netAssets, 90000);
});

test("period auto-detected from document dates (last month-end)", () => {
  const files = [file("profit_loss", [
    { account_name: "Sales", amount: "1000", date: "2026-02-15" },
    { account_name: "Sales", amount: "500", date: "2026-03-20" },
  ])];
  const statements = buildStatementsFromUploads(files as never, {});
  assert.equal(statements!.asOfDate, "2026-03-31", "last day of the latest month seen");
  assert.equal(statements!.periodStart, "2026-01-01", "calendar-year-to-date default");
});

test("explicit reporting period overrides the auto-detected dates", () => {
  const files = [file("profit_loss", [{ account_name: "Sales", amount: "1000", date: "2026-03-20" }])];
  const statements = buildStatementsFromUploads(files as never, { asOfDate: "2026-06-30", periodStart: "2026-04-01" });
  assert.equal(statements!.asOfDate, "2026-06-30");
  assert.equal(statements!.periodStart, "2026-04-01");
});

test("no accounting documents → undefined (nothing to build)", () => {
  const files = [file("aged_debtors", [{ customer: "Acme", amount: "500", days_overdue: "45" }])];
  assert.equal(buildStatementsFromUploads(files as never, {}), undefined);
});

test("withReportingPeriod overrides the period end (YTD) and ignores bad input", () => {
  const base = { asOfDate: "2026-12-31", periodStart: "2026-01-01", profitLoss: [], balanceSheet: [], agedDebtors: [], agedCreditors: [], bank: [], trialBalance: [] };
  const q1 = withReportingPeriod(base as never, "2026-03-31");
  assert.equal(q1.asOfDate, "2026-03-31");
  assert.equal(q1.periodStart, "2026-01-01", "year-to-date start");
  assert.equal(withReportingPeriod(base as never, null).asOfDate, "2026-12-31", "no override when absent");
  assert.equal(withReportingPeriod(base as never, "not-a-date").asOfDate, "2026-12-31", "ignored when invalid");
});
