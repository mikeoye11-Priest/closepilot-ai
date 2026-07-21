// QuickBooks Online sync — fetches the core statements via the Reports API and
// VAT evidence from tax-coded transactions, flattening QBO's report JSON into the
// same row shapes the review + accounts pipeline consumes (see
// accountingParsedFiles). Returns the provider-agnostic AccountingSyncData.
//
// NOTE: QBO v1 is single-period (no prior-year comparatives) — accounts render
// on a single period, which the packs handle. Comparatives are a follow-up.

import { quickbooksFetch, describeQuickBooksError } from "./quickbooks";
import { type AccountingSyncData, numberFrom, vatRow, runWithConcurrency } from "./accounting-sync";

type Row = Record<string, string>;
type QboColData = { value?: string; id?: string };
type QboRow = { type?: string; Header?: { ColData?: QboColData[] }; Rows?: { Row?: QboRow[] }; Summary?: { ColData?: QboColData[] }; ColData?: QboColData[] };
type QboColumn = { ColTitle?: string; ColType?: string };
type QboReport = { Columns?: { Column?: QboColumn[] }; Rows?: { Row?: QboRow[] } };
type QboTxn = {
  Id?: string; DocNumber?: string; TxnDate?: string; TotalAmt?: number | string;
  CustomerRef?: { name?: string }; VendorRef?: { name?: string }; EntityRef?: { name?: string };
  TxnTaxDetail?: { TotalTax?: number | string; TaxLine?: Array<{ TaxLineDetail?: { TaxRateRef?: { name?: string } } }> };
};

// ── Report tree walking ──────────────────────────────────────────────────────
// Call onData for each leaf Data row, tagged with its nearest enclosing section
// title (QBO reports nest accounts under typed sections: Income, Bank, etc.).
function walkReport(rows: QboRow[] | undefined, section: string, onData: (section: string, cols: QboColData[]) => void) {
  for (const row of rows ?? []) {
    if (row.type === "Data" && row.ColData) {
      onData(section, row.ColData);
    } else if (row.Rows?.Row?.length) {
      const title = row.Header?.ColData?.[0]?.value?.trim() || section;
      walkReport(row.Rows.Row, title, onData);
    }
  }
}
const lastMoney = (cols: QboColData[]) => numberFrom(cols[cols.length - 1]?.value);

// P&L → {category, description, amount}. Sign by classification (income +, cost
// of sales / expenses −) so buildProfitAndLoss computes gross/net profit correctly.
export function flattenQboProfitAndLoss(report: QboReport): Row[] {
  const out: Row[] = [];
  walkReport(report.Rows?.Row, "", (section, cols) => {
    const name = cols[0]?.value?.trim();
    if (!name) return;
    const amount = lastMoney(cols);
    if (amount === 0) return;
    const category = section || "Income";
    const isIncome = /income|revenue|turnover|sales/i.test(category) && !/cost of (sales|goods)/i.test(category);
    out.push({ category, description: name, amount: String(isIncome ? Math.abs(amount) : -Math.abs(amount)), prior_amount: "0" });
  });
  return out;
}

// Balance sheet → {category, item, amount}. QBO presents assets/liabilities/
// equity as positive within their sections and includes current-year Net Income
// in equity, so the sheet balances as-is. Section title classifies the line
// (classifyBalance in management-accounts.ts).
export function flattenQboBalanceSheet(report: QboReport): Row[] {
  const out: Row[] = [];
  walkReport(report.Rows?.Row, "", (section, cols) => {
    const name = cols[0]?.value?.trim();
    if (!name) return;
    const amount = lastMoney(cols);
    if (amount === 0) return;
    out.push({ category: section || "Assets", item: name, amount: String(amount), prior_amount: "0" });
  });
  return out;
}

// Trial balance → {account_code, account_name, debit, credit, balance}.
export function flattenQboTrialBalance(report: QboReport): Row[] {
  const out: Row[] = [];
  walkReport(report.Rows?.Row, "", (_section, cols) => {
    const name = cols[0]?.value?.trim();
    if (!name) return;
    const debit = numberFrom(cols[1]?.value);
    const credit = numberFrom(cols[2]?.value);
    if (debit === 0 && credit === 0) return;
    out.push({ account_code: cols[0]?.id ?? "", account_name: name, debit: String(debit), credit: String(credit), balance: String(debit - credit) });
  });
  return out;
}

// Aged receivables/payables summary → one row per non-zero aging bucket, with a
// representative days_overdue so the aging engine buckets them (Current→0,
// 1-30→15, 31-60→45, 61-90→75, 91+→100).
function bucketDays(title: string): number | null {
  const t = title.toLowerCase();
  if (/^total/.test(t) || !t) return null;
  if (/current/.test(t)) return 0;
  if (/1\s*[-–]\s*30/.test(t)) return 15;
  if (/31\s*[-–]\s*60/.test(t)) return 45;
  if (/61\s*[-–]\s*90/.test(t)) return 75;
  if (/91|over/.test(t)) return 100;
  return null;
}
export function flattenQboAged(report: QboReport, nameKey: "customer_name" | "supplier_name"): Row[] {
  const columns = report.Columns?.Column ?? [];
  const out: Row[] = [];
  walkReport(report.Rows?.Row, "", (_section, cols) => {
    const name = cols[0]?.value?.trim();
    if (!name || /^total/i.test(name)) return;
    columns.forEach((column, index) => {
      const days = bucketDays(column.ColTitle ?? "");
      if (days === null) return;
      const amount = numberFrom(cols[index]?.value);
      if (amount === 0) return;
      out.push({ [nameKey]: name, invoice_number: "", invoice_date: "", due_date: "", days_overdue: String(days), amount: String(amount), status: "" });
    });
  });
  return out;
}

// Bank rows derived from the balance sheet's Bank section (QBO exposes no bank
// summary / statement-line report — cash position only, no unreconciled counts).
function bankRowsFromBalanceSheet(bsRows: Row[]): Row[] {
  return bsRows
    .filter((row) => /\bbank\b|cash/i.test(row.category ?? ""))
    .map((row) => ({ account: row.item ?? "Bank", closing_balance: row.amount ?? "0", unreconciled_count: "0", unreconciled_amount: "0", status: "cash position (from balance sheet)" }));
}

// ── VAT from tax-coded transactions ─────────────────────────────────────────
const VAT_ENTITIES: Array<{ name: string; type: "Sale" | "Purchase"; negate: boolean }> = [
  { name: "Invoice", type: "Sale", negate: false },
  { name: "SalesReceipt", type: "Sale", negate: false },
  { name: "CreditMemo", type: "Sale", negate: true },
  { name: "Bill", type: "Purchase", negate: false },
  { name: "Purchase", type: "Purchase", negate: false },
  { name: "VendorCredit", type: "Purchase", negate: true },
];

async function queryEntity(baseUrl: string, accessToken: string, realmId: string, entity: string, start: string, end: string): Promise<QboTxn[]> {
  const items: QboTxn[] = [];
  for (let startPosition = 1; startPosition <= 3001; startPosition += 1000) {
    const query = `SELECT * FROM ${entity} WHERE TxnDate >= '${start}' AND TxnDate <= '${end}' STARTPOSITION ${startPosition} MAXRESULTS 1000`;
    const response = await quickbooksFetch<{ QueryResponse?: Record<string, QboTxn[]> }>(baseUrl, accessToken, `/v3/company/${realmId}/query?query=${encodeURIComponent(query)}&minorversion=70`);
    const batch = response.QueryResponse?.[entity] ?? [];
    items.push(...batch);
    if (batch.length < 1000) break;
  }
  return items;
}

export function txnVatRow(txn: QboTxn, entity: { name: string; type: "Sale" | "Purchase"; negate: boolean }): Row | null {
  const totalTax = numberFrom(txn.TxnTaxDetail?.TotalTax);
  const totalAmt = numberFrom(txn.TotalAmt);
  if (totalTax === 0 && totalAmt === 0) return null;
  const sign = entity.negate ? -1 : 1;
  const net = totalAmt - totalTax;
  return vatRow({
    date: txn.TxnDate,
    type: entity.type,
    party: txn.CustomerRef?.name ?? txn.VendorRef?.name ?? txn.EntityRef?.name ?? entity.name,
    description: `${entity.name} ${txn.DocNumber ?? txn.Id ?? ""}`.trim(),
    net: sign * net,
    vat: sign * totalTax,
    gross: sign * totalAmt,
    taxCode: txn.TxnTaxDetail?.TaxLine?.[0]?.TaxLineDetail?.TaxRateRef?.name ?? "",
    reference: String(txn.DocNumber ?? txn.Id ?? ""),
    source: "QuickBooks",
  });
}

// ── Orchestration ────────────────────────────────────────────────────────────
export async function fetchQuickBooksSyncData(
  auth: { accessToken: string; realmId: string; baseUrl: string },
  asOfDate: string,
  vatPeriod?: { start: string; end: string },
): Promise<AccountingSyncData> {
  const { accessToken, realmId, baseUrl } = auth;
  const warnings: string[] = [];
  // Calendar-year-to-date window (QBO fiscal-year detection is a follow-up).
  const periodStart = `${asOfDate.slice(0, 4)}-01-01`;
  const vatPeriodStart = vatPeriod?.start || periodStart;
  const vatPeriodEnd = vatPeriod?.end || asOfDate;

  const report = (name: string, query = "") => quickbooksFetch<QboReport>(baseUrl, accessToken, `/v3/company/${realmId}/reports/${name}?${query}minorversion=70`);
  const safe = async <T>(label: string, fallback: T, run: () => Promise<T>): Promise<T> => {
    try { return await run(); } catch (error) { warnings.push(`${label}: ${describeQuickBooksError(error)}`); return fallback; }
  };

  const [profitLossRows, balanceSheetRows, trialBalanceRows, agedDebtorRows, agedCreditorRows] = await runWithConcurrency<Row[]>(5, [
    () => safe("profit & loss", [], async () => flattenQboProfitAndLoss(await report("ProfitAndLoss", `start_date=${periodStart}&end_date=${asOfDate}&`))),
    () => safe("balance sheet", [], async () => flattenQboBalanceSheet(await report("BalanceSheet", `end_date=${asOfDate}&`))),
    () => safe("trial balance", [], async () => flattenQboTrialBalance(await report("TrialBalance", `start_date=${periodStart}&end_date=${asOfDate}&`))),
    () => safe("aged debtors", [], async () => flattenQboAged(await report("AgedReceivables", `report_date=${asOfDate}&`), "customer_name")),
    () => safe("aged creditors", [], async () => flattenQboAged(await report("AgedPayables", `report_date=${asOfDate}&`), "supplier_name")),
  ]);

  const bankReconRows = bankRowsFromBalanceSheet(balanceSheetRows);

  // VAT evidence — tax-coded transactions within the VAT return period.
  const vatRows: Row[] = [];
  let transactionCount = 0;
  await Promise.all(VAT_ENTITIES.map((entity) => safe(`vat ${entity.name.toLowerCase()}`, undefined, async () => {
    const items = await queryEntity(baseUrl, accessToken, realmId, entity.name, vatPeriodStart, vatPeriodEnd);
    transactionCount += items.length;
    for (const txn of items) {
      const row = txnVatRow(txn, entity);
      if (row) vatRows.push(row);
    }
  })));
  const hasUsableVat = vatRows.some((row) => Math.abs(numberFrom(row.net_amount)) > 0 || Math.abs(numberFrom(row.vat_amount)) > 0);
  if (transactionCount > 0 && !hasUsableVat) {
    warnings.push("vat evidence: QuickBooks returned transactions but none carried tax amounts. VAT Assurance needs tax-coded sales/purchases in the period.");
  }

  return {
    trialBalanceRows,
    profitLossRows,
    priorProfitLossRows: [],
    balanceSheetRows,
    agedDebtorRows,
    agedCreditorRows,
    bankReconRows,
    vatRows,
    counts: {
      trialBalance: trialBalanceRows.length,
      profitLoss: profitLossRows.length,
      balanceSheet: balanceSheetRows.length,
      agedDebtors: agedDebtorRows.length,
      agedCreditors: agedCreditorRows.length,
      transactions: transactionCount,
      vatRows: vatRows.length,
    },
    warnings,
    periodStart,
    vatPeriodStart,
    vatPeriodEnd,
  };
}
