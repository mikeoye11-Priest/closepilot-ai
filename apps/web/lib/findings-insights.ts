// Findings prioritiser.
//
// Ranks the OPEN review findings by cash/risk impact (severity × exposure, with a
// nudge for deterministic evidence) and explains why each is a priority — so a
// reviewer works the highest-impact items first. Deterministic; feeds the same
// grounded AI narrator as the other insight tools.

import { parseImpactAmount } from "./finance";
import type { Finding } from "./types";
import type { FinanceSignal, InsightSeverity } from "./finance-insights";

export type FindingsInsights = { headline: string; signals: FinanceSignal[]; factSheet: string; totalExposure: number; openCount: number; available: boolean };

const CLOSED = new Set(["resolved", "approved", "closed", "false_positive", "accepted_risk", "accepted", "rejected", "not_applicable"]);
const SEV_WEIGHT: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };
const SEV_MAP: Record<string, InsightSeverity> = { critical: "critical", high: "high", medium: "medium", low: "info" };
const CATEGORY_LABEL: Record<string, string> = { month_end: "Month-end", cashflow: "Cash flow", ar: "Debtors", ap: "Creditors", vat: "VAT", controls: "Controls", data_quality: "Data quality", financial_statements: "Financial statements" };

const gbp = (value: number) => `£${Math.round(Math.abs(value)).toLocaleString("en-GB")}`;

export function buildFindingsInsights(findings: Finding[]): FindingsInsights {
  const open = (findings ?? []).filter((f) => !CLOSED.has(f.status));
  if (!open.length) {
    return { headline: "No open findings — the review is clear.", signals: [], factSheet: "", totalExposure: 0, openCount: 0, available: false };
  }

  const scored = open
    .map((finding) => {
      const amount = Math.abs(finding.amount ?? parseImpactAmount(finding.expectedImpact) ?? 0);
      const weight = SEV_WEIGHT[finding.severity] ?? 1;
      const deterministic = finding.evidenceStrength === "deterministic";
      const score = weight * Math.max(1, amount) * (deterministic ? 1.15 : 1);
      return { finding, amount, deterministic, score };
    })
    .sort((a, b) => b.score - a.score);

  const totalExposure = scored.reduce((sum, item) => sum + item.amount, 0);
  const evidenceLabel = (item: (typeof scored)[number]) => (item.deterministic ? "deterministic" : item.finding.evidenceStrength ?? "advisory");

  const signals: FinanceSignal[] = scored.slice(0, 5).map((item, index) => ({
    severity: SEV_MAP[item.finding.severity] ?? "info",
    area: CATEGORY_LABEL[item.finding.category] ?? item.finding.category,
    title: item.finding.title,
    detail: `${item.amount > 0 ? `${gbp(item.amount)} exposure · ` : ""}${item.finding.severity} severity · ${evidenceLabel(item)} evidence`,
    action: `Priority #${index + 1} by cash/risk impact — ${item.deterministic ? "evidence is deterministic; " : ""}resolve or document accepted risk before sign-off.`,
  }));

  const headline = `${open.length} open finding${open.length === 1 ? "" : "s"}${totalExposure > 0 ? `, ${gbp(totalExposure)} total exposure` : ""} — start with “${scored[0].finding.title}”.`;

  const factSheet = [
    `OPEN FINDINGS: ${open.length}`,
    `Total exposure: ${gbp(totalExposure)}`,
    "",
    "TOP PRIORITIES (ranked by cash/risk impact):",
    ...scored.slice(0, 8).map((item, index) => `${index + 1}. [${item.finding.severity.toUpperCase()}] ${item.finding.title} — ${item.amount > 0 ? `${gbp(item.amount)} exposure, ` : ""}${evidenceLabel(item)} evidence (${CATEGORY_LABEL[item.finding.category] ?? item.finding.category})`),
  ].join("\n");

  return { headline, signals, factSheet, totalExposure, openCount: open.length, available: true };
}
