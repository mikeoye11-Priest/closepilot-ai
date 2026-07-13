import test from "node:test";
import assert from "node:assert/strict";
import { buildStatutoryAccounts, renderStatutoryAccountsHtml } from "../apps/web/lib/statutory-accounts";

const withPrior = {
  asOfDate: "2026-12-31", currency: "GBP", companyName: "Testco Ltd", companyIndustry: "consulting services",
  balanceSheet: [
    { category: "Fixed Assets", item: "Equipment", amount: "4000", prior_amount: "5000" },
    { category: "Current Assets", item: "Accounts Receivable", amount: "12000", prior_amount: "9000" },
    { category: "Current Liabilities", item: "Accounts Payable", amount: "6000", prior_amount: "4000" },
    { category: "Bank", item: "Business Bank Account", amount: "9000", prior_amount: "6000" },
    { category: "Equity", item: "Retained Earnings", amount: "19000", prior_amount: "16000" },
  ],
  profitLoss: [
    { category: "Income", description: "Sales", amount: "50000" },
    { category: "Cost of Sales", description: "Purchases", amount: "-20000" },
    { category: "Operating Expenses", description: "Depreciation", amount: "-1000" },
    { category: "Operating Expenses", description: "Rent", amount: "-26000" },
  ],
  priorProfitLoss: [{ category: "Income", description: "Sales", amount: "42000" }],
  agedDebtors: [], agedCreditors: [], bank: [{ account: "Business Bank Account", closing_balance: "9000" }], trialBalance: [],
};
const noPrior = { ...withPrior, priorProfitLoss: [], balanceSheet: withPrior.balanceSheet.map((r) => ({ ...r, prior_amount: "0" })) };

test("full FRS 102: strategic report renders, cash flow ties, equity reconciles", () => {
  const pack = buildStatutoryAccounts(withPrior as never, { full: true });
  assert.equal(pack.full, true);
  assert.equal(pack.hasComparatives, true);

  const ce = pack.changesInEquity;
  assert.ok(Math.abs(ce.openingEquity + ce.profit + ce.other - ce.closingEquity) < 0.01, "changes in equity must reconcile");

  const cf = pack.cashFlow;
  assert.ok(Math.abs(cf.netCashOps + cf.capex + cf.financingOther - cf.cashChange) < 0.01, "cash flow lines must sum to the net cash movement");
  assert.ok(Math.abs(cf.cashChange - (cf.closingCash - cf.openingCash)) < 0.01, "net cash movement must equal closing minus opening cash");

  const html = renderStatutoryAccountsHtml(pack);
  assert.match(html, /Strategic Report/);
  assert.match(html, /Statement of Cash Flows/);
  assert.match(html, /Statement of Changes in Equity/);
});

test("full mode without comparatives omits the movement statements and warns", () => {
  const pack = buildStatutoryAccounts(noPrior as never, { full: true });
  assert.equal(pack.hasComparatives, false);
  const html = renderStatutoryAccountsHtml(pack);
  // The statement headings must be absent (the warning text may still name them).
  assert.doesNotMatch(html, /<h2>Statement of Cash Flows<\/h2>/);
  assert.doesNotMatch(html, /<h2>Statement of Changes in Equity<\/h2>/);
  assert.match(html, /require prior-period comparatives/);
});

test("small and full basis wording do not conflict", () => {
  const small = renderStatutoryAccountsHtml(buildStatutoryAccounts(withPrior as never));
  const full = renderStatutoryAccountsHtml(buildStatutoryAccounts(withPrior as never, { full: true }));

  // Small company: Section 1A + s477 audit exemption
  assert.match(small, /Section 1A/);
  assert.match(small, /section 477/);

  // Full FRS 102: subject to audit, and NO small-company exemption / Section 1A wording anywhere
  assert.match(full, /subject to audit/);
  assert.doesNotMatch(full, /section 477/);
  assert.doesNotMatch(full, /Section 1A/);
});
