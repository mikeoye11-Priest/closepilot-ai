import type { Finding, Upload, ValidationCheck } from "@/lib/types";

export interface ConfidenceResult {
  score: number;      // 0–100
  dataCoverage: number;    // % of expected file types present
  validationScore: number; // % of checks passed
  evidenceQuality: number; // % of findings with source evidence
  crossFileAgreement: number; // % of cross-file checks passed
}

const REQUIRED_FILES = ["trial_balance","profit_loss","balance_sheet","aged_debtors","aged_creditors","vat_report"] as const;

export function calculateConfidence(
  findings: Finding[],
  validationChecks: ValidationCheck[],
  uploads: Upload[]
): ConfidenceResult {
  if (uploads.length === 0) return { score: 0, dataCoverage: 0, validationScore: 0, evidenceQuality: 0, crossFileAgreement: 0 };

  const presentTypes = new Set(uploads.map((u) => u.fileType));
  const dataCoverage = Math.round((REQUIRED_FILES.filter((r) => presentTypes.has(r)).length / REQUIRED_FILES.length) * 100);

  const passed    = validationChecks.filter((v) => v.status === "passed").length;
  const failed    = validationChecks.filter((v) => v.status === "failed").length;
  const total     = validationChecks.length;
  const validationScore = total > 0 ? Math.round((passed / total) * 100) : 80;

  const evidenceQuality = findings.length > 0
    ? Math.round((findings.filter((f) => f.evidence?.sourceFile).length / findings.length) * 100)
    : 100;

  const crossFileChecks = validationChecks.filter((v) => v.id.startsWith("val_xfile") || v.id.startsWith("val_ar_ctrl") || v.id.startsWith("val_ap_ctrl") || v.id.startsWith("val_vat"));
  const crossFilePassed = crossFileChecks.filter((v) => v.status === "passed").length;
  const crossFileAgreement = crossFileChecks.length > 0 ? Math.round((crossFilePassed / crossFileChecks.length) * 100) : 100;

  // Weighted confidence score
  const score = Math.round(
    dataCoverage    * 0.30 +
    validationScore * 0.30 +
    evidenceQuality * 0.25 +
    crossFileAgreement * 0.15
  ) - (failed * 5);

  return {
    score: Math.max(0, Math.min(100, score)),
    dataCoverage,
    validationScore,
    evidenceQuality,
    crossFileAgreement,
  };
}
