import test from "node:test";
import assert from "node:assert/strict";
import { buildVariance } from "../apps/web/lib/variance";
import { pilotStatements } from "../apps/web/lib/data";

const find = (report: ReturnType<typeof buildVariance>, label: string) => report.lines.find((l) => l.label === label)!;

test("pilot P&L variance vs prior period, with direction-aware favourable/adverse", () => {
  const report = buildVariance(pilotStatements);
  assert.equal(report.hasComparison, true);

  const revenue = find(report, "Revenue");
  assert.equal(revenue.actual, 2_080_000);
  assert.equal(revenue.comparison, 1_890_000);
  assert.equal(revenue.variance, 190_000);
  assert.equal(revenue.favourable, true, "revenue up is favourable");

  const cogs = find(report, "Cost of sales");
  assert.equal(cogs.variance, 70_000);
  assert.equal(cogs.favourable, false, "higher cost is adverse");

  const net = find(report, "Net profit");
  assert.equal(net.variance, 82_000);
  assert.equal(net.favourable, true);
  assert.ok((net.variancePct ?? 0) > 100, "net profit more than doubled");
});
