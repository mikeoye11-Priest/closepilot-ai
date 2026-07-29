import test from "node:test";
import assert from "node:assert/strict";
import { pilotStatements, pilotAnalysisResult } from "../apps/web/lib/data";
import { buildManagementAccounts } from "../apps/web/lib/management-accounts";
import { buildStatutoryAccounts } from "../apps/web/lib/statutory-accounts";
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

test("pilot statements drive statutory + full FRS 102 packs with comparatives, balanced", () => {
  const statutory = buildStatutoryAccounts(pilotStatements);
  assert.equal(statutory.hasComparatives, true);
  assert.equal(statutory.balanced, true);

  const full = buildStatutoryAccounts(pilotStatements, { full: true });
  assert.equal(full.hasComparatives, true);
  assert.equal(full.balanced, true);
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
