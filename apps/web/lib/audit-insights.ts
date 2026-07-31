// Audit-readiness adviser insights.
//
// Turns the audit-readiness score + drivers (TB/VAT/AR/AP/bank reconciliations,
// payroll/depreciation posting) and open critical/high findings into prioritised,
// explained signals — what stands between the file and audit-ready — plus a
// grounded fact sheet for the AI narrator. Deterministic.

import { calculateAuditReadinessV2, calculateReadinessDrivers } from "./finance";
import type { Finding, ValidationCheck } from "./types";
import type { FinanceSignal } from "./finance-insights";

export type AuditInsights = { headline: string; signals: FinanceSignal[]; factSheet: string; score: number; available: boolean };

const CLOSED = new Set(["resolved", "approved", "closed", "false_positive", "accepted_risk", "accepted", "rejected", "not_applicable"]);
const SEVERITY_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, positive: 3, info: 4 };

export function buildAuditInsights(findings: Finding[], validationChecks: ValidationCheck[], uploads: { fileType: string }[], partnerSigned = false): AuditInsights {
  if (!uploads.length) return { headline: "Upload a finance pack to assess audit readiness.", signals: [], factSheet: "", score: 0, available: false };

  const score = calculateAuditReadinessV2(findings, validationChecks, uploads);
  const drivers = calculateReadinessDrivers(findings, validationChecks, uploads);
  const open = findings.filter((f) => !CLOSED.has(f.status));
  const openCritical = open.filter((f) => f.severity === "critical").length;
  const openHigh = open.filter((f) => f.severity === "high").length;

  const signals: FinanceSignal[] = [];

  if (openCritical > 0) {
    signals.push({ severity: "critical", area: "Findings", title: `${openCritical} critical finding${openCritical === 1 ? "" : "s"} open`, detail: "Critical exceptions remain unresolved in the pack.", action: "Resolve or document accepted risk before the file is relied upon for audit." });
  }

  for (const driver of drivers.filter((d) => !d.passed)) {
    signals.push({ severity: driver.weight >= 15 ? "high" : "medium", area: "Readiness", title: `${driver.label} not met`, detail: driver.detail, action: "Complete this reconciliation/posting and evidence it before the audit file is issued." });
  }

  if (openHigh > 0) {
    signals.push({ severity: "high", area: "Findings", title: `${openHigh} high-severity finding${openHigh === 1 ? "" : "s"} open`, detail: "High-risk exceptions still require a reviewer decision.", action: "Work these next — they cost the most readiness points." });
  }

  if (!partnerSigned) {
    signals.push({ severity: "info", area: "Sign-off", title: "Partner sign-off outstanding", detail: "The review pack has not been partner-signed.", action: "Obtain partner sign-off once the blockers above are cleared." });
  }

  if (score >= 90 && drivers.every((d) => d.passed) && openCritical === 0) {
    signals.push({ severity: "positive", area: "Readiness", title: `Audit-ready · ${score}%`, detail: "Reconciliations pass, evidence is complete and no critical exceptions remain.", action: "Package the file — it is ready to hand to audit." });
  }

  signals.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);

  const failed = drivers.filter((d) => !d.passed).length;
  const headline = openCritical > 0
    ? `${openCritical} critical finding${openCritical === 1 ? "" : "s"} block audit readiness (${score}%) — resolve first.`
    : failed > 0
      ? `Audit readiness ${score}% — ${failed} reconciliation/posting item${failed === 1 ? "" : "s"} to close before the file is ready.`
      : `Audit-ready (${score}%) — reconciliations pass and no critical exceptions remain.`;

  const factSheet = [
    `AUDIT READINESS: ${score}%`,
    `Open findings: ${open.length} (critical ${openCritical}, high ${openHigh})`,
    `Partner sign-off: ${partnerSigned ? "signed" : "outstanding"}`,
    "",
    "READINESS DRIVERS:",
    ...drivers.map((d) => `- ${d.label} (weight ${d.weight}): ${d.passed ? "PASS" : "NOT MET"} — ${d.detail}`),
  ].join("\n");

  return { headline, signals, factSheet, score, available: signals.length > 0 };
}
