import type { XeroClient, Invoice, BankTransaction, ManualJournal, CreditNote, Journal } from "xero-node";
import { describeXeroError } from "./xero";

type BankAccountBalance = { account: string; closing: number };

export type XeroSyncData = {
  trialBalanceRows: Record<string, string>[];
  profitLossRows: Record<string, string>[];
  priorProfitLossRows: Record<string, string>[];
  balanceSheetRows: Record<string, string>[];
  agedDebtorRows: Record<string, string>[];
  agedCreditorRows: Record<string, string>[];
  bankReconRows: Record<string, string>[];
  vatRows: Record<string, string>[];
  counts: { trialBalance: number; profitLoss: number; balanceSheet: number; agedDebtors: number; agedCreditors: number; invoices: number; creditNotes: number; bankTransactions: number; manualJournals: number; journals: number; bankAccounts: number; vatRows: number };
  // Per-source failures. Populated when one report/endpoint fails but others
  // succeed, so a single broken source degrades gracefully instead of failing
  // the whole sync (each source below is fetched independently).
  warnings: string[];
  // The accounting-period start used (from the org's financial-year settings).
  periodStart: string;
  // The effective VAT return period the VAT rows were scoped to (defaults to the
  // accounting period when no explicit VAT quarter was chosen).
  vatPeriodStart: string;
  vatPeriodEnd: string;
};

export async function fetchXeroSyncData(xero: XeroClient, xeroTenantId: string, asOfDate: string, modifiedSince?: Date, vatPeriod?: { start: string; end: string }): Promise<XeroSyncData> {
  const warnings: string[] = [];
  // Use the company's real accounting-period start from Xero's financial-year
  // settings (not an assumed 1 January), so P&L and tax cover the correct period
  // for any year-end. Falls back to 1 January if the settings are unavailable.
  let periodStart = `${asOfDate.slice(0, 4)}-01-01`;
  try {
    const org = (await xero.accountingApi.getOrganisations(xeroTenantId)).body.organisations?.[0];
    if (org?.financialYearEndMonth && org?.financialYearEndDay) {
      periodStart = financialYearStart(asOfDate, Number(org.financialYearEndMonth), Number(org.financialYearEndDay));
    }
  } catch (error) {
    warnings.push(`financial year: ${describeXeroError(error)}`);
  }
  const plFromDate = periodStart;
  // Prior-period comparatives: the same window one year earlier.
  const priorFromDate = shiftYear(periodStart, -1);
  const priorToDate = shiftYear(asOfDate, -1);
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

  // Xero caps a tenant at 5 concurrent requests (429 with
  // x-rate-limit-problem: concurrent beyond that). Fetch the six sources through
  // a small pool so we never exceed the limit — firing all six at once was
  // getting invoices rejected while the rest slipped through.
  const [trialBalanceRows, profitLossRows, priorProfitLossRows, balanceSheetRows, invoices, creditNotes, bankTransactions, manualJournals, journals, bankSummary] = await runWithConcurrency<Record<string, string>[] | Invoice[] | CreditNote[] | BankTransaction[] | ManualJournal[] | Journal[] | BankAccountBalance[]>(4, [
    () => safe("trial balance", [] as Record<string, string>[], async () =>
      flattenTrialBalance((await xero.accountingApi.getReportTrialBalance(xeroTenantId, asOfDate, false)).body.reports?.[0]?.rows ?? [])),
    () => safe("profit & loss", [] as Record<string, string>[], async () =>
      flattenProfitAndLoss((await xero.accountingApi.getReportProfitAndLoss(xeroTenantId, plFromDate, asOfDate)).body.reports?.[0]?.rows ?? [])),
    // Prior-period P&L for comparatives (a separate fetch keeps the current P&L
    // parse — and its Cost-of-Sales sign fix — untouched).
    () => safe("prior profit & loss", [] as Record<string, string>[], async () =>
      flattenProfitAndLoss((await xero.accountingApi.getReportProfitAndLoss(xeroTenantId, priorFromDate, priorToDate)).body.reports?.[0]?.rows ?? [])),
    () => safe("balance sheet", [] as Record<string, string>[], async () =>
      flattenBalanceSheet((await xero.accountingApi.getReportBalanceSheet(xeroTenantId, asOfDate)).body.reports?.[0]?.rows ?? [])),
    () => safe("invoices", [] as Invoice[], () => fetchAllPages(100, (page) => xero.accountingApi.getInvoices(xeroTenantId, modifiedSince, undefined, "Date ASC", undefined, undefined, undefined, ["AUTHORISED", "PAID"], page, false, false, 4, false, 100), (body) => body.invoices ?? [])),
    // Credit notes are read under accounting.invoices.read (already granted) — no
    // extra scope. Fetched unfiltered and narrowed to AUTHORISED/PAID in code.
    () => safe("credit notes", [] as CreditNote[], () => fetchAllPages(100, (page) => xero.accountingApi.getCreditNotes(xeroTenantId, modifiedSince, undefined, "Date ASC", page, 4, 100), (body) => body.creditNotes ?? [])),
    () => safe("bank transactions", [] as BankTransaction[], () => fetchAllPages(100, (page) => xero.accountingApi.getBankTransactions(xeroTenantId, modifiedSince, undefined, "Date ASC", page, 4, 100), (body) => body.bankTransactions ?? [])),
    () => safe("manual journals", [] as ManualJournal[], () => fetchAllPages(100, (page) => xero.accountingApi.getManualJournals(xeroTenantId, modifiedSince, undefined, "Date ASC", page, 100), (body) => body.manualJournals ?? [])),
    () => safe("journals", [] as Journal[], () => fetchAllJournals(xero, xeroTenantId, modifiedSince, plFromDate, asOfDate)),
    // Bank Summary needs accounting.reports.banksummary.read (granted on reconnect).
    () => safe("bank summary", [] as BankAccountBalance[], async () =>
      flattenBankSummary((await xero.accountingApi.getReportBankSummary(xeroTenantId, plFromDate, asOfDate)).body.reports?.[0]?.rows ?? [])),
  ]) as [Record<string, string>[], Record<string, string>[], Record<string, string>[], Record<string, string>[], Invoice[], CreditNote[], BankTransaction[], ManualJournal[], Journal[], BankAccountBalance[]];

  const paidOrAuthorised = (status: unknown) => { const s = String(status).toUpperCase(); return s === "AUTHORISED" || s === "PAID"; };
  const authorisedCreditNotes = creditNotes.filter((note) => paidOrAuthorised(note.status));

  // Scope VAT evidence to the VAT return period — an explicit VAT quarter when
  // one was chosen, otherwise the accounting period under review (the window the
  // P&L/accounts use) — so Box 6/7 reflect that period's sales/purchases rather
  // than every invoice Xero holds. The fetches stay unfiltered because aged
  // debtors/creditors need all outstanding invoices regardless of date; only the
  // VAT-row derivation is scoped, by each transaction's tax point (its date).
  // Undated rows are kept so no VAT evidence is silently dropped.
  const vatPeriodStart = vatPeriod?.start || periodStart;
  const vatPeriodEnd = vatPeriod?.end || asOfDate;
  const withinVatPeriod = (value: unknown) => {
    const date = xeroDateString(value);
    return !date || (date >= vatPeriodStart && date <= vatPeriodEnd);
  };

  const invoiceRows = invoices.filter((invoice) => withinVatPeriod(invoice.date)).flatMap((invoice) => (invoice.lineItems ?? []).map((line, index) => vatRow({
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
  const bankRows = bankTransactions.filter((transaction) => withinVatPeriod(transaction.date)).flatMap((transaction) => (transaction.lineItems ?? []).map((line, index) => vatRow({
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
  const manualJournalRows = manualJournals.filter((journal) => withinVatPeriod(journal.date)).flatMap((journal) => (journal.journalLines ?? []).filter((line) => number(line.taxAmount) !== 0 || /vat|tax/i.test(`${journal.narration} ${line.description ?? ""}`)).map((line, index) => vatRow({
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
  const postedJournalRows = journals.filter((journal) => withinVatPeriod(journal.journalDate)).flatMap((journal) => (journal.journalLines ?? [])
    .filter((line) => number(line.taxAmount) !== 0 || line.taxType)
    .map((line, index) => vatRow({
      date: journal.journalDate,
      type: journalVatType(journal),
      party: String(journal.sourceType ?? "Xero journal"),
      description: line.description || line.accountName || journal.reference || "Xero posted journal line",
      net: line.netAmount,
      vat: line.taxAmount,
      gross: line.grossAmount ?? number(line.netAmount) + number(line.taxAmount),
      taxType: line.taxType,
      accountCode: line.accountCode,
      reference: journal.sourceID || journal.journalID || (journal.journalNumber ? `journal-${journal.journalNumber}-${index + 1}` : `journal-${index + 1}`),
    })));

  // Credit notes reverse the supply they relate to: a sales credit note reduces
  // output VAT, a purchase credit note reduces input VAT. Emit each line negated
  // (Xero returns credit-note amounts positive) with the same tax code, so the
  // VAT rows sum to the net position that reconciles to the VAT control account.
  const creditNoteRows = authorisedCreditNotes.filter((note) => withinVatPeriod(note.date)).flatMap((note) => (note.lineItems ?? []).map((line, index) => vatRow({
    date: note.date,
    type: String(note.type).startsWith("ACCREC") ? "Sale" : "Purchase",
    party: note.contact?.name,
    description: `Credit note: ${line.description || note.creditNoteNumber || "Xero credit note"}`,
    net: -number(line.lineAmount),
    vat: -number(line.taxAmount),
    gross: -(number(line.lineAmount) + number(line.taxAmount)),
    taxType: line.taxType,
    accountCode: line.accountCode,
    reference: note.creditNoteNumber || note.creditNoteID || `credit-${index + 1}`,
  })));

  // Aged debtors/creditors are the outstanding (amountDue > 0) sales/purchase
  // invoices, netted down by any unallocated credit (remainingCredit) — exactly
  // as the debtors/creditors control accounts are — so the aging ties to the TB.
  const agedDebtorRows = [
    ...invoices.filter((invoice) => String(invoice.type).startsWith("ACCREC") && number(invoice.amountDue) > 0).map((invoice) => agedRow(invoice, "customer_name", asOfDate)),
    ...authorisedCreditNotes.filter((note) => String(note.type).startsWith("ACCREC") && number(note.remainingCredit) > 0).map((note) => agedCreditNoteRow(note, "customer_name", asOfDate)),
  ];
  const agedCreditorRows = [
    ...invoices.filter((invoice) => String(invoice.type).startsWith("ACCPAY") && number(invoice.amountDue) > 0).map((invoice) => agedRow(invoice, "supplier_name", asOfDate)),
    ...authorisedCreditNotes.filter((note) => String(note.type).startsWith("ACCPAY") && number(note.remainingCredit) > 0).map((note) => agedCreditNoteRow(note, "supplier_name", asOfDate)),
  ];

  // Bank reconciliation: per-account closing balance (from Bank Summary) plus the
  // count/value of unreconciled transactions in Xero. Xero's API does not expose
  // the bank *statement* itself, so this is a cash-position + unreconciled-items
  // review, not a statement tie-out — the closing balance ties to the TB bank.
  const unreconciled = new Map<string, { count: number; amount: number }>();
  for (const transaction of bankTransactions) {
    if (transaction.isReconciled === false) {
      const name = String(transaction.bankAccount?.name ?? "Bank account");
      const entry = unreconciled.get(name) ?? { count: 0, amount: 0 };
      entry.count += 1;
      entry.amount += Math.abs(number(transaction.total));
      unreconciled.set(name, entry);
    }
  }
  const bankReconRows = bankSummary.map((account) => {
    const items = unreconciled.get(account.account) ?? { count: 0, amount: 0 };
    return {
      account: account.account,
      closing_balance: String(account.closing),
      unreconciled_count: String(items.count),
      unreconciled_amount: String(items.amount),
      status: items.count > 0 ? `${items.count} unreconciled item(s)` : "reconciled",
    };
  });

  const hasUsableVat = (rows: Record<string, string>[]) => rows.some((row) => Math.abs(number(row.net_amount)) > 0 || Math.abs(number(row.vat_amount)) > 0);
  const sourceVatRows = [...invoiceRows, ...bankRows, ...manualJournalRows, ...creditNoteRows];
  // Prefer whichever evidence set actually carries VAT amounts. Falling back to
  // posted journals only when the source rows were *absent* missed the case
  // where they are present but amount-less, which left VAT Assurance empty
  // ("VAT report present; no usable VAT rows") despite a synced VAT file.
  const vatRows = hasUsableVat(sourceVatRows)
    ? sourceVatRows
    : hasUsableVat(postedJournalRows)
      ? postedJournalRows
      : (sourceVatRows.length ? sourceVatRows : postedJournalRows);
  if (!hasUsableVat(sourceVatRows) && hasUsableVat(postedJournalRows)) {
    warnings.push(`vat evidence: used ${postedJournalRows.length} posted Xero journal line(s) because source transaction VAT lines ${sourceVatRows.length ? "carried no amounts" : "were unavailable"}.`);
  }
  // Diagnostic: a "present" VAT file that carries no net/VAT amounts. Names the
  // source counts so an empty VAT Assurance can be traced without the raw rows.
  if (vatRows.length && !hasUsableVat(vatRows)) {
    warnings.push(`vat evidence unusable: ${vatRows.length} VAT row(s) but none carry a net/VAT amount. Sources — invoices ${invoiceRows.length}, bank ${bankRows.length}, manual journals ${manualJournalRows.length}, credit notes ${creditNoteRows.length}, posted journals ${postedJournalRows.length}; records — invoices ${invoices.length}, bankTx ${bankTransactions.length}, manualJournals ${manualJournals.length}, creditNotes ${authorisedCreditNotes.length}, journals ${journals.length}.`);
  }
  if (!vatRows.length && (invoices.length || bankTransactions.length || manualJournals.length || authorisedCreditNotes.length || journals.length)) {
    warnings.push("vat evidence: Xero returned source records but no VAT/tax line rows. VAT Assurance needs invoice, bill, bank transaction, credit note or manual journal lines with tax amounts.");
  }
  return {
    trialBalanceRows,
    profitLossRows,
    priorProfitLossRows,
    balanceSheetRows,
    agedDebtorRows,
    agedCreditorRows,
    bankReconRows,
    vatRows,
    counts: { trialBalance: trialBalanceRows.length, profitLoss: profitLossRows.length, balanceSheet: balanceSheetRows.length, agedDebtors: agedDebtorRows.length, agedCreditors: agedCreditorRows.length, invoices: invoices.length, creditNotes: authorisedCreditNotes.length, bankTransactions: bankTransactions.length, manualJournals: manualJournals.length, journals: journals.length, bankAccounts: bankReconRows.length, vatRows: vatRows.length },
    warnings,
    periodStart,
    vatPeriodStart,
    vatPeriodEnd,
  };
}

// The financial-year start containing asOfDate, from the org's FY-end day/month:
// the day after the FY end that precedes asOfDate.
function financialYearStart(asOfDate: string, endMonth: number, endDay: number): string {
  const asOf = Date.parse(asOfDate);
  const year = Number(asOfDate.slice(0, 4));
  const endThisYear = Date.UTC(year, endMonth - 1, endDay);
  const precedingEnd = endThisYear < asOf ? endThisYear : Date.UTC(year - 1, endMonth - 1, endDay);
  const start = new Date(precedingEnd);
  start.setUTCDate(start.getUTCDate() + 1);
  return start.toISOString().slice(0, 10);
}

// Shift an ISO date by whole years, preserving month/day.
function shiftYear(date: string, delta: number): string {
  return `${Number(date.slice(0, 4)) + delta}${date.slice(4)}`;
}

// One outstanding invoice → an aged debtor/creditor line. Headers match the
// analyzer's column-detection keys so it maps them without a manual mapping.
function agedRow(invoice: Invoice, nameKey: "customer_name" | "supplier_name", asOfDate: string) {
  const dueDate = xeroDateString(invoice.dueDate);
  const daysOverdue = dueDate ? Math.max(0, Math.floor((Date.parse(asOfDate) - Date.parse(dueDate)) / 86_400_000)) : 0;
  return {
    [nameKey]: String(invoice.contact?.name ?? ""),
    invoice_number: String(invoice.invoiceNumber ?? invoice.invoiceID ?? ""),
    invoice_date: xeroDateString(invoice.date),
    due_date: dueDate,
    days_overdue: String(daysOverdue),
    amount: String(number(invoice.amountDue)),
    status: String(invoice.status ?? ""),
  };
}

// An unallocated credit note → a negative aged line (it reduces the customer's/
// supplier's balance). Aged by its own date; amount is negated remainingCredit.
function agedCreditNoteRow(note: CreditNote, nameKey: "customer_name" | "supplier_name", asOfDate: string) {
  const noteDate = xeroDateString(note.date);
  const daysOverdue = noteDate ? Math.max(0, Math.floor((Date.parse(asOfDate) - Date.parse(noteDate)) / 86_400_000)) : 0;
  return {
    [nameKey]: String(note.contact?.name ?? ""),
    invoice_number: String(note.creditNoteNumber ?? note.creditNoteID ?? ""),
    invoice_date: noteDate,
    due_date: noteDate,
    days_overdue: String(daysOverdue),
    amount: String(-number(note.remainingCredit)),
    status: String(note.status ?? ""),
  };
}

// Run tasks with at most `limit` in flight, preserving input order in the
// result. Keeps concurrent Xero calls under the tenant's 5-request ceiling.
async function runWithConcurrency<T>(limit: number, tasks: Array<() => Promise<T>>): Promise<T[]> {
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

async function fetchAllJournals(xero: XeroClient, xeroTenantId: string, modifiedSince: Date | undefined, fromDate: string, toDate: string) {
  const result: Journal[] = [];
  let offset: number | undefined;
  for (let page = 1; page <= 100; page += 1) {
    const response = await xero.accountingApi.getJournals(xeroTenantId, modifiedSince, offset, false);
    const batch = response.body.journals ?? [];
    const inPeriod = batch.filter((journal) => {
      const date = xeroDateString(journal.journalDate);
      return date >= fromDate && date <= toDate;
    });
    result.push(...inPeriod);
    const lastJournalNumber = batch.reduce((max, journal) => Math.max(max, number(journal.journalNumber)), offset ?? 0);
    if (!batch.length || lastJournalNumber <= (offset ?? 0)) break;
    offset = lastJournalNumber;
  }
  return result;
}

function journalVatType(journal: Journal) {
  const sourceType = String(journal.sourceType ?? "").toUpperCase();
  if (/ACCREC|CASHREC|AR/.test(sourceType)) return "Sale";
  if (/ACCPAY|CASHPAID|AP|EXPCLAIM/.test(sourceType)) return "Purchase";
  return "Adjustment";
}

function flattenTrialBalance(sections: Array<{ rows?: Array<{ cells?: Array<{ value?: string; attributes?: Array<{ id?: string; value?: string }> }> }> }>) {
  let rowNumber = 0;
  return sections.flatMap((section) => section.rows ?? []).map((row) => {
    rowNumber += 1;
    const cells = row.cells ?? [];
    const accountName = String(cells[0]?.value ?? "").trim();
    const accountCode = String(cells[0]?.attributes?.find((attribute) => /account|code/i.test(attribute.id ?? ""))?.value ?? `XERO-${rowNumber}`);
    // Xero's TB report is [Account, Debit, Credit, YTD Debit, YTD Credit]; the
    // closing balance is the YTD pair, not the period movement in cols 1-2. Using
    // the last two cells reads YTD when present and still works for a 3-column TB.
    const debit = amount(cells[cells.length - 2]?.value);
    const credit = amount(cells[cells.length - 1]?.value);
    return { account_code: accountCode, account_name: accountName, debit: String(debit), credit: String(credit), balance: String(debit - credit) };
  }).filter((row) => row.account_name && !/^total/i.test(row.account_name));
}

function flattenProfitAndLoss(sections: Array<{ title?: string; rows?: Array<{ rowType?: unknown; cells?: Array<{ value?: string }> }> }>) {
  const out: Record<string, string>[] = [];
  for (const section of sections) {
    const category = String(section.title ?? "").trim() || "Profit & Loss";
    // ClosePilot's P&L format expects income positive and costs/expenses negative.
    // Xero reports every section as positive, so classify by section: income is
    // positive, everything else negative. "Cost of Sales" contains "sales" but is
    // a cost — match it explicitly and keep it out of the income test (otherwise
    // it was added as income, overstating profit by 2x its value).
    const isCostOfSales = /cost of (sales|goods)/i.test(category);
    const isIncome = !isCostOfSales && /income|revenue|turnover|sales|interest received/i.test(category);
    for (const row of section.rows ?? []) {
      // Skip Xero subtotal rows (Gross/Net/Operating Profit) so they aren't counted.
      if (String(row.rowType) === "SummaryRow") continue;
      const cells = row.cells ?? [];
      const description = String(cells[0]?.value ?? "").trim();
      if (!description || /^(total|gross profit|net profit|operating profit)/i.test(description)) continue;
      const raw = amount(cells[cells.length - 1]?.value);
      out.push({ category, description, amount: String(isIncome ? Math.abs(raw) : -Math.abs(raw)) });
    }
  }
  return out;
}

function flattenBalanceSheet(sections: Array<{ title?: string; rows?: Array<{ rowType?: unknown; cells?: Array<{ value?: string }> }> }>) {
  const out: Record<string, string>[] = [];
  for (const section of sections) {
    const category = String(section.title ?? "").trim() || "Balance Sheet";
    for (const row of section.rows ?? []) {
      // Skip Xero subtotal/total rows (RowType "SummaryRow", e.g. "Net Assets",
      // "Total …") — otherwise a summary line is double-counted and the balance
      // sheet equation looks unbalanced by exactly that subtotal.
      if (String(row.rowType) === "SummaryRow") continue;
      const cells = row.cells ?? [];
      const item = String(cells[0]?.value ?? "").trim();
      if (!item || /^(total|net assets|net current assets)\b/i.test(item)) continue;
      // Xero's BS report is [label, <this period>, <prior year>]; use the current
      // period (first value cell) as the amount and capture the prior-year cell
      // for comparatives (0 when the report has no comparison column).
      out.push({ category, item, amount: String(amount(cells[1]?.value)), prior_amount: String(amount(cells[2]?.value)) });
    }
  }
  return out;
}

// Bank Summary report → per-account closing balance (the last column). Subtotal/
// total and header rows are skipped so only real bank accounts remain.
function flattenBankSummary(sections: Array<{ rows?: Array<{ cells?: Array<{ value?: string }> }> }>): BankAccountBalance[] {
  const out: BankAccountBalance[] = [];
  for (const section of sections) {
    for (const row of section.rows ?? []) {
      const cells = row.cells ?? [];
      const account = String(cells[0]?.value ?? "").trim();
      if (!account || /^(total|bank account)$/i.test(account)) continue;
      out.push({ account, closing: amount(cells[cells.length - 1]?.value) });
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
