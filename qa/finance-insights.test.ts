import test from "node:test";
import assert from "node:assert/strict";
import { buildFinanceInsights } from "../apps/web/lib/finance-insights";
import { pilotStatements } from "../apps/web/lib/data";

test("synthesises prioritised signals across all tools for the pilot", () => {
  const insights = buildFinanceInsights(pilotStatements);
  assert.equal(insights.available, true);
  const areas = insights.signals.map((s) => s.area);

  // The pilot's known shape: thin cash cover, tied-up working capital, high
  // customer concentration, and a favourable net-profit swing.
  assert.ok(areas.includes("Liquidity"), "flags the sub-1-month cash cover");
  assert.ok(areas.includes("Working capital"), "flags the ~78-day cash cycle");
  assert.ok(areas.includes("Concentration"), "flags the 45%-of-AR customer");
  assert.ok(insights.signals.some((s) => s.area === "Performance" && s.severity === "positive"), "net profit up is a positive signal");

  // Every signal carries a recommended action, and they are severity-ordered.
  assert.ok(insights.signals.every((s) => s.action.length > 0), "each signal has an action");
  const order = { critical: 0, high: 1, medium: 2, positive: 3, info: 4 } as const;
  for (let i = 1; i < insights.signals.length; i += 1) {
    assert.ok(order[insights.signals[i - 1].severity] <= order[insights.signals[i].severity], "signals are ordered by severity");
  }

  // Headline reflects the "profitable but cash-tight" profile.
  assert.match(insights.headline, /cash-tight|liquidity|watch/i);
  // Fact sheet is grounded numbers for the AI layer.
  assert.match(insights.factSheet, /13-WEEK CASH FLOW/);
  assert.match(insights.factSheet, /CUSTOMER CONCENTRATION/);
});
