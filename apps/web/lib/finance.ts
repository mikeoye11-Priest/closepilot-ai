import type { CashForecastPoint, FinanceScoreBreakdown, Finding, Recommendation, RiskLevel } from "./types";

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
    breakdown.cashFlow * 0.24 +
      breakdown.receivables * 0.18 +
      breakdown.payables * 0.14 +
      breakdown.vatRisk * 0.16 +
      breakdown.controls * 0.16 +
      breakdown.dataQuality * 0.12
  );
  const completedBoost = recommendations.filter((item) => item.completed).length * 3;
  return Math.max(0, Math.min(100, base + completedBoost));
}

export function estimateTimeSaved(findings: Finding[]) {
  const hours = findings.filter((item) => item.status !== "resolved").length * 2.4 + 8;
  return Math.round(hours);
}

export function estimateCashAtRisk(findings: Finding[]) {
  return findings.reduce((sum, finding) => {
    if (finding.severity === "critical") return sum + 42000;
    if (finding.severity === "high") return sum + 18000;
    if (finding.severity === "medium") return sum + 7500;
    return sum + 1200;
  }, 0);
}

export function generateForecast(): CashForecastPoint[] {
  return [
    { period: "Today", cash: 248000, risk: "low" },
    { period: "30d", cash: 196000, risk: "medium" },
    { period: "60d", cash: 138000, risk: "high" },
    { period: "90d", cash: 91000, risk: "high" }
  ];
}

export function assistantAnswer(question: string, score: number, findings: Finding[], forecast: CashForecastPoint[]) {
  const normalized = question.toLowerCase();
  const open = findings.filter((item) => item.status !== "resolved");
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
