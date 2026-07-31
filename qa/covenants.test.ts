import test from "node:test";
import assert from "node:assert/strict";
import { buildCovenants } from "../apps/web/lib/covenants";
import { pilotStatements } from "../apps/web/lib/data";

const get = (report: ReturnType<typeof buildCovenants>, name: string) => report.covenants.find((c) => c.name === name)!;

test("evaluates liquidity/solvency covenants against thresholds", () => {
  const report = buildCovenants(pilotStatements);
  assert.equal(report.available, true);

  const current = get(report, "Current ratio");
  assert.ok(Math.abs(current.actual - 720_000 / 293_200) < 0.01);
  assert.equal(current.status, "pass", "2.46x current ratio passes 1.2x");

  const quick = get(report, "Quick (acid-test) ratio");
  assert.ok(Math.abs(quick.actual - (720_000 - 310_000) / 293_200) < 0.01);
  assert.equal(quick.status, "pass", "1.40x quick ratio passes 1.0x");

  // Cash cover ~0.9 months is below the 1.0-month floor → breach (the tight one).
  const cover = get(report, "Cash cover");
  assert.equal(cover.status, "breach");

  const low = get(report, "13-week minimum cash");
  assert.equal(low.status, "pass", "forecast stays above zero");

  assert.equal(report.breaches, 1);
  assert.equal(report.passed + report.watches + report.breaches, report.covenants.length);
});

test("custom thresholds can force a breach", () => {
  const report = buildCovenants(pilotStatements, { currentRatio: 3.0, quickRatio: 1.0, cashCoverMonths: 1.0, minForecastCash: 0 });
  assert.equal(get(report, "Current ratio").status, "breach", "2.46x fails a 3.0x covenant");
});
