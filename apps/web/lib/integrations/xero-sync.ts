import type { XeroClient, Invoice, BankTransaction, ManualJournal } from "xero-node";
import { describeXeroError } from "./xero";

export type XeroSyncData = {
  trialBalanceRows: Record<string, string>[];
  profitLossRows: Record<string, string>[];
  balanceSheetRows: Record<string, string>[];
  vatRows: Record<string, string>[];
  counts: { trialBalance: number; profitLoss: number; balanceSheet: number; invoices: number; bankTransactions: number; manualJournals: number; vatRows: number };
  // Per-source failures. Populated when one report/endpoint fails but others
  // succeed, so a single broken source degrades gracefully instead of failing
  // the whole sync (each source below is fetched independently).
  warnings: string[];
};

export async function fetchXeroSyncData(xero: XeroClient, xeroTenantId: string, asOfDate: string, modifiedSince?: Date): Promise<XeroSyncData> {
  const plFromDate = `${asOfDate.slice(0, 4)}-01-01`;
  const warnings: string[] = [];
  // Each source is fetched (and parsed) independently: one failing report or
  // endpoint records a warning and yields an empty result instead of rejecting
  // the whole Promise.all and losing every other source.
  const safe = async <T>(label: string, fallback: T, run: () => Promise<T>): Promise<T> => {
    try {
      return await run();
    } catch (error) {
      warnings.push(`${label}: ${describeXeroError(error)}`);
      return fallback;
    }
  };

  const [trialBalanceRows, profitLossRows, balanceSheetRows, invoices, bankTransactions, manualJournals] = await Promise.all([
    safe("trial balance", [] as Record<string, string>[], async () =>
      flattenTrialBalance((await xero.accountingApi.getReportTrialBalance(xeroTenantId, asOfDate, false)).body.reports?.[0]?.rows ?? [])),
    safe("profit & loss", [] as Record<string, string>[], async () =>
      flattenProfitAndLoss((await xero.accountingApi.getReportProfitAndLoss(xeroTenantId, plFromDate, asOfDate)).body.reports?.[0]?.rows ?? [])),
    safe("balance sheet", [] as Record<string, string>[], async () =>
      flattenBalanceSheet((await xero.accountingApi.getReportBalanceSheet(xeroTenantId, asOfDate)).body.reports?.[0]?.rows ?? [])),
    safe("invoices", [] as Invoice[], () => fetchAllPages(100, (page) => xero.accountingApi.getInvoices(xeroTenantId, modifiedSince, undefined, "Date ASC", undefined, undefined, undefined, ["AUTHORISED", "PAID"], page, false, false, 4, false, 100), (body) => body.invoices ?? [])),
    safe("bank transactions", [] as BankTransaction[], () => fetchAllPages(100, (page) => xero.accountingApi.getBankTransactions(xeroTenantId, modifiedSince, undefined, "Date ASC", page, 4, 100), (body) => body.bankTransactions ?? [])),
    safe("manual journals", [] as ManualJournal[], () => fetchAllPages(100, (page) => xero.accountingApi.getManualJournals(xeroTenantId, modifiedSince, undefined, "Date ASC", page, 100), (body) => body.manualJournals ?? [])),
  ]);

  const invoiceRows = invoices.flatMap((invoice) => (invoice.lineItems ?? []).map((line, index) => vatRow({
    date: invoice.date,
    type: String(invoice.type).startsWith("ACCREC") ? "Sale" : "Purchase",
    party: invoice.contact?.name,
    description: line.description || invoice.reference || invoice.invoiceNumber || "Xero invoice line",
    net: line.lineAmount,
    vat: line.taxAmount,
    gross: number(line.lineAmount) + number(line.taxAmount),
    taxType: line.taxType,
    accountCode: line.accountCode,
    reference: invoice.invoiceNumber || invoice.invoiceID || `invoice-${index + 1}`,
  })));
  const bankRows = bankTransactions.flatMap((transaction) => (transaction.lineItems ?? []).map((line, index) => vatRow({
    date: transaction.date,
    type: String(transaction.type).startsWith("RECEIVE") ? "Sale" : "Purchase",
    party: transaction.contact?.name,
    description: line.description || transaction.reference || "Xero bank transaction",
    net: line.lineAmount,
    vat: line.taxAmount,
    gross: number(line.lineAmount) + number(line.taxAmount),
    taxType: line.taxType,
    accountCode: line.accountCode,
    reference: transaction.reference || transaction.bankTransactionID || `bank-${index + 1}`,
  })));
  const journalRows = manualJournals.flatMap((journal) => (journal.journalLines ?? []).filter((line) => number(line.taxAmount) !== 0 || /vat|tax/i.test(`${journal.narration} ${line.description ?? ""}`)).map((line, index) => vatRow({
    date: journal.date,
    type: "Adjustment",
    party: "Manual Journal",
    description: `Manual journal: ${journal.narration}${line.description ? ` — ${line.description}` : ""}`,
    net: line.lineAmount,
    vat: line.taxAmount,
    gross: number(line.lineAmount) + number(line.taxAmount),
    taxType: line.taxType,
    accountCode: line.accountCode,
    reference: journal.manualJournalID || `journal-${index + 1}`,
  })));

  const vatRows = [...invoiceRows, ...bankRows, ...journalRows];
  return {
    trialBalanceRows,
    profitLossRows,
    balanceSheetRows,
    vatRows,
    counts: { trialBalance: trialBalanceRows.length, profitLoss: profitLossRows.length, balanceSheet: balanceSheetRows.length, invoices: invoices.length, bankTransactions: bankTransactions.length, manualJournals: manualJournals.length, vatRows: vatRows.length },
    warnings,
  };
}

async function fetchAllPages<TBody, TItem>(pageSize: number, request: (page: number) => Promise<{ body: TBody }>, items: (body: TBody) => TItem[]) {
  const result: TItem[] = [];
  for (let page = 1; page <= 100; page += 1) {
    const response = await request(page);
    const batch = items(response.body);
    result.push(...batch);
    if (batch.length < pageSize) break;
  }
  return result;
}

function flattenTrialBalance(sections: Array<{ rows?: Array<{ cells?: Array<{ value?: string; attributes?: Array<{ id?: string; value?: string }> }> }> }>) {
  let rowNumber = 0;
  return sections.flatMap((section) => section.rows ?? []).map((row) => {
    rowNumber += 1;
    const cells = row.cells ?? [];
    const accountName = String(cells[0]?.value ?? "").trim();
    const accountCode = String(cells[0]?.attributes?.find((attribute) => /account|code/i.test(attribute.id ?? ""))?.value ?? `XERO-${rowNumber}`);
    const debit = amount(cells[1]?.value);
    const credit = amount(cells[2]?.value);
    return { account_code: accountCode, account_name: accountName, debit: String(debit), credit: String(credit), balance: String(debit - credit) };
  }).filter((row) => row.account_name && !/^total/i.test(row.account_name));
}

function flattenProfitAndLoss(sections: Array<{ title?: string; rows?: Array<{ cells?: Array<{ value?: string }> }> }>) {
  const out: Record<string, string>[] = [];
  for (const section of sections) {
    const category = String(section.title ?? "").trim() || "Profit & Loss";
    // Xero reports expense sections as positive values; ClosePilot's P&L format
    // expects income positive and costs/expenses negative.
    const isExpense = /cost|expense|overhead|operating|purchase|payroll|depreciation|admin/i.test(category)
      && !/income|revenue|turnover|sales|other income/i.test(category);
    for (const row of section.rows ?? []) {
      const cells = row.cells ?? [];
      const description = String(cells[0]?.value ?? "").trim();
      if (!description || /^total/i.test(description)) continue;
      const raw = amount(cells[cells.length - 1]?.value);
      out.push({ category, description, amount: String(isExpense ? -Math.abs(raw) : raw) });
    }
  }
  return out;
}

function flattenBalanceSheet(sections: Array<{ title?: string; rows?: Array<{ cells?: Array<{ value?: string }> }> }>) {
  const out: Record<string, string>[] = [];
  for (const section of sections) {
    const category = String(section.title ?? "").trim() || "Balance Sheet";
    for (const row of section.rows ?? []) {
      const cells = row.cells ?? [];
      const item = String(cells[0]?.value ?? "").trim();
      // Skip subtotal/total rows so the analysis isn't double-counted.
      if (!item || /^total/i.test(item)) continue;
      out.push({ category, item, amount: String(amount(cells[cells.length - 1]?.value)) });
    }
  }
  return out;
}

function vatRow(input: { date?: unknown; type: string; party?: string; description: string; net?: number; vat?: number; gross?: number; taxType?: string; accountCode?: string; reference: string }) {
  return {
    date: xeroDateString(input.date),
    type: input.type,
    party: String(input.party ?? ""),
    description: String(input.description ?? ""),
    net_amount: String(number(input.net)),
    vat_amount: String(number(input.vat)),
    gross_amount: String(number(input.gross)),
    vat_code: canonicalVatCode(input.taxType, input.type),
    nominal_code: String(input.accountCode ?? ""),
    reference: String(input.reference ?? ""),
    source_system: "Xero",
  };
}

// Xero (xero-node) returns date fields as Date objects even though typed as
// string; downstream analysis assumes every row value is a string, so coerce.
function xeroDateString(value: unknown): string {
  if (!value) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value);
}

export function canonicalVatCode(taxType: string | undefined, transactionType: string) {
  const code = (taxType ?? "").toUpperCase();
  if (/POSTPONED|IMPORTVAT|PVA/.test(code)) return "PVA";
  if (/REVERSE|ECINPUTSERVICES/.test(code)) return "RC";
  if (/ZERO/.test(code)) return "ZR";
  if (/EXEMPT/.test(code)) return "EXEMPT";
  if (/NONE|NOTAX|BASEXCLUDED/.test(code)) return "OOS";
  return transactionType === "Sale" ? "STD" : transactionType === "Purchase" ? "PSTD" : code;
}

function number(value: unknown) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0; }
function amount(value: string | undefined) { return number((value ?? "").replace(/[£,$()]/g, (character) => character === "(" ? "-" : "").replace(")", "")); }
