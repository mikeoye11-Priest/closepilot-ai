import test from "node:test";
import assert from "node:assert/strict";
import { pilotStatements } from "../apps/web/lib/data";
import { buildManagementAccounts } from "../apps/web/lib/management-accounts";
import { buildStatutoryAccounts } from "../apps/web/lib/statutory-accounts";

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
