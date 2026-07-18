import test from "node:test";
import assert from "node:assert/strict";
import { buildStatutoryAccounts, renderStatutoryAccountsHtml } from "../apps/web/lib/statutory-accounts";
import { buildCT600, renderCt600Html } from "../apps/web/lib/ct600";

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

  // Full FRS 102: audit status is a review item, with no small-company exemption / Section 1A wording anywhere.
  assert.match(full, /Audit status and any auditor's report must be confirmed/);
  assert.doesNotMatch(full, /subject to audit/);
  assert.doesNotMatch(full, /Small companies exemption/);
  assert.doesNotMatch(full, /small companies regime/);
  assert.doesNotMatch(full, /section 477/);
  assert.doesNotMatch(full, /Section 1A/);
});

// ── Capital allowances + CT600 draft ─────────────────────────────────────────

const ctBase = {
  asOfDate: "2026-12-31", currency: "GBP", companyIndustry: "manufacturing",
  agedDebtors: [], agedCreditors: [], bank: [], trialBalance: [],
  priorProfitLoss: [{ category: "Income", description: "Sales", amount: "1" }],
};

// PBT 70,000; depreciation 10,000; fixed-asset additions 40,000 (ΔNBV 30,000 +
// depreciation 10,000), all relieved by AIA → taxable 40,000 → small profits rate.
const capexCo = {
  ...ctBase, companyName: "Capex Manufacturing Ltd",
  balanceSheet: [
    { category: "Fixed Assets", item: "Plant & Machinery", amount: "60000", prior_amount: "30000" },
    { category: "Equity", item: "Retained Earnings", amount: "70000", prior_amount: "1" },
  ],
  profitLoss: [
    { category: "Income", description: "Sales", amount: "200000" },
    { category: "Cost of Sales", description: "Materials", amount: "-80000" },
    { category: "Operating Expenses", description: "Depreciation", amount: "-10000" },
    { category: "Operating Expenses", description: "Rent", amount: "-40000" },
  ],
};

// PBT 100,000; no depreciation, no additions → taxable 100,000 → marginal relief.
const mrCo = {
  ...ctBase, companyName: "Margin Ltd",
  balanceSheet: [
    { category: "Fixed Assets", item: "Equipment", amount: "5000", prior_amount: "5000" },
    { category: "Equity", item: "Retained Earnings", amount: "100000", prior_amount: "1" },
  ],
  profitLoss: [
    { category: "Income", description: "Sales", amount: "300000" },
    { category: "Cost of Sales", description: "Materials", amount: "-150000" },
    { category: "Operating Expenses", description: "Rent", amount: "-50000" },
  ],
};

test("capital allowances: AIA relieves qualifying additions; small profits rate applies", () => {
  const tc = buildStatutoryAccounts(capexCo as never).taxComputation;
  assert.equal(tc.depreciation, 10000);
  assert.equal(tc.capitalAllowances.additions, 40000, "additions = ΔNBV + depreciation");
  assert.equal(tc.capitalAllowances.aia, 40000, "AIA covers all qualifying additions");
  assert.equal(tc.capitalAllowances.wda, 0);
  assert.equal(tc.taxableProfits, 40000, "PBT 70k + dep 10k − CA 40k");
  assert.equal(tc.rate, "19%");
  assert.ok(Math.abs(tc.tax - 7600) < 0.5, "19% of 40,000");
});

test("no comparatives → no capital allowances (additions cannot be estimated)", () => {
  const noPriorCo = { ...capexCo, priorProfitLoss: [], balanceSheet: capexCo.balanceSheet.map((r) => ({ ...r, prior_amount: "0" })) };
  const tc = buildStatutoryAccounts(noPriorCo as never).taxComputation;
  assert.equal(tc.capitalAllowances.total, 0);
});

test("statutory CT comp renders the capital allowances deduction", () => {
  const html = renderStatutoryAccountsHtml(buildStatutoryAccounts(capexCo as never));
  assert.match(html, /Less: capital allowances/);
  assert.match(html, /Annual Investment Allowance/);
});

test("CT600 draft: boxes map the computation; marginal relief splits into 430/435/525", () => {
  const pack = buildStatutoryAccounts(mrCo as never);
  const ct600 = buildCT600(pack, { companyNumber: "12345678", utr: "1234567890" });
  assert.equal(ct600.companyNumber, "12345678");
  assert.equal(ct600.boxes.turnover.value, 300000);
  assert.equal(ct600.boxes.profitsChargeable.value, 100000);
  assert.equal(ct600.boxes.associatedCompanies.value, 0);
  assert.ok(Math.abs(ct600.boxes.corporationTax.value - 25000) < 0.5, "box 430 = 25% gross");
  assert.ok(Math.abs(ct600.boxes.marginalRelief.value - 2250) < 0.5, "box 435 = marginal relief");
  assert.ok(Math.abs(ct600.boxes.taxPayable.value - 22750) < 0.5, "box 525 = net tax");
  // The chain must be internally consistent: box 430 − box 435 = box 525.
  assert.ok(Math.abs(ct600.boxes.corporationTax.value - ct600.boxes.marginalRelief.value - ct600.boxes.taxPayable.value) < 0.5);
});

test("CT600 draft renders with box chips, draft warning and unentered CRN placeholder", () => {
  const html = renderCt600Html(buildCT600(buildStatutoryAccounts(mrCo as never)));
  assert.match(html, /DRAFT/);
  assert.match(html, /Total turnover from trade/);
  assert.match(html, /Marginal relief/);
  assert.match(html, /to be entered/, "CRN/UTR placeholder when not supplied");
});
