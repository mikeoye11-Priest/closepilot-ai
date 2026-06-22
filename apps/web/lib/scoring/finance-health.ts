import type { Finding, ValidationCheck } from "@/lib/types";
import { calculateFinanceScorecard, calculateScoreBreakdown } from "@/lib/finance";

export function calculateFinanceHealthScore(
  findings: Finding[],
  validationChecks: ValidationCheck[],
  completedRecommendations: number
): number {
  const recommendations = Array.from({ length: completedRecommendations }, (_, index) => ({
    id: `completed_${index}`,
    tenantId: "",
    companyId: "",
    findingId: "",
    action: "",
    expectedImpact: "",
    priority: "low" as const,
    completed: true,
  }));
  return calculateFinanceScorecard(findings, validationChecks, recommendations).overall;
}

export function getScoreBreakdown(findings: Finding[], validationChecks: ValidationCheck[]) {
  return calculateScoreBreakdown(findings, validationChecks);
}
