// Cash runway & burn.
//
// Turns the P&L + cash balance into the questions an owner-manager actually asks:
// are we generating or burning cash each month, how many months of cash do we
// hold, and — if burning — when do we run out? Operating cash adds back
// depreciation (non-cash); cash cover measures months of operating costs held.

import { buildManagementAccounts, type SyncStatements } from "./management-accounts";

export type Runway = {
  cashOnHand: number;
  monthlyOperatingCash: number; // + generative / − burn
  monthlyOperatingCosts: number;
  burnRateMonthly: number | null; // abs monthly burn when burning, else null
  runwayMonths: number | null; // cash ÷ burn when burning, else null
  runwayDate: string | null; // approx date cash reaches zero when burning
  cashCoverMonths: number; // cash ÷ monthly operating costs
  status: "generative" | "burning" | "unavailable";
};

function numVal(value: unknown): number {
  const parsed = Number(String(value ?? "").replace(/[£$,\s]/g, "").replace(/^\((.*)\)$/, "-$1"));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function buildRunway(statements: SyncStatements): Runway {
  const pack = buildManagementAccounts(statements);
  const bank = statements.bank ?? [];
  const cashOnHand = bank.length
    ? bank.reduce((sum, row) => sum + numVal(row.closing_balance), 0)
    : (statements.balanceSheet ?? []).filter((row) => /cash|bank/i.test(String(row.item ?? ""))).reduce((sum, row) => sum + numVal(row.amount), 0);

  // Depreciation (non-cash) added back to profit; costs measured net of it.
  const depreciation = (statements.profitLoss ?? []).filter((row) => /deprecia|amortis/i.test(String(row.description ?? ""))).reduce((sum, row) => sum + Math.abs(numVal(row.amount)), 0);
  const cashCosts = Math.abs(pack.pl.cogs) + Math.abs(pack.pl.overheads) - depreciation;

  const monthlyOperatingCash = (pack.pl.netProfit + depreciation) / 12;
  const monthlyOperatingCosts = cashCosts / 12;

  if (pack.pl.revenue <= 0 && cashCosts <= 0) {
    return { cashOnHand, monthlyOperatingCash: 0, monthlyOperatingCosts: 0, burnRateMonthly: null, runwayMonths: null, runwayDate: null, cashCoverMonths: 0, status: "unavailable" };
  }

  const burning = monthlyOperatingCash < 0;
  const burnRateMonthly = burning ? Math.abs(monthlyOperatingCash) : null;
  const runwayMonths = burning && burnRateMonthly ? cashOnHand / burnRateMonthly : null;

  let runwayDate: string | null = null;
  if (runwayMonths !== null && Number.isFinite(runwayMonths)) {
    const date = new Date();
    date.setUTCMonth(date.getUTCMonth() + Math.max(0, Math.floor(runwayMonths)));
    runwayDate = date.toISOString().slice(0, 10);
  }

  return {
    cashOnHand,
    monthlyOperatingCash,
    monthlyOperatingCosts,
    burnRateMonthly,
    runwayMonths,
    runwayDate,
    cashCoverMonths: monthlyOperatingCosts > 0 ? cashOnHand / monthlyOperatingCosts : 0,
    status: burning ? "burning" : "generative",
  };
}
