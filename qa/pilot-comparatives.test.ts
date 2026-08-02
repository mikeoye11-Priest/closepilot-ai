import test from "node:test";
import assert from "node:assert/strict";
import { pilotStatements, pilotAnalysisResult } from "../apps/web/lib/data";
import { buildManagementAccounts, buildEquityReconciliation, renderManagementAccountsHtml } from "../apps/web/lib/management-accounts";
import { buildStatutoryAccounts, renderStatutoryAccountsHtml } from "../apps/web/lib/statutory-accounts";
import { VAT_ENGINE_VERSION } from "../apps/web/lib/vat-engine";

// The pilot demo ships prior-year comparatives so the accounts packs show a real
// year-on-year comparison. This locks the figures + that both years balance.
test("pilot statements produce management-accounts comparatives (YoY, both years balance)", () => {
  const pack = buildManagementAccounts(pilotStatements);

  // Current year
  assert.equal(pack.pl.revenue, 2_080_000);
  assert.equal(pack.pl.grossProfit, 740_000);
  assert.equal(pack.pl.netProfit, 162_000);
  assert.equal(pack.bs.netAssets, 1_046_800);
  assert.equal(pack.bs.totalEquity, pack.bs.netAssets, "current year balances");

  // Prior year comparatives are present and correct
  assert.equal(pack.prior.hasComparatives, true);
  assert.equal(pack.prior.revenue, 1_890_000);
  assert.equal(pack.prior.netProfit, 80_000);
  assert.equal(pack.bs.priorNetAssets, 937_700);
  assert.equal(pack.bs.priorEquity, pack.bs.priorNetAssets, "prior year balances");

  // The year-on-year narrative is grounded in those figures
  assert.ok(
    pack.observations.some((o) => /grew 10% from £1,890,000 to £2,080,000/.test(o)),
    "comparative growth observation is generated",
  );
});

test("pilot equity reconciles via the Statement of Changes in Equity (profit − dividends)", () => {
  const pack = buildManagementAccounts(pilotStatements);
  const eq = pack.equity;
  assert.equal(eq.opening, 937_700, "opening = prior capital & reserves");
  assert.equal(eq.profit, 162_000);
  assert.equal(eq.distributions, -52_900, "modelled dividend");
  assert.equal(eq.actualClosing, 1_046_800);
  assert.equal(eq.residual, 0);
  assert.equal(eq.reconciled, true);
  // The pack renders the SOCE.
  const html = renderManagementAccountsHtml(pack);
  assert.match(html, /Statement of Changes in Equity/);
  assert.match(html, /Dividends and distributions/);
});

test("buildEquityReconciliation: capital introduced reconciles; an unexplained gap surfaces a residual", () => {
  const base = buildManagementAccounts(pilotStatements);
  // Same numbers but the movement is capital, not dividends → residual until modelled.
  const noMovement = buildEquityReconciliation({ ...pilotStatements, equityMovements: [] }, base.pl, base.bs);
  assert.equal(noMovement.reconciled, false);
  assert.equal(noMovement.residual, -52_900, "unexplained reserves movement is surfaced, not plugged");

  const withCapital = buildEquityReconciliation(
    { ...pilotStatements, equityMovements: [{ description: "Dividends paid", amount: "-52900" }, { description: "Shares issued", amount: "0" }] },
    base.pl, base.bs,
  );
  assert.equal(withCapital.reconciled, true);
  assert.equal(withCapital.capital, 0);
});

test("accounts packs name the real source provider, never a hardcoded Xero", () => {
  const qbo = { ...pilotStatements, sourceProvider: "quickbooks" as const };
  const maHtml = renderManagementAccountsHtml(buildManagementAccounts(qbo));
  assert.match(maHtml, /the QuickBooks ledger/);
  assert.doesNotMatch(maHtml, /the Xero ledger|maintained in Xero/);

  const statHtml = renderStatutoryAccountsHtml(buildStatutoryAccounts(qbo));
  assert.match(statHtml, /the QuickBooks ledger/);
  assert.doesNotMatch(statHtml, /the Xero ledger/);

  // A genuine Xero set still reads "the Xero ledger"; an uploaded set is neutral.
  assert.match(renderManagementAccountsHtml(buildManagementAccounts({ ...pilotStatements, sourceProvider: "xero" as const })), /the Xero ledger/);
  assert.match(renderManagementAccountsHtml(buildManagementAccounts({ ...pilotStatements, sourceProvider: "upload" as const })), /the uploaded accounting records/);
});

test("pilot statements drive statutory + full FRS 102 packs with comparatives, balanced", () => {
  const statutory = buildStatutoryAccounts(pilotStatements);
  assert.equal(statutory.hasComparatives, true);
  assert.equal(statutory.balanced, true);

  const full = buildStatutoryAccounts(pilotStatements, { full: true });
  assert.equal(full.hasComparatives, true);
  assert.equal(full.balanced, true);
});

test("current assets map to Stocks / Debtors / Cash even under one 'Current Assets' heading", () => {
  const s = buildStatutoryAccounts(pilotStatements);
  // Previously stock and cash were reported as debtors (cash as nil) because the
  // split keyed off the section title. Now each line is classified by its name.
  assert.equal(s.sofp.stocks, 310000, "stock is its own line, not debtors");
  assert.equal(s.sofp.priorStocks, 295000);
  assert.equal(s.sofp.debtors, 268000, "debtors excludes stock and cash");
  assert.equal(s.sofp.priorDebtors, 240000);
  assert.equal(s.sofp.cash, 142000, "cash is recognised, not nil");
  assert.equal(s.sofp.priorCash, 70000);
  assert.equal(s.sofp.stocks + s.sofp.debtors + s.sofp.cash, s.sofp.currentAssetsTotal);

  // The cash flow now ties to real cash (opening £70k → closing £142k).
  const full = buildStatutoryAccounts(pilotStatements, { full: true });
  assert.equal(full.cashFlow.closingCash, 142000);
  assert.equal(full.cashFlow.openingCash, 70000);

  const html = renderStatutoryAccountsHtml(s);
  assert.match(html, /Stocks/);
});

test("pilot VAT review ships a populated, consistent prior-period comparison", () => {
  const vat = pilotAnalysisResult.vatReview!;
  const pc = vat.periodComparison!;
  // The movement panel renders whenever status !== "not_available".
  assert.notEqual(pc.status, "not_available");
  assert.ok(pc.previousVatDue > 0, "a prior-period VAT figure is present");
  assert.equal(pc.movement, pc.currentVatDue - pc.previousVatDue, "movement is internally consistent");

  // The prior-period assurance check is no longer untested, and with it resolved
  // the pack carries no outstanding VAT exceptions.
  const trend = vat.assuranceChecks.find((check) => check.id === "VAT-A05");
  assert.equal(trend?.status, "passed");
  assert.equal(vat.exceptionDashboard.total, 0);
  assert.equal(vat.exceptionsCount, 0);

  // Stamped with the current engine version, so it isn't flagged as stale.
  assert.equal(vat.engineVersion, VAT_ENGINE_VERSION);
});
