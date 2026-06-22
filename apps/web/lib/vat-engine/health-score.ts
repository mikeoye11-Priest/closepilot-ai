import type { VatFinding, VatReconciliationResult, VatReviewResult, VatScoreBreakdown, VatTransaction } from "./types";

export function calculateVatHealthScore(findings: VatFinding[], reconciliations: VatReconciliationResult[]) {
  return calculateVatScoreBreakdown(findings, reconciliations, []).overall;
}

export function calculateVatScoreBreakdown(findings: VatFinding[], reconciliations: VatReconciliationResult[], transactions: VatTransaction[]): VatScoreBreakdown & { overall: number } {
  const failedReconciliations = reconciliations.filter((item) => item.status === "failed").length;
  const warningReconciliations = reconciliations.filter((item) => item.status === "warning").length;
  const hasTransactions = transactions.length > 0;
  const missingCodes = hasTransactions && findings.some((item) => item.id === "VAT100")
    ? transactions.filter((transaction) => !transaction.vatCode).length
    : 0;
  const blockedExposure = findings.filter((item) => item.layer === 4).reduce((sum, item) => sum + (item.exposure ?? 0), 0);
  const manualAdjustmentFindings = findings.filter((item) => item.id === "VAT103" || /manual/i.test(item.finding)).length;
  const computationFindings = findings.filter((item) => ["VAT101", "VAT102", "VAT104"].includes(item.id ?? "")).length;
  const documentationFindings = findings.filter((item) => ["VAT105", "VAT106"].includes(item.id ?? "")).length;

  const reconciliation = Math.max(0, 100 - failedReconciliations * 30 - warningReconciliations * 10);
  const computationAccuracy = Math.max(0, 100 - computationFindings * 18);
  const missingVatCodes = hasTransactions ? Math.max(0, 100 - missingCodes * 8) : 100;
  const blockedVatExposure = Math.max(0, 100 - Math.min(70, Math.round(blockedExposure / 100)));
  const documentationQuality = Math.max(0, 100 - documentationFindings * 20);
  const manualAdjustments = Math.max(0, 100 - manualAdjustmentFindings * 15);

  const breakdown: VatScoreBreakdown = {
    computationAccuracy,
    reconciliation,
    missingVatCodes,
    blockedVatExposure,
    documentationQuality,
    manualAdjustments,
  };

  const overall = Math.round(
    breakdown.computationAccuracy * 0.25 +
      breakdown.reconciliation * 0.25 +
      breakdown.missingVatCodes * 0.15 +
      breakdown.blockedVatExposure * 0.15 +
      breakdown.documentationQuality * 0.1 +
      breakdown.manualAdjustments * 0.1
  );

  return { ...breakdown, overall: Math.max(0, Math.min(100, overall)) };
}

export function vatReviewStatus(healthScore: number, reconciliations: VatReconciliationResult[]): VatReviewResult["status"] {
  if (!reconciliations.length) return "VAT Data Required";
  if (healthScore >= 85 && reconciliations.every((item) => item.status === "passed")) return "HMRC VAT Return Ready for Review";
  return "Review Required Before Submission";
}
