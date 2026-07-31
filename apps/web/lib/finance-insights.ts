// Cross-tool finance insights.
//
// Reads all the finance-manager tools (13-week cash flow, runway, working
// capital, variance, covenants, concentration) and synthesises the "so-what":
// prioritised, explained signals with a recommended action each, plus a plain
// fact sheet the AI narrative is grounded in. Fully deterministic — the AI layer
// only narrates these numbers, it never invents them.

import { buildThirteenWeekCashflow, thirteenWeekInputFromStatements } from "./cashflow-13week";
import { buildRunway } from "./runway";
import { buildWorkingCapital } from "./working-capital";
import { buildVariance } from "./variance";
import { buildCovenants } from "./covenants";
import { buildConcentration } from "./concentration";
import type { SyncStatements } from "./management-accounts";

export type InsightSeverity = "critical" | "high" | "medium" | "positive" | "info";
export type FinanceSignal = { severity: InsightSeverity; area: string; title: string; detail: string; action: string };
export type FinanceInsights = { headline: string; signals: FinanceSignal[]; factSheet: string; available: boolean };

const gbp = (value: number) => `${value < 0 ? "−£" : "£"}${Math.abs(Math.round(value)).toLocaleString("en-GB")}`;
const SEVERITY_ORDER: Record<InsightSeverity, number> = { critical: 0, high: 1, medium: 2, positive: 3, info: 4 };

export function buildFinanceInsights(statements: SyncStatements): FinanceInsights {
  const cf = buildThirteenWeekCashflow(thirteenWeekInputFromStatements(statements, "base"));
  const runway = buildRunway(statements);
  const wc = buildWorkingCapital(statements);
  const variance = buildVariance(statements);
  const covenants = buildCovenants(statements);
  const concentration = buildConcentration(statements);

  const signals: FinanceSignal[] = [];

  // Liquidity — the 13-week floor is the sharpest signal.
  if (cf.firstNegativeWeek) {
    signals.push({ severity: "critical", area: "Liquidity", title: `Cash turns negative in week ${cf.firstNegativeWeek}`, detail: `The 13-week projection bottoms at ${gbp(cf.lowestBalance)} in week ${cf.lowestWeek}.`, action: "Pull collections forward, phase supplier payments, or arrange facility headroom before then." });
  }

  // Runway / cash cover.
  if (runway.status === "burning" && runway.runwayMonths !== null) {
    signals.push({ severity: runway.runwayMonths < 6 ? "critical" : "high", area: "Runway", title: `~${runway.runwayMonths.toFixed(1)} months of runway`, detail: `Burning ${gbp(runway.burnRateMonthly ?? 0)}/month against ${gbp(runway.cashOnHand)} of cash.`, action: "Cut discretionary spend, accelerate receipts, or raise finance to extend runway." });
  } else if (runway.status !== "unavailable" && runway.cashCoverMonths < 1) {
    signals.push({ severity: "high", area: "Liquidity", title: `Thin cash cover — ${runway.cashCoverMonths.toFixed(1)} months`, detail: `You hold under a month of operating costs (${gbp(runway.cashOnHand)}) in cash.`, action: "Build a cash buffer or secure a facility, and keep collections tight." });
  }

  // Covenants — solvency ratios only (liquidity/cash covered above).
  for (const covenant of covenants.covenants.filter((c) => c.status === "breach" && !/cash/i.test(c.name))) {
    signals.push({ severity: "high", area: "Benchmark", title: `${covenant.name} below benchmark`, detail: covenant.detail, action: "Review — this is a configured liquidity benchmark, not a loaded lender covenant. If a facility applies, load its actual covenant terms." });
  }

  // Working capital.
  if (wc.available && wc.ccc !== null && wc.ccc > 60) {
    signals.push({ severity: "medium", area: "Working capital", title: `${Math.round(wc.ccc)} days of cash tied up in the cycle`, detail: `DSO ${Math.round(wc.dso ?? 0)} + DIO ${Math.round(wc.dio ?? 0)} − DPO ${Math.round(wc.dpo ?? 0)} days.`, action: `Cutting debtor days by 5 would release about ${gbp(wc.cashPerDsoDay * 5)}.` });
  }

  // Customer concentration — only claim top customers when the book is attributed.
  if (concentration.available && !concentration.attributable && concentration.unattributedShare > 0.5) {
    signals.push({ severity: "medium", area: "Concentration", title: `${(concentration.unattributedShare * 100).toFixed(0)}% of receivables not matched to a customer`, detail: "Customer concentration can't be assessed while most of the book is unattributed.", action: "Match aged debtors to customers to assess concentration and target collections." });
  } else if (concentration.available && concentration.attributable && concentration.level !== "low") {
    signals.push({ severity: concentration.level === "high" ? "high" : "medium", area: "Concentration", title: `${concentration.customers[0]?.name} is ${(concentration.top1Share * 100).toFixed(0)}% of matched receivables`, detail: `The top 3 customers are ${(concentration.top3Share * 100).toFixed(0)}% of the matched book.`, action: "Set credit limits or take deposits on key accounts, and broaden the customer base." });
  }

  // Performance (variance) — a positive to protect, or a drop to investigate.
  if (variance.hasComparison) {
    const net = variance.lines.find((line) => line.label === "Net profit");
    if (net) {
      const pct = net.variancePct === null ? 0 : Math.abs(Math.round(net.variancePct));
      signals.push({
        severity: net.favourable ? "positive" : "high",
        area: "Performance",
        title: `Net profit ${net.favourable ? "up" : "down"} ${pct}% vs prior period`,
        detail: `${gbp(net.actual)} vs ${gbp(net.comparison)} last period.`,
        action: net.favourable ? "Convert the profit growth into cash — that's where it's currently stuck." : "Investigate the drop and rebase the cash forecast.",
      });
    }
  }

  signals.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);

  const headline = deriveHeadline(cf, runway, signals, variance);
  const factSheet = buildFactSheet(cf, runway, wc, variance, covenants, concentration);

  return { headline, signals, factSheet, available: signals.length > 0 };
}

function deriveHeadline(
  cf: ReturnType<typeof buildThirteenWeekCashflow>,
  runway: ReturnType<typeof buildRunway>,
  signals: FinanceSignal[],
  variance: ReturnType<typeof buildVariance>,
): string {
  const net = variance.lines.find((line) => line.label === "Net profit");
  const profitable = (net?.actual ?? 0) > 0;
  const watchAreas = [...new Set(signals.filter((s) => s.severity !== "positive").map((s) => s.area.toLowerCase()))].slice(0, 2);

  if (cf.firstNegativeWeek) return `Cash is projected to go negative in week ${cf.firstNegativeWeek} — short-term liquidity is the priority.`;
  if (runway.status === "burning" && runway.runwayMonths !== null) return `Burning cash with about ${runway.runwayMonths.toFixed(1)} months of runway — extending it is the priority.`;
  if (watchAreas.length && profitable) return `Profitable, but cash-tight — ${watchAreas.join(" and ")} are the watch items.`;
  if (watchAreas.length) return `Watch items this period: ${watchAreas.join(" and ")}.`;
  return "Healthy cash position — no material liquidity concerns this period.";
}

function buildFactSheet(
  cf: ReturnType<typeof buildThirteenWeekCashflow>,
  runway: ReturnType<typeof buildRunway>,
  wc: ReturnType<typeof buildWorkingCapital>,
  variance: ReturnType<typeof buildVariance>,
  covenants: ReturnType<typeof buildCovenants>,
  concentration: ReturnType<typeof buildConcentration>,
): string {
  const net = variance.lines.find((line) => line.label === "Net profit");
  const revenue = variance.lines.find((line) => line.label === "Revenue");
  const breaches = covenants.covenants.filter((c) => c.status === "breach").map((c) => c.name);
  return [
    "13-WEEK CASH FLOW",
    `Opening cash: ${gbp(cf.openingCash)}`,
    `Week-13 closing cash: ${gbp(cf.closingCash)}`,
    `Lowest projected balance: ${gbp(cf.lowestBalance)} in week ${cf.lowestWeek}`,
    `First negative week: ${cf.firstNegativeWeek ?? "none"}`,
    `Total 13-week receipts / payments: ${gbp(cf.totalReceipts)} / ${gbp(cf.totalPayments)}`,
    "",
    "RUNWAY",
    `Status: ${runway.status}`,
    `Monthly operating cash: ${gbp(runway.monthlyOperatingCash)}`,
    `Cash cover: ${runway.cashCoverMonths.toFixed(1)} months of operating costs`,
    runway.runwayMonths !== null ? `Runway: ${runway.runwayMonths.toFixed(1)} months` : "Runway: cash-generative",
    "",
    "WORKING CAPITAL",
    wc.available ? `Cash conversion cycle: ${Math.round(wc.ccc ?? 0)} days (DSO ${Math.round(wc.dso ?? 0)}, DIO ${Math.round(wc.dio ?? 0)}, DPO ${Math.round(wc.dpo ?? 0)})` : "Not available",
    wc.available ? `Cash released per DSO day: ${gbp(wc.cashPerDsoDay)}` : "",
    "",
    "PERFORMANCE (vs prior period)",
    revenue ? `Revenue: ${gbp(revenue.actual)} (${revenue.variancePct === null ? "—" : `${revenue.variancePct >= 0 ? "+" : ""}${revenue.variancePct.toFixed(1)}%`})` : "n/a",
    net ? `Net profit: ${gbp(net.actual)} (${net.variancePct === null ? "—" : `${net.variancePct >= 0 ? "+" : ""}${net.variancePct.toFixed(1)}%`})` : "n/a",
    "",
    "COVENANTS",
    `Breaches: ${breaches.length ? breaches.join(", ") : "none"}`,
    "",
    "CUSTOMER CONCENTRATION",
    concentration.available ? `Largest customer ${concentration.customers[0]?.name}: ${(concentration.top1Share * 100).toFixed(0)}% of receivables; top 3: ${(concentration.top3Share * 100).toFixed(0)}%; level: ${concentration.level}` : "Not available",
  ].filter(Boolean).join("\n");
}
