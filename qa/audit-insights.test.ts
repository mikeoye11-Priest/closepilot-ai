import test from "node:test";
import assert from "node:assert/strict";
import { buildAuditInsights } from "../apps/web/lib/audit-insights";

const val = (name: string, status: string) => ({ id: name, tenantId: "t", companyId: "c", name, status } as never);
const allChecks = [
  val("Trial balance balances", "passed"),
  val("VAT report agrees to VAT control", "passed"),
  val("AR ledger agrees to control", "passed"),
  val("AP ledger agrees to control", "passed"),
  val("Bank reconciliation", "passed"),
];
const allUploads = [
  { fileType: "trial_balance" }, { fileType: "vat_report" }, { fileType: "aged_debtors" }, { fileType: "aged_creditors" }, { fileType: "profit_loss" },
];

test("all reconciliations pass + signed → audit-ready positive", () => {
  const insights = buildAuditInsights([], allChecks, allUploads, true);
  assert.equal(insights.available, true);
  assert.ok(insights.score >= 90, `score ${insights.score}`);
  assert.ok(insights.signals.some((s) => s.area === "Readiness" && s.severity === "positive"));
  assert.match(insights.headline, /audit-ready/i);
  assert.match(insights.factSheet, /READINESS DRIVERS/);
});

test("a failed reconciliation + critical finding raise the right signals", () => {
  const checks = allChecks.map((c) => (/vat/i.test(c.name) ? val("VAT report agrees to VAT control", "failed") : c));
  const findings = [{ id: "1", tenantId: "t", companyId: "c", severity: "critical", category: "vat", title: "VAT control unreconciled", description: "", expectedImpact: "", status: "open" }];
  const insights = buildAuditInsights(findings as never, checks, allUploads, false);
  assert.equal(insights.signals[0].severity, "critical", "critical finding ranked first");
  assert.ok(insights.signals.some((s) => s.area === "Readiness" && /VAT reconciled/i.test(s.title)), "failed VAT driver flagged");
  assert.ok(insights.signals.some((s) => s.area === "Sign-off"), "unsigned surfaced");
  assert.match(insights.headline, /critical finding/i);
});

test("no uploads → not available", () => {
  assert.equal(buildAuditInsights([], [], []).available, false);
});
