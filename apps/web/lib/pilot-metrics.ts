// Firm-wide pilot metrics, aggregated from the workspace's persisted review data
// (one AnalysisResult snapshot per client company). Deterministic and honest: it
// reports only what the data supports and returns undefined/0 (surfaced as "—" in
// the UI) where there is not enough evidence, rather than inventing figures.
// Longitudinal cross-session trends would need a persisted usage_events table.

import type { AnalysisResult, Finding } from "./types";
import { estimateTimeSaved, parseImpactAmount } from "./finance";

export const PILOT_HOURLY_RATE = 80;

const DECIDED_STATUSES = ["resolved", "closed", "false_positive", "accepted_risk", "accepted", "rejected", "not_applicable"];
const isOpenFinding = (finding: Finding) => !DECIDED_STATUSES.includes(finding.status);

const CATEGORY_LABELS: Record<string, string> = {
  vat: "VAT", ar: "Aged debtors", ap: "Aged creditors", controls: "Controls", data_quality: "Data quality",
  month_end: "Month-end", cashflow: "Cash flow", financial_statements: "Financial statements",
};

export type PilotMetrics = {
  companiesTotal: number;
  reviewsCompleted: number;
  signedOffCount: number;
  totalFindings: number;
  hoursSaved: number;
  managerValue: number;
  evidenceTraceabilityPct?: number;
  issuesSurfacedPreSignOffPct?: number;
  avgTurnaroundDays?: number;
  severity: { critical: number; high: number; medium: number; low: number };
  openExposure: number;
  recurringIssues: Array<{ label: string; count: number }>;
};

function firstActivityTs(snapshot: AnalysisResult): number | undefined {
  const activityTs = (snapshot.findingActivities ?? []).map((a) => Date.parse(a.timestamp)).filter((v) => Number.isFinite(v));
  const uploadTs = (snapshot.uploads ?? []).map((u) => Date.parse(u.uploadedAt)).filter((v) => Number.isFinite(v));
  const all = [...activityTs, ...uploadTs];
  return all.length ? Math.min(...all) : undefined;
}

export function buildPilotMetrics(snapshots: AnalysisResult[]): PilotMetrics {
  const reviewed = snapshots.filter((snapshot) => (snapshot.uploads?.length ?? 0) > 0 || (snapshot.findings?.length ?? 0) > 0);
  const allFindings = reviewed.flatMap((snapshot) => snapshot.findings ?? []);

  const hoursSaved = reviewed.reduce((sum, snapshot) => sum + estimateTimeSaved(snapshot.findings ?? []), 0);

  const evidenceLinked = allFindings.filter((finding) => finding.evidence?.sourceFile).length;

  // Turnaround: from the first review activity to partner sign-off, for reviews
  // that reached sign-off (the only ones with a defined end point).
  const turnarounds = reviewed
    .map((snapshot) => {
      const signedAt = snapshot.partnerSignOff?.signedAt ? Date.parse(snapshot.partnerSignOff.signedAt) : NaN;
      const start = firstActivityTs(snapshot);
      if (!Number.isFinite(signedAt) || start === undefined || signedAt < start) return undefined;
      return (signedAt - start) / 86_400_000;
    })
    .filter((value): value is number => value !== undefined);

  // Issues surfaced before partner sign-off: of findings on signed-off reviews,
  // how many were detected (created) before the sign-off timestamp.
  const signedReviews = reviewed.filter((snapshot) => snapshot.partnerSignOff?.signedAt);
  let signedFindings = 0;
  let preSignOff = 0;
  for (const snapshot of signedReviews) {
    const signedAt = Date.parse(snapshot.partnerSignOff!.signedAt);
    const created = new Map<string, number>();
    for (const activity of snapshot.findingActivities ?? []) {
      if (activity.action === "created") created.set(activity.findingId, Date.parse(activity.timestamp));
    }
    for (const finding of snapshot.findings ?? []) {
      signedFindings += 1;
      const at = created.get(finding.id);
      if (at === undefined || !Number.isFinite(signedAt) || at <= signedAt) preSignOff += 1;
    }
  }

  const openNonAdvisory = allFindings.filter((finding) => isOpenFinding(finding) && finding.evidenceStrength !== "advisory");
  const openExposure = openNonAdvisory.reduce((sum, finding) => sum + (finding.amount ?? parseImpactAmount(finding.expectedImpact)), 0);

  const categoryCounts = new Map<string, number>();
  for (const finding of allFindings) {
    const label = CATEGORY_LABELS[finding.category] ?? finding.category;
    categoryCounts.set(label, (categoryCounts.get(label) ?? 0) + 1);
  }
  const recurringIssues = [...categoryCounts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 4);

  return {
    companiesTotal: snapshots.length,
    reviewsCompleted: reviewed.length,
    signedOffCount: signedReviews.length,
    totalFindings: allFindings.length,
    hoursSaved: Math.round(hoursSaved * 10) / 10,
    managerValue: Math.round(hoursSaved * PILOT_HOURLY_RATE),
    evidenceTraceabilityPct: allFindings.length ? Math.round((evidenceLinked / allFindings.length) * 100) : undefined,
    issuesSurfacedPreSignOffPct: signedFindings ? Math.round((preSignOff / signedFindings) * 100) : undefined,
    avgTurnaroundDays: turnarounds.length ? Math.round((turnarounds.reduce((sum, value) => sum + value, 0) / turnarounds.length) * 10) / 10 : undefined,
    severity: {
      critical: allFindings.filter((finding) => finding.severity === "critical").length,
      high: allFindings.filter((finding) => finding.severity === "high").length,
      medium: allFindings.filter((finding) => finding.severity === "medium").length,
      low: allFindings.filter((finding) => finding.severity === "low").length,
    },
    openExposure: Math.round(openExposure),
    recurringIssues,
  };
}
