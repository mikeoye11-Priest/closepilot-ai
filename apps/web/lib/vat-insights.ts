// VAT / MTD adviser insights.
//
// Synthesises the VAT review + MTD readiness into prioritised, explained signals
// (filing blockers, reconciliation, exceptions, period movement, MTD readiness
// gaps) plus a grounded fact sheet for the AI narrator. Deterministic — the AI
// only narrates these numbers.

import { calculateMtdReadiness, calculateMtdReadinessDrivers } from "./finance";
import type { Finding, ValidationCheck } from "./types";
import type { FinanceSignal } from "./finance-insights";
import type { VatReviewResult } from "./vat-engine/types";

export type VatInsights = { headline: string; signals: FinanceSignal[]; factSheet: string; mtdScore: number; available: boolean };

const SEVERITY_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, positive: 3, info: 4 };
const gbp = (value: number) => `£${Math.round(Math.abs(value)).toLocaleString("en-GB")}`;

type UploadLike = { fileType: string; detectionBasis?: string; detectedVendor?: string };

export function buildVatInsights(vatReview: VatReviewResult | undefined, findings: Finding[], validationChecks: ValidationCheck[], uploads: UploadLike[]): VatInsights {
  if (!vatReview) return { headline: "No VAT review yet.", signals: [], factSheet: "", mtdScore: 0, available: false };

  const mtdScore = calculateMtdReadiness(findings, validationChecks, uploads, vatReview);
  const drivers = calculateMtdReadinessDrivers(findings, validationChecks, uploads, vatReview);
  const signals: FinanceSignal[] = [];

  // Filing sign-off.
  const signOff = vatReview.filingSignOff;
  if (signOff?.status === "not_ready") {
    signals.push({ severity: "critical", area: "Filing", title: "VAT return is not ready to file", detail: (signOff.blockers ?? []).join("; ") || signOff.detail || "Filing blockers are open.", action: "Clear the filing blockers below before submission." });
  } else if (signOff?.status === "ready_with_risks") {
    signals.push({ severity: "high", area: "Filing", title: "Ready to file, with risks", detail: (signOff.risks ?? []).join("; ") || signOff.detail || "Risks are outstanding.", action: "Acknowledge or resolve the flagged risks before filing." });
  }

  // Reconciliation.
  if (vatReview.reconciliationStatus === "FAIL") {
    signals.push({ severity: "high", area: "Reconciliation", title: "VAT does not reconcile to the control account", detail: "Box 5 does not agree to the VAT control balance.", action: "Investigate the difference and post any missing journals before filing." });
  } else if (vatReview.reconciliationStatus === "REVIEW") {
    signals.push({ severity: "medium", area: "Reconciliation", title: "VAT control needs review", detail: "The VAT control reconciliation is not yet signed off.", action: "Complete the control reconciliation and evidence any adjustments." });
  }

  // High-risk exceptions.
  const highExceptions = vatReview.exceptionDashboard?.high ?? 0;
  if (highExceptions > 0) {
    signals.push({ severity: "high", area: "Exceptions", title: `${highExceptions} high-risk VAT exception${highExceptions === 1 ? "" : "s"}`, detail: "High-severity VAT assurance checks are unresolved.", action: "Resolve the high-risk exceptions before the return is relied upon." });
  }

  // Period movement.
  const pc = vatReview.periodComparison;
  if (pc && pc.status === "review") {
    signals.push({ severity: "medium", area: "Movement", title: `VAT due moved ${pc.percentageChange === null ? "" : `${pc.percentageChange > 0 ? "+" : ""}${pc.percentageChange}% `}beyond the ${pc.threshold}% threshold`, detail: `${gbp(pc.previousVatDue)} → ${gbp(pc.currentVatDue)}.`, action: "Document the driver of the movement before submission." });
  }

  // MTD readiness gaps.
  for (const driver of drivers.filter((d) => !d.passed)) {
    signals.push({ severity: "medium", area: "MTD", title: `MTD: ${driver.label} not met`, detail: driver.detail, action: driver.label === "Digital link from source" ? "Keep the filing chain digital — connect the accounting system rather than re-keying." : "Address before the return is filed to stay MTD-compliant." });
  }

  // A clean, filing-ready return is a positive.
  if (signOff?.status === "ready_to_submit" && vatReview.reconciliationStatus === "PASS" && drivers.every((d) => d.passed)) {
    signals.push({ severity: "positive", area: "Filing", title: `Return filing-ready · MTD readiness ${mtdScore}%`, detail: "Boxes reconcile, evidence is complete and the digital chain is intact.", action: "Acknowledge and file — no outstanding VAT blockers." });
  }

  signals.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);

  const headline = deriveHeadline(vatReview, mtdScore, drivers);
  const factSheet = buildFactSheet(vatReview, mtdScore, drivers);

  return { headline, signals, factSheet, mtdScore, available: signals.length > 0 };
}

function deriveHeadline(vatReview: VatReviewResult, mtdScore: number, drivers: ReturnType<typeof calculateMtdReadinessDrivers>): string {
  const signOff = vatReview.filingSignOff?.status;
  const failedDrivers = drivers.filter((d) => !d.passed).length;
  if (signOff === "not_ready") return "The VAT return is not ready to file — clear the blockers first.";
  if (vatReview.reconciliationStatus === "FAIL") return "VAT does not reconcile to the control account — resolve before filing.";
  if (signOff === "ready_with_risks") return "The VAT return is close, but there are risks to review before filing.";
  if (failedDrivers > 0) return `VAT is filing-ready; tighten MTD readiness (${mtdScore}%) — ${failedDrivers} item${failedDrivers === 1 ? "" : "s"} to address.`;
  return `VAT is filing-ready and MTD-compliant (${mtdScore}%).`;
}

function buildFactSheet(vatReview: VatReviewResult, mtdScore: number, drivers: ReturnType<typeof calculateMtdReadinessDrivers>): string {
  const r = vatReview.vatReturn;
  const pc = vatReview.periodComparison;
  return [
    "VAT RETURN",
    r ? `Box 1 (output VAT): ${gbp(r.box1)}; Box 4 (input VAT): ${gbp(r.box4)}; Box 5 (net due): ${gbp(r.box5)}` : "No computed return.",
    `Filing sign-off: ${vatReview.filingSignOff?.label ?? vatReview.filingSignOff?.status ?? "n/a"}`,
    `Reconciliation: ${vatReview.reconciliationStatus ?? "n/a"}`,
    `Open exceptions: ${vatReview.exceptionsCount ?? 0} (high-risk: ${vatReview.exceptionDashboard?.high ?? 0})`,
    pc && pc.status !== "not_available" ? `Prior-period movement: ${gbp(pc.previousVatDue)} → ${gbp(pc.currentVatDue)} (${pc.percentageChange === null ? "—" : `${pc.percentageChange > 0 ? "+" : ""}${pc.percentageChange}%`}, threshold ${pc.threshold}%, status ${pc.status})` : "Prior-period movement: not available",
    "",
    `MTD READINESS: ${mtdScore}%`,
    ...drivers.map((d) => `- ${d.label}: ${d.passed ? "PASS" : "NOT MET"} — ${d.detail}`),
  ].join("\n");
}
