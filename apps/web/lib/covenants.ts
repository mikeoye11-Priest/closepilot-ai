// Covenant & liquidity alerts.
//
// Evaluates the liquidity/solvency ratios lenders and boards watch against
// thresholds, and — using the 13-week projection — flags when the forecast
// breaches a minimum-cash floor. Defaults reflect common SME facility covenants;
// callers can override the thresholds.

import { buildManagementAccounts, type SyncStatements } from "./management-accounts";
import { buildRunway } from "./runway";
import { buildThirteenWeekCashflow, thirteenWeekInputFromStatements } from "./cashflow-13week";

export type CovenantStatus = "pass" | "watch" | "breach";
export type CovenantUnit = "ratio" | "months" | "gbp";
export type Covenant = { name: string; actual: number; threshold: number; status: CovenantStatus; unit: CovenantUnit; detail: string };
export type CovenantReport = { covenants: Covenant[]; passed: number; watches: number; breaches: number; available: boolean };

export type CovenantThresholds = { currentRatio: number; quickRatio: number; cashCoverMonths: number; minForecastCash: number };
export const DEFAULT_COVENANTS: CovenantThresholds = { currentRatio: 1.2, quickRatio: 1.0, cashCoverMonths: 1.0, minForecastCash: 0 };

// pass ≥ 110% of threshold, watch within 10% above, breach below.
function statusFor(actual: number, threshold: number): CovenantStatus {
  if (actual < threshold) return "breach";
  if (actual < threshold * 1.1) return "watch";
  return "pass";
}

function inventoryTotal(sections: Array<{ lines: Array<{ name: string; amount: number }> }>): number {
  return sections.flatMap((s) => s.lines).filter((l) => /stock|inventory|work in progress|wip/i.test(l.name)).reduce((sum, l) => sum + Math.abs(l.amount), 0);
}

export function buildCovenants(statements: SyncStatements, thresholds: CovenantThresholds = DEFAULT_COVENANTS): CovenantReport {
  const pack = buildManagementAccounts(statements);
  const currentAssets = pack.bs.totalCurrentAssets;
  const currentLiabilities = pack.bs.totalLiabilities;
  const inventory = inventoryTotal(pack.bs.currentAssets);
  const runway = buildRunway(statements);
  const forecast = buildThirteenWeekCashflow(thirteenWeekInputFromStatements(statements, "base"));

  const covenants: Covenant[] = [];
  const gbp = (v: number) => `£${Math.round(v).toLocaleString("en-GB")}`;

  if (currentLiabilities > 0) {
    const currentRatio = currentAssets / currentLiabilities;
    covenants.push({ name: "Current ratio", actual: currentRatio, threshold: thresholds.currentRatio, status: statusFor(currentRatio, thresholds.currentRatio), unit: "ratio", detail: `Current assets ${gbp(currentAssets)} ÷ current liabilities ${gbp(currentLiabilities)}` });
    const quickRatio = (currentAssets - inventory) / currentLiabilities;
    covenants.push({ name: "Quick (acid-test) ratio", actual: quickRatio, threshold: thresholds.quickRatio, status: statusFor(quickRatio, thresholds.quickRatio), unit: "ratio", detail: `Excludes ${gbp(inventory)} of stock/WIP` });
  }
  if (runway.status !== "unavailable" && runway.monthlyOperatingCosts > 0) {
    covenants.push({ name: "Cash cover", actual: runway.cashCoverMonths, threshold: thresholds.cashCoverMonths, status: statusFor(runway.cashCoverMonths, thresholds.cashCoverMonths), unit: "months", detail: `${gbp(runway.cashOnHand)} cash vs monthly operating costs` });
  }
  covenants.push({ name: "13-week minimum cash", actual: forecast.lowestBalance, threshold: thresholds.minForecastCash, status: statusFor(forecast.lowestBalance, thresholds.minForecastCash), unit: "gbp", detail: `Projected low in week ${forecast.lowestWeek}` });

  return {
    covenants,
    passed: covenants.filter((c) => c.status === "pass").length,
    watches: covenants.filter((c) => c.status === "watch").length,
    breaches: covenants.filter((c) => c.status === "breach").length,
    available: covenants.length > 0,
  };
}
