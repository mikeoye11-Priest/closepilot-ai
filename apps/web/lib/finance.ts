import type { CashForecastPoint, FinanceScoreBreakdown, Finding, Recommendation, RiskLevel, ValidationCheck } from "./types";

export const FINDING_CATEGORIES = {
  MONTH_END: "month_end",
  CASHFLOW: "cashflow",
  AR: "ar",
  AP: "ap",
  VAT: "vat",
  CONTROLS: "controls",
  DATA_QUALITY: "data_quality",
  FINANCIAL_STATEMENTS: "financial_statements",
} as const satisfies Record<string, Finding["category"]>;

const CATEGORY_RISK_WEIGHTS: Record<Finding["category"], number> = {
  [FINDING_CATEGORIES.VAT]: 1.2,
  [FINDING_CATEGORIES.CONTROLS]: 1.5,
  [FINDING_CATEGORIES.MONTH_END]: 1.4,
  [FINDING_CATEGORIES.AR]: 1.1,
  [FINDING_CATEGORIES.AP]: 1.1,
  [FINDING_CATEGORIES.CASHFLOW]: 1.3,
  [FINDING_CATEGORIES.DATA_QUALITY]: 0.5,
  [FINDING_CATEGORIES.FINANCIAL_STATEMENTS]: 1.4,
};

const SEVERITY_PENALTY: Record<Finding["severity"], number> = {
  critical: 18,
  high: 9,
  medium: 4,
  low: 1,
};

const CONFIDENCE_WEIGHTS: Record<Finding["confidence"], number> = {
  high: 1,
  medium: 0.7,
  low: 0.4,
};

const BREAKDOWN_MAP: Record<keyof FinanceScoreBreakdown, Finding["category"][]> = {
  cashFlow: [FINDING_CATEGORIES.CASHFLOW, FINDING_CATEGORIES.AR, FINDING_CATEGORIES.AP],
  receivables: [FINDING_CATEGORIES.AR],
  payables: [FINDING_CATEGORIES.AP],
  vatRisk: [FINDING_CATEGORIES.VAT],
  controls: [FINDING_CATEGORIES.CONTROLS],
  closeReview: [FINDING_CATEGORIES.MONTH_END],
  financialStatements: [FINDING_CATEGORIES.CASHFLOW],
  dataQuality: [FINDING_CATEGORIES.DATA_QUALITY],
};

export interface ScoreDriver {
  factor: string;
  impact: number;
  type: "positive" | "negative";
}

export function riskLabel(score: number): RiskLevel {
  if (score >= 85) return "low";
  if (score >= 70) return "medium";
  if (score >= 50) return "high";
  return "critical";
}

export function riskCopy(level: RiskLevel) {
  if (level === "low") return "Healthy";
  if (level === "medium") return "Watch";
  if (level === "high") return "At Risk";
  return "Critical";
}

export function calculateFinanceHealth(breakdown: FinanceScoreBreakdown, recommendations: Recommendation[]) {
  const base = Math.round(
    breakdown.cashFlow * 0.14 +
      breakdown.receivables * 0.12 +
      breakdown.payables * 0.10 +
      breakdown.vatRisk * 0.16 +
      breakdown.controls * 0.15 +
      breakdown.closeReview * 0.15 +
      breakdown.financialStatements * 0.10 +
      breakdown.dataQuality * 0.08
  );
  const completedBoost = recommendations.filter((item) => item.completed).length * 3;
  return Math.max(0, Math.min(100, base + completedBoost));
}

export function calculateFinanceScorecard(findings: Finding[], validationChecks: ValidationCheck[], recommendations: Recommendation[], uploads: { fileType: string }[] = []) {
  if (!uploads.length) {
    const emptyBreakdown: FinanceScoreBreakdown = {
      cashFlow: 0,
      receivables: 0,
      payables: 0,
      vatRisk: 0,
      controls: 0,
      closeReview: 0,
      financialStatements: 0,
      dataQuality: 0,
    };
    return {
      overall: 0,
      breakdown: emptyBreakdown,
      drivers: [],
    };
  }
  const breakdown = calculateScoreBreakdown(findings, validationChecks);
  return {
    overall: calculateFinanceHealth(breakdown, recommendations),
    breakdown,
    drivers: calculateScoreDrivers(findings, validationChecks, recommendations, uploads),
  };
}

export function calculateScoreDrivers(findings: Finding[], validationChecks: ValidationCheck[], recommendations: Recommendation[], uploads: { fileType: string }[] = []): ScoreDriver[] {
  const required = ["trial_balance", "profit_loss", "balance_sheet", "aged_debtors", "aged_creditors", "vat_report"];
  const present = new Set(uploads.map((upload) => upload.fileType));
  const coverage = required.length ? required.filter((fileType) => present.has(fileType)).length / required.length : 0;
  const validationPassRate = validationChecks.length
    ? validationChecks.filter((check) => check.status === "passed").length / validationChecks.length
    : uploads.length ? 0.75 : 0;
  const evidenceQuality = findings.length
    ? findings.filter((finding) => finding.evidence?.sourceFile).length / findings.length
    : uploads.length ? 1 : 0;
  const crossFileChecks = validationChecks.filter((check) => /ar ledger agrees|ap ledger agrees|vat report agrees|balance sheet equation|bank reconciliation agrees|p&l movement agrees/i.test(check.name));
  const crossFilePassRate = crossFileChecks.length
    ? crossFileChecks.filter((check) => check.status === "passed").length / crossFileChecks.length
    : 0;
  const completedActions = recommendations.filter((item) => item.completed).length;

  const rawPositiveDrivers: ScoreDriver[] = [
    { factor: "Data coverage", impact: Math.round(coverage * 20), type: "positive" },
    { factor: "Validation quality", impact: Math.round(validationPassRate * 18), type: "positive" },
    { factor: "Cross-file agreement", impact: Math.round(crossFilePassRate * 15), type: "positive" },
    { factor: "Evidence quality", impact: Math.round(evidenceQuality * 14), type: "positive" },
  ];
  if (completedActions) {
    rawPositiveDrivers.push({ factor: "Reviewer actions completed", impact: Math.min(8, completedActions * 2), type: "positive" });
  }
  const positiveDrivers = rawPositiveDrivers.filter((driver) => driver.impact > 0);

  const validationDrivers = validationChecks
    .filter((check) => check.status !== "passed")
    .map((check) => ({
      factor: scoreDriverLabel(check.name, check.detail),
      impact: check.status === "failed" ? -12 : -5,
      type: "negative" as const,
    }));

  const findingDrivers = findings
    .filter(isScoreableFinding)
    .sort((a, b) => findingRiskPenalty(b) - findingRiskPenalty(a))
    .slice(0, 6)
    .map((finding) => ({
      factor: finding.title,
      impact: -Math.max(2, Math.min(14, Math.round(findingRiskPenalty(finding)))),
      type: "negative" as const,
    }));

  return [...positiveDrivers, ...validationDrivers, ...findingDrivers]
    .sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact))
    .slice(0, 12);
}

export function calculateScoreBreakdown(findings: Finding[], validationChecks: ValidationCheck[]): FinanceScoreBreakdown {
  const passRate =
    validationChecks.length === 0
      ? 88
      : Math.round((validationChecks.filter((v) => v.status === "passed").length / validationChecks.length) * 100);

  const scoreFor = (key: keyof FinanceScoreBreakdown) => {
    const penalty = findings
      .filter((f) => BREAKDOWN_MAP[key].includes(f.category) && isScoreableFinding(f))
      .reduce((sum, f) => sum + findingRiskPenalty(f), 0);
    return Math.round(Math.max(0, 100 - penalty));
  };

  const validationPenalty = validationChecks.reduce((sum, check) => sum + (check.status === "failed" ? 14 : check.status === "warning" ? 4 : 0), 0);

  return {
    cashFlow: scoreFor("cashFlow"),
    receivables: scoreFor("receivables"),
    payables: scoreFor("payables"),
    vatRisk: scoreFor("vatRisk"),
    controls: scoreFor("controls"),
    closeReview: scoreFor("closeReview"),
    financialStatements: scoreFor("financialStatements"),
    dataQuality: Math.round(Math.max(0, Math.min(passRate, 100 - validationPenalty - scorePenaltyForCategory(findings, FINDING_CATEGORIES.DATA_QUALITY)))),
  };
}

export function parseImpactAmount(impact: string): number {
  if (!impact) return 0;
  const match = impact.match(/(?:£|GBP\s*)([\d,]+(?:\.\d+)?)([km]?)/i);
  if (!match) return 0;
  const num = Number(match[1].replace(/,/g, ""));
  const multiplier = match[2].toLowerCase() === "k" ? 1000 : match[2].toLowerCase() === "m" ? 1_000_000 : 1;
  return num * multiplier;
}

export function estimateTimeSaved(findings: Finding[]) {
  const open = findings.filter((item) => !["resolved", "closed", "false_positive", "accepted_risk", "accepted", "rejected", "not_applicable"].includes(item.status)).length;
  if (!open) return 0;
  return Math.round(open * 2.4 + 8);
}

export function estimateCashAtRisk(findings: Finding[]) {
  return findings.filter((finding) => finding.evidenceStrength !== "advisory").reduce((sum, finding) => {
    const actual = finding.amount ?? parseImpactAmount(finding.expectedImpact);
    return actual > 0 ? sum + actual : sum;
  }, 0);
}

export function estimateUnknownExposureCount(findings: Finding[]) {
  return findings.filter((finding) => finding.evidenceStrength !== "advisory" && parseImpactAmount(finding.expectedImpact) === 0).length;
}

export type ReadinessDriver = {
  label: string;
  weight: number;
  passed: boolean;
  detail: string;
};

export function calculateAuditReadinessV2(findings: Finding[], validationChecks: ValidationCheck[], uploads: { fileType: string }[]) {
  if (!uploads.length) return 0;
  const drivers = calculateReadinessDrivers(findings, validationChecks, uploads);
  const earned = drivers.reduce((sum, driver) => sum + (driver.passed ? driver.weight : 0), 0);
  const openCritical = findings.filter((f) => isScoreableFinding(f) && f.severity === "critical").length;
  const openHigh = findings.filter((f) => isScoreableFinding(f) && f.severity === "high").length;
  return Math.max(0, Math.min(98, Math.round(earned - openCritical * 8 - openHigh * 2)));
}

export function calculateReadinessDrivers(findings: Finding[], validationChecks: ValidationCheck[], uploads: { fileType: string }[] = []): ReadinessDriver[] {
  const present = new Set(uploads.map((upload) => upload.fileType));
  const tb = findValidation(validationChecks, ["trial balance balances to zero"]);
  const vat = findValidation(validationChecks, ["vat report agrees", "vat control"]);
  const ar = findValidation(validationChecks, ["ar ledger agrees", "debtors control"]);
  const ap = findValidation(validationChecks, ["ap ledger agrees", "creditors control"]);
  const bank = findValidation(validationChecks, ["cash accounts ready", "bank reconciliation"]);
  const payrollBlocked = openFinding(findings, ["payroll missing", "no payroll", "paye", "nic"]);
  const depreciationBlocked = openFinding(findings, ["no depreciation", "zero depreciation", "depreciation charge"]);

  return [
    readinessDriver("TB balanced", 20, present.has("trial_balance"), tb?.status === "passed", tb?.detail ?? "Trial balance balance check has not passed."),
    readinessDriver("VAT reconciled", 15, present.has("vat_report"), vat?.status === "passed", vat?.detail ?? "VAT control reconciliation has not passed."),
    readinessDriver("AR reconciled", 15, present.has("aged_debtors"), ar?.status === "passed", ar?.detail ?? "AR control reconciliation has not passed."),
    readinessDriver("AP reconciled", 15, present.has("aged_creditors"), ap?.status === "passed", ap?.detail ?? "AP control reconciliation has not passed."),
    readinessDriver(
      "Payroll posted",
      10,
      present.has("profit_loss") || present.has("trial_balance"),
      !payrollBlocked,
      payrollBlocked ? "Open payroll/PAYE/NIC finding requires review." : "No open payroll posting blocker detected."
    ),
    readinessDriver(
      "Depreciation posted",
      10,
      present.has("profit_loss") || present.has("trial_balance"),
      !depreciationBlocked,
      depreciationBlocked ? "Open depreciation finding requires review." : "No open depreciation blocker detected."
    ),
    readinessDriver("Bank reconciled", 15, present.has("trial_balance"), bank?.status === "passed", bank?.detail ?? "Bank reconciliation readiness check has not passed."),
  ];
}

export function calculateReviewConfidence(findings: Finding[], validationChecks: ValidationCheck[], uploads: { fileType: string }[]) {
  if (!uploads.length) return 0;
  const required = ["trial_balance", "profit_loss", "balance_sheet", "aged_debtors", "aged_creditors", "vat_report"];
  const present = new Set(uploads.map((upload) => upload.fileType));
  const coverage = (required.filter((fileType) => present.has(fileType)).length / required.length) * 100;
  const validation = validationChecks.length
    ? (validationChecks.filter((check) => check.status === "passed").length / validationChecks.length) * 100
    : 75;
  const evidence = findings.length
    ? (findings.filter((finding) => finding.evidence?.sourceFile).length / findings.length) * 100
    : 100;
  return Math.round(Math.max(0, Math.min(98, coverage * 0.35 + validation * 0.4 + evidence * 0.25)));
}

export function findingRiskPenalty(finding: Finding) {
  const evidenceWeight = finding.evidenceStrength === "deterministic" ? 1 : finding.evidenceStrength === "advisory" ? 0.25 : 0.75;
  return (SEVERITY_PENALTY[finding.severity] ?? 4) *
    (CATEGORY_RISK_WEIGHTS[finding.category] ?? 1) *
    (CONFIDENCE_WEIGHTS[finding.confidence] ?? 0.7) *
    evidenceWeight *
    materialityWeight(finding);
}

function scorePenaltyForCategory(findings: Finding[], category: Finding["category"]) {
  return findings
    .filter((finding) => finding.category === category && isScoreableFinding(finding))
    .reduce((sum, finding) => sum + findingRiskPenalty(finding), 0);
}

function isScoreableFinding(finding: Finding) {
  return !["resolved", "closed", "false_positive", "accepted_risk", "accepted", "rejected", "not_applicable"].includes(finding.status) && finding.evidenceStrength !== "advisory";
}

function materialityWeight(finding: Finding) {
  const amount = parseImpactAmount(finding.expectedImpact);
  if (amount <= 0) return 1;
  if (amount < 1_000) return 0.75;
  if (amount < 10_000) return 0.9;
  if (amount < 100_000) return 1.1;
  if (amount < 500_000) return 1.35;
  return 1.6;
}

function scoreDriverLabel(name: string, detail: string) {
  if (/vat report agrees|vat control/i.test(name)) return amountFromDetail(detail, "VAT control mismatch");
  if (/ar ledger agrees|debtors control/i.test(name)) return amountFromDetail(detail, "AR control difference");
  if (/ap ledger agrees|creditors control/i.test(name)) return amountFromDetail(detail, "AP control difference");
  if (/balance sheet equation/i.test(name)) return amountFromDetail(detail, "Balance sheet equation difference");
  if (/bank reconciliation/i.test(name)) return amountFromDetail(detail, "Bank reconciliation difference");
  if (/p&l movement|retained earnings/i.test(name)) return amountFromDetail(detail, "P&L to retained earnings difference");
  return name;
}

function amountFromDetail(detail: string, fallback: string) {
  const matches = [...detail.matchAll(/£[\d,]+/g)].map((match) => match[0]);
  return matches.length ? `${fallback} ${matches[matches.length - 1]}` : fallback;
}

function findValidation(validationChecks: ValidationCheck[], names: string[]) {
  return validationChecks.find((item) => names.some((name) => item.name.toLowerCase().includes(name.toLowerCase())));
}

function openFinding(findings: Finding[], names: string[]) {
  return findings.some((finding) => isScoreableFinding(finding) && names.some((name) => finding.title.toLowerCase().includes(name.toLowerCase())));
}

function readinessDriver(label: string, weight: number, hasEvidence: boolean, passed: boolean, detail: string): ReadinessDriver {
  return {
    label,
    weight,
    passed: hasEvidence && passed,
    detail: hasEvidence ? detail : `${label} requires supporting evidence before sign-off.`,
  };
}

export function generateForecast(cashBalance?: number, arRisk?: number): CashForecastPoint[] {
  const today = cashBalance ?? 248000;
  const risk = arRisk ?? 0;
  const d30 = Math.max(0, today - risk * 0.3);
  const d60 = Math.max(0, today - risk * 0.55);
  const d90 = Math.max(0, today - risk * 0.75);

  const riskAt = (v: number): RiskLevel =>
    v >= today * 0.8 ? "low" : v >= today * 0.55 ? "medium" : "high";

  return [
    { period: "Today", cash: Math.round(today), risk: "low" },
    { period: "30d",   cash: Math.round(d30),   risk: riskAt(d30) },
    { period: "60d",   cash: Math.round(d60),   risk: riskAt(d60) },
    { period: "90d",   cash: Math.round(d90),   risk: riskAt(d90) },
  ];
}

export function assistantAnswer(question: string, score: number, findings: Finding[], forecast: CashForecastPoint[]) {
  const normalized = question.toLowerCase();
  const open = findings.filter((item) => !["resolved", "closed", "false_positive", "accepted_risk", "accepted", "rejected", "not_applicable"].includes(item.status));
  const top = [...open].sort((a, b) => severityRank(b.severity) - severityRank(a.severity))[0];

  if (normalized.includes("profit") || normalized.includes("margin")) {
    return "Profit pressure is mainly driven by rising operating expenses and slower collections. Gross margin should be reviewed against supplier price changes and discounting patterns.";
  }
  if (normalized.includes("cash")) {
    return `The 90-day forecast falls to £${forecast[3].cash.toLocaleString()}. The biggest cash lever is AR collections: prioritise overdue debtors and delay non-critical supplier payments.`;
  }
  if (normalized.includes("vat")) {
    return "VAT review found missing VAT codes and an unusual input VAT movement. Review transactions without codes, compare the VAT control account to the return, and document exceptions before submission.";
  }
  if (normalized.includes("close") || normalized.includes("month")) {
    return "Month-end close should focus on missing accruals, unusual journals, and unreconciled balance sheet accounts. ClosePilot recommends resolving high-severity findings before pack sign-off.";
  }
  if (normalized.includes("score")) {
    return `Finance Health Score is ${score}/100. The main drag is ${top?.title ?? "open finance risks"}. Completing high-priority recommendations should improve the score fastest.`;
  }
  return `I would start with ${top?.title ?? "the highest risk finding"}. It has the strongest impact on close quality, cash visibility, and control confidence.`;
}

function severityRank(level: RiskLevel) {
  return { low: 1, medium: 2, high: 3, critical: 4 }[level];
}
