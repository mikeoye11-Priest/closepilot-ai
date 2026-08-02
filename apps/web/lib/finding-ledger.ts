// Canonical finding service — the single source of truth for how a finding is
// classified (open / decided / scoreable), de-duplicated, and rolled up. Every
// screen and score reads these definitions instead of re-implementing its own,
// so counts, cash-at-risk and evidence coverage agree across the app. This is the
// finding analogue of the canonical debtor ledger (see [[debtor-ledger]]).

import type { Finding, FindingStatus, RiskLevel } from "./types";

// --- Classification (one definition, used everywhere) ---------------------------

// A finding is "decided" once a reviewer has dispositioned it; anything else is open.
export const DECIDED_STATUSES: FindingStatus[] = [
  "resolved", "approved", "closed", "false_positive", "accepted_risk", "accepted", "rejected", "not_applicable",
];
export const isDecided = (finding: Finding): boolean => DECIDED_STATUSES.includes(finding.status);
export const isOpenFinding = (finding: Finding): boolean => !isDecided(finding);
export const isCriticalOpenFinding = (finding: Finding): boolean =>
  isOpenFinding(finding) && (finding.severity === "critical" || finding.severity === "high");

// Scoreable = contributes to the risk score. A decided finding (including one a
// reviewer has "approved") no longer penalises the score — consistent with
// isOpenFinding — and advisory (indicator-only) findings never score. (Score-
// neutral on current data, which carries no "approved" findings; the alignment
// matters once a reviewer approves a finding's disposition.)
export const isScoreableFinding = (finding: Finding): boolean =>
  !isDecided(finding) && finding.evidenceStrength !== "advisory";

const lifecycleStatuses = ["open", "under_review", "evidence_requested", "evidence_received", "resolved", "approved", "closed"] as const;
export type LifecycleStatus = (typeof lifecycleStatuses)[number];
export function lifecycleStatus(status: FindingStatus): LifecycleStatus {
  if (status === "in_review") return "under_review";
  if (status === "needs_investigation") return "evidence_requested";
  if (status === "accepted") return "approved";
  if (status === "rejected" || status === "not_applicable" || status === "false_positive" || status === "accepted_risk") return "closed";
  return status as LifecycleStatus;
}

// --- Impact amount --------------------------------------------------------------

export function parseImpactAmount(impact: string): number {
  if (!impact) return 0;
  const match = impact.match(/(?:£|GBP\s*)([\d,]+(?:\.\d+)?)([km]?)/i);
  if (!match) return 0;
  const value = Number(match[1].replace(/,/g, ""));
  const multiplier = match[2].toLowerCase() === "k" ? 1000 : match[2].toLowerCase() === "m" ? 1_000_000 : 1;
  return value * multiplier;
}
export const findingImpact = (finding: Finding): number => finding.amount ?? parseImpactAmount(finding.expectedImpact);

// --- Canonical de-duplication ---------------------------------------------------

// One key per underlying issue (category + source + severity + title), so an issue
// cited by several rules counts once. Idempotent — re-running on a deduped set is a
// no-op. This is the same identity the upload path used; lifted here so pilot/sync
// findings (which bypass that path) get the same treatment.
export function canonicalFindingKey(finding: Finding): string {
  const source = (finding.evidence?.sourceFile ?? finding.sourceFile ?? "").toLowerCase();
  const title = finding.title.slice(0, 40).toLowerCase().replace(/\W+/g, "_");
  return `${finding.category}_${finding.severity}_${source}_${title}`;
}

export function dedupeFindings(findings: Finding[]): Finding[] {
  const seen = new Set<string>();
  return findings.filter((finding) => {
    const key = canonicalFindingKey(finding);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// --- Canonical roll-up ----------------------------------------------------------

export type FindingLedger = {
  all: Finding[];
  unique: Finding[];
  duplicatesExcluded: number;
  open: Finding[];
  scoreable: Finding[];
  openCount: number;
  criticalOpenCount: number;
  byCategory: Record<string, number>;    // OPEN findings by category
  bySeverity: Record<RiskLevel, number>; // OPEN findings by severity
  byStatus: Record<string, number>;      // ALL findings by lifecycle status
  cashAtRisk: number;                     // non-advisory findings with a positive amount
  evidenceLinkedCount: number;            // unique findings with a source file
  evidenceCoverage: number;               // % of unique findings evidenced (0–100)
};

export function buildFindingLedger(findings: Finding[]): FindingLedger {
  const all = findings;
  const unique = dedupeFindings(findings);
  const open = unique.filter(isOpenFinding);
  const scoreable = unique.filter(isScoreableFinding);

  const byCategory: Record<string, number> = {};
  const bySeverity: Record<RiskLevel, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const finding of open) {
    byCategory[finding.category] = (byCategory[finding.category] ?? 0) + 1;
    bySeverity[finding.severity] = (bySeverity[finding.severity] ?? 0) + 1;
  }
  const byStatus: Record<string, number> = {};
  for (const finding of unique) {
    const status = lifecycleStatus(finding.status);
    byStatus[status] = (byStatus[status] ?? 0) + 1;
  }

  const cashAtRisk = unique
    .filter((finding) => finding.evidenceStrength !== "advisory")
    .reduce((sum, finding) => (findingImpact(finding) > 0 ? sum + findingImpact(finding) : sum), 0);
  const evidenceLinkedCount = unique.filter((finding) => finding.evidence?.sourceFile).length;

  return {
    all,
    unique,
    duplicatesExcluded: all.length - unique.length,
    open,
    scoreable,
    openCount: open.length,
    criticalOpenCount: unique.filter(isCriticalOpenFinding).length,
    byCategory,
    bySeverity,
    byStatus,
    cashAtRisk: Math.round(cashAtRisk),
    evidenceLinkedCount,
    evidenceCoverage: unique.length ? Math.round((evidenceLinkedCount / unique.length) * 100) : 0,
  };
}
