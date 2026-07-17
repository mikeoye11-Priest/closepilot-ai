// In-app scheduled report digests. A schedule is evaluated whenever the workspace
// is active; when a cadence has elapsed AND the underlying data has changed since
// the last snapshot, a frozen point-in-time report is appended to the in-app
// inbox. No cron, email or external dependency — management views the periodic
// report inside the app. Kept pure so the due/fingerprint logic is unit-tested.

import type { InventoryReviewResult } from "./inventory-engine";

export type ReportCadence = "weekly" | "monthly";

export type ReportSchedule = {
  id: string;
  companyId: string;
  report: "inventory";
  cadence: ReportCadence;
  enabled: boolean;
};

export type ScheduledReport = {
  id: string;
  companyId: string;
  companyName: string;
  report: "inventory";
  cadence: ReportCadence;
  generatedAt: string; // ISO
  asOfDate: string;
  fingerprint: string;
  review: InventoryReviewResult;
};

const CADENCE_DAYS: Record<ReportCadence, number> = { weekly: 7, monthly: 28 };

// A stable signature of the review's material figures. Two reviews with the same
// fingerprint carry the same data, so we never append a duplicate snapshot.
export function inventoryFingerprint(review: InventoryReviewResult): string {
  return [
    review.asOfDate, review.lineCount, review.totalValue, review.wipValue,
    review.slowMovingValue, review.obsoleteValue, review.nrvWriteDown,
    review.ledgerDifference ?? "", review.findings.length,
  ].join("|");
}

// Whether a new snapshot should be generated for this schedule now: enabled, the
// cadence has elapsed since the last snapshot (or there is none), and the data
// has actually changed since the last snapshot for this company/report.
export function shouldGenerateSnapshot(
  schedule: ReportSchedule,
  lastSnapshot: ScheduledReport | undefined,
  currentFingerprint: string,
  now: Date = new Date(),
): boolean {
  if (!schedule.enabled) return false;
  if (!lastSnapshot) return true;
  if (lastSnapshot.fingerprint === currentFingerprint) return false; // data unchanged
  const elapsedDays = (now.getTime() - Date.parse(lastSnapshot.generatedAt)) / 86_400_000;
  return elapsedDays >= CADENCE_DAYS[schedule.cadence];
}

export function latestSnapshotFor(reports: ScheduledReport[], companyId: string, report: ReportSchedule["report"]): ScheduledReport | undefined {
  return reports
    .filter((item) => item.companyId === companyId && item.report === report)
    .sort((a, b) => Date.parse(b.generatedAt) - Date.parse(a.generatedAt))[0];
}
