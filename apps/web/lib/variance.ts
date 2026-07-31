// Budget / prior-period variance.
//
// Line-by-line P&L variance vs a comparison base (the prior period when present),
// with £ and % movement and a favourable/adverse read that respects direction —
// higher income/profit is favourable, higher cost is adverse. Reuses the P&L the
// management accounts already build (current + prior).

import { buildManagementAccounts, type SyncStatements } from "./management-accounts";

export type VarianceKind = "income" | "cost" | "result";
export type VarianceLine = {
  label: string;
  actual: number; // magnitude (costs shown positive)
  comparison: number;
  variance: number; // actual − comparison
  variancePct: number | null;
  favourable: boolean;
  kind: VarianceKind;
};
export type VarianceReport = { lines: VarianceLine[]; hasComparison: boolean; basis: string };

function line(label: string, kind: VarianceKind, actual: number, comparison: number): VarianceLine {
  const variance = actual - comparison;
  const favourable = kind === "cost" ? variance <= 0 : variance >= 0;
  return { label, kind, actual, comparison, variance, variancePct: comparison !== 0 ? (variance / Math.abs(comparison)) * 100 : null, favourable };
}

export function buildVariance(statements: SyncStatements): VarianceReport {
  const pack = buildManagementAccounts(statements);
  const { pl, prior } = pack;
  const lines: VarianceLine[] = [
    line("Revenue", "income", pl.revenue, prior.revenue),
    line("Cost of sales", "cost", Math.abs(pl.cogs), Math.abs(prior.cogs)),
    line("Gross profit", "result", pl.grossProfit, prior.grossProfit),
    line("Overheads", "cost", Math.abs(pl.overheads), Math.abs(prior.overheads)),
    line("Net profit", "result", pl.netProfit, prior.netProfit),
  ];
  return { lines, hasComparison: prior.hasComparatives, basis: "Prior period" };
}
