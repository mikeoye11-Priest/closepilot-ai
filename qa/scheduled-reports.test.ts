import test from "node:test";
import assert from "node:assert/strict";
import { shouldGenerateSnapshot, inventoryFingerprint, latestSnapshotFor, type ReportSchedule, type ScheduledReport } from "../apps/web/lib/scheduled-reports";
import type { InventoryReviewResult } from "../apps/web/lib/inventory-engine";

function review(over: Partial<InventoryReviewResult> = {}): InventoryReviewResult {
  return {
    source: "computed", asOfDate: over.asOfDate ?? "2026-07-17", lineCount: over.lineCount ?? 10,
    totalValue: over.totalValue ?? 5000, wipValue: 0, byCategory: [], hasMovementDates: true, hasNrv: false,
    ageing: { current: 5000, days90: 0, days180: 0, days365: 0, unknown: 0 }, slowMovingValue: 0, obsoleteValue: 0,
    negativeStockLines: 0, negativeStockValue: 0, zeroCostLines: 0, nrvWriteDown: 0, topItems: [], findings: [],
  };
}
const schedule: ReportSchedule = { id: "s1", companyId: "c1", report: "inventory", cadence: "weekly", enabled: true };

function snapshot(over: Partial<ScheduledReport>): ScheduledReport {
  const r = over.review ?? review();
  return { id: "r1", companyId: "c1", companyName: "Co", report: "inventory", cadence: "weekly", generatedAt: over.generatedAt ?? "2026-07-01T00:00:00.000Z", asOfDate: r.asOfDate, fingerprint: over.fingerprint ?? inventoryFingerprint(r), review: r };
}

test("first run always generates; disabled never generates", () => {
  assert.equal(shouldGenerateSnapshot(schedule, undefined, "fp"), true);
  assert.equal(shouldGenerateSnapshot({ ...schedule, enabled: false }, undefined, "fp"), false);
});

test("does not regenerate when the data is unchanged", () => {
  const r = review();
  const last = snapshot({ review: r, generatedAt: "2026-06-01T00:00:00.000Z" });
  assert.equal(shouldGenerateSnapshot(schedule, last, inventoryFingerprint(r), new Date("2026-07-17T00:00:00Z")), false);
});

test("regenerates when data changed and the cadence has elapsed, not before", () => {
  const last = snapshot({ review: review({ totalValue: 5000 }), generatedAt: "2026-07-14T00:00:00.000Z" });
  const changed = inventoryFingerprint(review({ totalValue: 9000 }));
  // 3 days later, weekly cadence not yet elapsed
  assert.equal(shouldGenerateSnapshot(schedule, last, changed, new Date("2026-07-17T00:00:00Z")), false);
  // 8 days later, elapsed
  assert.equal(shouldGenerateSnapshot(schedule, last, changed, new Date("2026-07-22T00:00:00Z")), true);
});

test("latestSnapshotFor returns the newest snapshot for the company/report", () => {
  const older = snapshot({ generatedAt: "2026-06-01T00:00:00.000Z" });
  const newer = { ...snapshot({ generatedAt: "2026-07-01T00:00:00.000Z" }), id: "r2" };
  assert.equal(latestSnapshotFor([older, newer], "c1", "inventory")?.id, "r2");
  assert.equal(latestSnapshotFor([older, newer], "other", "inventory"), undefined);
});

// ── Finance insights digest ─────────────────────────────────────────────────
import { financeInsightsFingerprint, type FinanceInsightsSnapshot } from "../apps/web/lib/scheduled-reports";

const snap = (headline: string, signals: FinanceInsightsSnapshot["signals"]): FinanceInsightsSnapshot => ({ headline, signals });
const sig = (severity: string, title: string) => ({ severity, area: "Liquidity", title, detail: "", action: "" });

test("finance-insights fingerprint is stable and change-sensitive", () => {
  const a = snap("Cash-tight", [sig("high", "Thin cash cover"), sig("medium", "78-day cycle")]);
  const b = snap("Cash-tight", [sig("high", "Thin cash cover"), sig("medium", "78-day cycle")]);
  const c = snap("Cash-tight", [sig("high", "Thin cash cover")]);
  assert.equal(financeInsightsFingerprint(a), financeInsightsFingerprint(b), "same digest → same fingerprint");
  assert.notEqual(financeInsightsFingerprint(a), financeInsightsFingerprint(c), "fewer signals → different fingerprint");
});

test("finance-insights schedule generates when due and data changed, skips when unchanged", () => {
  const schedule: ReportSchedule = { id: "s", companyId: "c", report: "finance_insights", cadence: "weekly", enabled: true };
  const fp = financeInsightsFingerprint(snap("H", [sig("high", "X")]));
  const last: ScheduledReport = { id: "1", companyId: "c", companyName: "Co", report: "finance_insights", cadence: "weekly", generatedAt: new Date(Date.now() - 8 * 86_400_000).toISOString(), asOfDate: "2026-05-31", fingerprint: "OLD" };
  assert.equal(shouldGenerateSnapshot(schedule, undefined, fp), true, "no prior snapshot → generate");
  assert.equal(shouldGenerateSnapshot(schedule, last, fp), true, "a week later + changed → generate");
  assert.equal(shouldGenerateSnapshot(schedule, { ...last, fingerprint: fp }, fp), false, "unchanged → skip");
  assert.equal(latestSnapshotFor([last], "c", "finance_insights")?.id, "1");
});
