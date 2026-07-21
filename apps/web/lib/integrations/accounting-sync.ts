// Provider-agnostic sync shape + helpers shared by the accounting integrations.
// The Xero sync (xero-sync.ts) and the QuickBooks sync (quickbooks-sync.ts) both
// produce this shape; downstream (accountingParsedFiles → analyseParsedFiles →
// statements/accounts) consumes it without caring which provider produced it.

export type AccountingSyncData = {
  trialBalanceRows: Record<string, string>[];
  profitLossRows: Record<string, string>[];
  priorProfitLossRows: Record<string, string>[];
  balanceSheetRows: Record<string, string>[];
  agedDebtorRows: Record<string, string>[];
  agedCreditorRows: Record<string, string>[];
  bankReconRows: Record<string, string>[];
  vatRows: Record<string, string>[];
  counts: Record<string, number>;
  // Per-source failures — one broken report/endpoint warns rather than failing
  // the whole sync.
  warnings: string[];
  periodStart: string;
  vatPeriodStart: string;
  vatPeriodEnd: string;
};

export function numberFrom(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = Number(String(value ?? "").replace(/[£$,\s]/g, "").replace(/^\((.*)\)$/, "-$1"));
  return Number.isFinite(parsed) ? parsed : 0;
}

// The financial-year start containing asOfDate, from the FY-end day/month: the
// day after the FY end that precedes asOfDate. (Same rule as the Xero sync.)
export function financialYearStart(asOfDate: string, endMonth: number, endDay: number): string {
  const asOf = Date.parse(asOfDate);
  const year = Number(asOfDate.slice(0, 4));
  const endThisYear = Date.UTC(year, endMonth - 1, endDay);
  const precedingEnd = endThisYear < asOf ? endThisYear : Date.UTC(year - 1, endMonth - 1, endDay);
  const start = new Date(precedingEnd);
  start.setUTCDate(start.getUTCDate() + 1);
  return start.toISOString().slice(0, 10);
}

// Shift an ISO date by whole years, preserving month/day.
export function shiftYear(date: string, delta: number): string {
  return `${Number(date.slice(0, 4)) + delta}${date.slice(4)}`;
}

export function daysOverdue(dueDate: string, asOfDate: string): number {
  if (!dueDate) return 0;
  return Math.max(0, Math.floor((Date.parse(asOfDate) - Date.parse(dueDate)) / 86_400_000));
}

// One VAT-evidence line in the shape the VAT engine expects (matches the
// vat_report headers in accounting-parsed-files.ts).
export function vatRow(input: {
  date?: string; type: string; party?: string; description?: string;
  net?: unknown; vat?: unknown; gross?: unknown; taxCode?: string; nominalCode?: string; reference?: string; source?: string;
}): Record<string, string> {
  const net = numberFrom(input.net);
  const vat = numberFrom(input.vat);
  const gross = input.gross === undefined ? net + vat : numberFrom(input.gross);
  return {
    date: input.date ?? "",
    type: input.type,
    party: input.party ?? "",
    description: input.description ?? "",
    net_amount: String(net),
    vat_amount: String(vat),
    gross_amount: String(gross),
    vat_code: input.taxCode ?? "",
    nominal_code: input.nominalCode ?? "",
    reference: input.reference ?? "",
    source_system: input.source ?? "",
  };
}

// Run tasks with at most `limit` in flight, preserving input order.
export async function runWithConcurrency<T>(limit: number, tasks: Array<() => Promise<T>>): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < tasks.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await tasks[index]();
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}
