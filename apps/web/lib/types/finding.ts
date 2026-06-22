// Re-export Finding from the main types file for convenience
// This file exists as the canonical import path for the assurance framework
export type { Finding, FindingStatus, ConfidenceLevel, RiskLevel } from "@/lib/types";

export interface StatisticalFinding {
  ruleId: string;
  category: string;
  score: number;        // 0–1 anomaly score
  confidence: number;   // 0–1 confidence level
  title: string;
  finding: string;
  calculation: string;
  sourceFile: string;
  severity: "low" | "medium" | "high" | "critical";
}

export interface LayerSummary {
  layer: number;
  name: string;
  rulesRun: number;
  findingsCount: number;
  criticalCount: number;
  highCount: number;
  status: "clean" | "warning" | "critical" | "not_run";
}
