// Working capital & the cash conversion cycle (CCC).
//
// DSO (days sales outstanding) + DIO (days inventory outstanding) − DPO (days
// payable outstanding) = how many days of cash are tied up in the operating
// cycle. Plus the lever every finance manager wants: how much cash each day of
// DSO reduction frees up. Derived from the same statements the accounts use.

import { buildManagementAccounts, type SyncStatements } from "./management-accounts";

export type WorkingCapital = {
  revenue: number;
  cogs: number;
  debtors: number;
  creditors: number;
  inventory: number;
  dso: number | null; // days
  dpo: number | null;
  dio: number | null;
  ccc: number | null;
  cashPerDsoDay: number; // £ released per day of DSO reduction
  netWorkingCapital: number; // current assets − current liabilities
  available: boolean;
};

const days = (numerator: number, denominator: number): number | null => (denominator > 0 ? (numerator / denominator) * 365 : null);

function lineTotal(sections: Array<{ lines: Array<{ name: string; amount: number }> }>, re: RegExp): number {
  return sections.flatMap((section) => section.lines).filter((line) => re.test(line.name)).reduce((sum, line) => sum + Math.abs(line.amount), 0);
}

export function buildWorkingCapital(statements: SyncStatements): WorkingCapital {
  const pack = buildManagementAccounts(statements);
  const revenue = pack.pl.revenue;
  const cogs = Math.abs(pack.pl.cogs);

  // Prefer the aged-ledger totals (what's actually outstanding); fall back to the
  // balance-sheet lines.
  const agedDebtors = (statements.agedDebtors ?? []).reduce((sum, row) => sum + Math.abs(numVal(row.amount)), 0);
  const agedCreditors = (statements.agedCreditors ?? []).reduce((sum, row) => sum + Math.abs(numVal(row.amount)), 0);
  const debtors = agedDebtors || lineTotal(pack.bs.currentAssets, /debtor|receivable/i);
  const creditors = agedCreditors || lineTotal(pack.bs.liabilities, /creditor|payable/i);
  const inventory = lineTotal(pack.bs.currentAssets, /stock|inventory|work in progress|wip/i);

  const dso = days(debtors, revenue);
  const dpo = days(creditors, cogs);
  const dio = days(inventory, cogs);
  const ccc = dso !== null && dpo !== null && dio !== null ? dso + dio - dpo : null;

  return {
    revenue,
    cogs,
    debtors,
    creditors,
    inventory,
    dso,
    dpo,
    dio,
    ccc,
    cashPerDsoDay: revenue > 0 ? revenue / 365 : 0,
    netWorkingCapital: pack.bs.totalCurrentAssets - pack.bs.totalLiabilities,
    available: revenue > 0 && (debtors > 0 || creditors > 0 || inventory > 0),
  };
}

function numVal(value: unknown): number {
  const parsed = Number(String(value ?? "").replace(/[£$,\s]/g, "").replace(/^\((.*)\)$/, "-$1"));
  return Number.isFinite(parsed) ? parsed : 0;
}
