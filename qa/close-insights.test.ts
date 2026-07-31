import test from "node:test";
import assert from "node:assert/strict";
import { buildCloseInsights } from "../apps/web/lib/close-insights";

const rec = (over: Record<string, unknown>) => ({ id: "r", tenantId: "t", companyId: "c", findingId: "f", action: "Do the thing", expectedImpact: "", priority: "medium", completed: false, ...over } as never);
const check = (name: string, status: string) => ({ id: name, tenantId: "t", companyId: "c", name, status } as never);
const passedChecks = [check("Trial balance balances", "passed"), check("VAT report agrees to VAT control", "passed"), check("Bank reconciliation", "passed")];

test("outstanding tasks + failed reconciliation → close-not-ready signals", () => {
  const insights = buildCloseInsights(
    [{ id: "1", tenantId: "t", companyId: "c", severity: "critical", category: "month_end", title: "Suspense not cleared", description: "", expectedImpact: "", status: "open" }] as never,
    [rec({ priority: "high", action: "Clear the suspense account" }), rec({ completed: true })],
    [check("Trial balance balances", "failed"), check("Bank reconciliation", "passed")],
  );
  assert.equal(insights.available, true);
  assert.equal(insights.signals[0].severity, "critical", "critical finding first");
  assert.ok(insights.signals.some((s) => s.area === "Reconciliation" && /Trial balance/i.test(s.title)));
  assert.ok(insights.signals.some((s) => s.area === "Tasks" && /1 close task/i.test(s.title)));
  assert.match(insights.headline, /not ready/i);
  assert.match(insights.factSheet, /OUTSTANDING TASKS/);
});

test("all done → ready to close positive", () => {
  const insights = buildCloseInsights([], [rec({ completed: true })], passedChecks);
  assert.ok(insights.signals.some((s) => s.area === "Close" && s.severity === "positive"));
  assert.match(insights.headline, /ready to close/i);
});
