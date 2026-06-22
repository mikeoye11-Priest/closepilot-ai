import type { Finding, Upload, ValidationCheck } from "@/lib/types";
import { calculateAuditReadinessV2, calculateReadinessDrivers, calculateReviewConfidence, estimateCashAtRisk } from "@/lib/finance";

const SCORE_WEIGHTS = {
  readiness: 0.7,
  confidence: 0.3,
} as const;

const SEVERITY_ORDER: Record<Finding["severity"], number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

export interface AuditReadinessResult {
  score: number;          // 0–100
  closeReadiness: number; // 0–100
  confidence: number;     // 0–100
  criticalFindings: number;
  estimatedExposure: number;
  missingEvidence: string[];
  outstandingIssues: string[];
  validationWarnings: number;
  scoreDrivers: {
    readiness: number;
    confidence: number;
    positiveFactors: string[];
    negativeFactors: string[];
  };
}

export function calculateAuditReadiness(
  findings: Finding[],
  validationChecks: ValidationCheck[],
  uploads: Upload[]
): AuditReadinessResult {
  const open     = findings.filter((f) => ["open", "under_review", "evidence_requested", "evidence_received", "in_review", "needs_investigation"].includes(f.status));
  const critical = open.filter((f) => f.severity === "critical");
  const high     = open.filter((f) => f.severity === "high");
  const warnings = validationChecks.filter((v) => v.status === "warning");

  const closeReadiness = calculateAuditReadinessV2(findings, validationChecks, uploads);
  const confidence = calculateReviewConfidence(findings, validationChecks, uploads);
  const score = Math.round(closeReadiness * SCORE_WEIGHTS.readiness + confidence * SCORE_WEIGHTS.confidence);
  const readinessDrivers = calculateReadinessDrivers(findings, validationChecks, uploads);
  const closeBlockers = open.filter((f) => ["month_end","controls"].includes(f.category) && ["critical","high"].includes(f.severity));
  const estimatedExposure = estimateCashAtRisk(open);

  // Missing evidence
  const required = ["trial_balance","profit_loss","balance_sheet","aged_debtors","aged_creditors","vat_report"];
  const present  = new Set(uploads.map((u) => u.fileType));
  const missingEvidence = required
    .filter((r) => !present.has(r as Upload["fileType"]))
    .map((r) => r.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()));

  const outstandingSource = uniqueFindings([...critical, ...high, ...closeBlockers]).sort(
    (a, b) => SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity]
  );
  const outstandingIssues = outstandingSource
    .map((f) => `[${f.severity.toUpperCase()}] ${f.title}`)
    .slice(0, 10);

  const positiveFactors = [
    ...(missingEvidence.length === 0 ? ["All key finance files uploaded"] : []),
    ...readinessDrivers.filter((driver) => driver.passed).map((driver) => `${driver.label} (${driver.weight}%)`),
    ...(confidence >= 85 ? [`Review evidence confidence is ${confidence}%`] : []),
  ].slice(0, 8);

  const negativeFactors = [
    ...missingEvidence.slice(0, 3).map((item) => `Missing ${item}`),
    ...readinessDrivers.filter((driver) => !driver.passed).map((driver) => driver.detail),
    ...(critical.length ? [`${critical.length} critical finding${critical.length === 1 ? "" : "s"} open`] : []),
    ...(high.length ? [`${high.length} high-risk finding${high.length === 1 ? "" : "s"} open`] : []),
    ...(warnings.length ? [`${warnings.length} validation warning${warnings.length === 1 ? "" : "s"} require review`] : []),
  ].slice(0, 8);

  return {
    score, closeReadiness,
    confidence,
    criticalFindings: critical.length,
    estimatedExposure,
    missingEvidence,
    outstandingIssues,
    validationWarnings: warnings.length,
    scoreDrivers: {
      readiness: closeReadiness,
      confidence,
      positiveFactors,
      negativeFactors,
    },
  };
}

function uniqueFindings(findings: Finding[]) {
  return Array.from(new Map(findings.map((finding) => [finding.id, finding])).values());
}
