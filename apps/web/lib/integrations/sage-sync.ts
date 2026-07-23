// Sage Business Cloud Accounting sync. Sage exposes a trial-balance report and a
// classified chart of accounts (rather than QBO-style P&L/BS report JSON), so we
// derive the statements from those: the trial balance gives each account's
// period movement + closing balance, and the ledger-account classification tells
// us whether it's income/expense (P&L) or asset/liability/equity (balance sheet).
// Aged debtors/creditors and VAT come from outstanding/tax-coded invoices.
// Returns the provider-agnostic AccountingSyncData. Single-period (no prior year).

import { sageFetch, describeSageError } from "./sage";
import { type AccountingSyncData, numberFrom, vatRow, daysOverdue } from "./accounting-sync";

type Row = Record<string, string>;
type SageMoney = { debit?: number | string; credit?: number | string } | undefined;
type SageRef = { id?: string; displayed_as?: string } | undefined;
type SageLedgerAccount = { id?: string; displayed_as?: string; nominal_code?: string | number; ledger_account_classification?: SageRef; ledger_account_type?: SageRef };
type SageTbAccount = { id?: string; displayed_as?: string; nominal_code?: string | number; debit?: number | string; credit?: number | string; opening_balance?: SageMoney; closing_balance?: SageMoney };
type SageInvoice = { id?: string; displayed_as?: string; reference?: string; date?: string; due_date?: string; contact?: SageRef; total_net_amount?: number | string; total_tax_amount?: number | string; total_amount?: number | string; outstanding_amount?: number | string; status?: SageRef };
type SagePage<T> = { $items?: T[]; $next?: string | null; ledger_accounts?: T[] };

// ── Classification ───────────────────────────────────────────────────────────
type Klass = "income" | "cogs" | "expense" | "fixed" | "current" | "liability" | "equity";
function classify(text: string): Klass {
  const t = text.toLowerCase();
  if (/cost of (sales|goods)|cost_of_sales|direct (cost|expense)|\bpurchases?\b|opening stock|closing stock/.test(t)) return "cogs";
  if (/sales|revenue|turnover|\bincome\b|fees|grant/.test(t)) return "income";
  if (/overhead|administ|\bexpense|deprec|amortis|payroll|wages|salar|finance cost|\brent\b|rates|insurance|motor|travel|office|professional|interest paid|bank charge/.test(t)) return "expense";
  if (/fixed|tangible|intangible|non-?current asset|\bplant\b|equipment|machinery|vehicle|property|goodwill|freehold|leasehold|fixtures?|fittings?/.test(t)) return "fixed";
  if (/equity|\bcapital\b|reserve|retained|earnings|\bshares?\b/.test(t)) return "equity";
  if (/liabilit|creditor|payable|\bvat\b|\btax\b|paye|\bnic\b|loan|accrual|deferred/.test(t)) return "liability";
  if (/current asset|\bbank\b|\bcash\b|debtor|receivable|\bstock\b|inventor|prepay/.test(t)) return "current";
  return "current"; // unknown → current asset
}
const isPnl = (k: Klass) => k === "income" || k === "cogs" || k === "expense";
const PL_SECTION: Record<"income" | "cogs" | "expense", string> = { income: "Turnover", cogs: "Cost of Sales", expense: "Administrative expenses" };
const BS_SECTION: Record<"fixed" | "current" | "liability" | "equity", string> = { fixed: "Fixed assets", current: "Current assets", liability: "Creditors: amounts falling due within one year", equity: "Capital and reserves" };

const net = (money: SageMoney) => numberFrom(money?.debit) - numberFrom(money?.credit);

// ── Fetch helpers (paginated) ────────────────────────────────────────────────
async function fetchAll<T>(accessToken: string, businessId: string, path: string, maxPages = 15): Promise<T[]> {
  const items: T[] = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const sep = path.includes("?") ? "&" : "?";
    const body = await sageFetch<SagePage<T>>(accessToken, `${path}${sep}items_per_page=200&page=${page}`, businessId);
    const batch = body.$items ?? [];
    items.push(...batch);
    if (!body.$next || batch.length < 200) break;
  }
  return items;
}

// ── Statement derivation from trial balance + classification ─────────────────
export function deriveSageStatements(tbAccounts: SageTbAccount[], classByName: Map<string, string>) {
  const profitLoss: Row[] = [];
  const balanceSheet: Row[] = [];
  const trialBalance: Row[] = [];
  for (const account of tbAccounts) {
    const name = String(account.displayed_as ?? "").trim();
    if (!name) continue;
    const klass = classify(`${classByName.get(name) ?? ""} ${name}`);
    const periodMovement = numberFrom(account.credit) - numberFrom(account.debit); // income +, expense −
    const closing = account.closing_balance ? net(account.closing_balance) : (numberFrom(account.debit) - numberFrom(account.credit));

    // Trial balance row from the closing position.
    if (closing !== 0) {
      trialBalance.push({ account_code: String(account.nominal_code ?? ""), account_name: name, debit: String(closing > 0 ? closing : 0), credit: String(closing < 0 ? -closing : 0), balance: String(closing) });
    }
    if (isPnl(klass)) {
      if (periodMovement !== 0) profitLoss.push({ category: PL_SECTION[klass as "income" | "cogs" | "expense"], description: name, amount: String(periodMovement), prior_amount: "0" });
    } else {
      // Assets keep their debit balance; liabilities/equity carry credit balances
      // → flip to positive magnitudes so the sheet balances (assets = liab + eq).
      const amount = klass === "fixed" || klass === "current" ? closing : -closing;
      if (amount !== 0) balanceSheet.push({ category: BS_SECTION[klass as "fixed" | "current" | "liability" | "equity"], item: name, amount: String(amount), prior_amount: "0" });
    }
  }
  // The trial balance's reserves exclude the current-year result — add it so the
  // derived balance sheet balances (same as the upload-based TB derivation).
  const currentEarnings = profitLoss.reduce((total, r) => total + numberFrom(r.amount), 0);
  if (profitLoss.length && Math.abs(currentEarnings) > 0.005) {
    balanceSheet.push({ category: BS_SECTION.equity, item: "Profit for the financial year", amount: String(currentEarnings), prior_amount: "0" });
  }
  return { profitLoss, balanceSheet, trialBalance };
}

function agedRows(invoices: SageInvoice[], nameKey: "customer_name" | "supplier_name", asOfDate: string): Row[] {
  return invoices
    .filter((invoice) => numberFrom(invoice.outstanding_amount) > 0)
    .map((invoice) => ({
      [nameKey]: String(invoice.contact?.displayed_as ?? ""),
      invoice_number: String(invoice.reference ?? invoice.displayed_as ?? ""),
      invoice_date: String(invoice.date ?? ""),
      due_date: String(invoice.due_date ?? ""),
      days_overdue: String(daysOverdue(String(invoice.due_date ?? ""), asOfDate)),
      amount: String(numberFrom(invoice.outstanding_amount)),
      status: String(invoice.status?.displayed_as ?? ""),
    }));
}

function invoiceVatRows(invoices: SageInvoice[], type: "Sale" | "Purchase", vatStart: string, vatEnd: string): Row[] {
  return invoices
    .filter((invoice) => { const d = String(invoice.date ?? ""); return !d || (d >= vatStart && d <= vatEnd); })
    .filter((invoice) => numberFrom(invoice.total_tax_amount) !== 0 || numberFrom(invoice.total_amount) !== 0)
    .map((invoice) => vatRow({
      date: invoice.date, type, party: invoice.contact?.displayed_as,
      description: `${type === "Sale" ? "Sales" : "Purchase"} invoice ${invoice.reference ?? invoice.displayed_as ?? ""}`.trim(),
      net: invoice.total_net_amount, vat: invoice.total_tax_amount, gross: invoice.total_amount,
      reference: String(invoice.reference ?? invoice.id ?? ""), source: "Sage",
    }));
}

// ── Orchestration ────────────────────────────────────────────────────────────
export async function fetchSageSyncData(
  auth: { accessToken: string; businessId: string },
  asOfDate: string,
  vatPeriod?: { start: string; end: string },
): Promise<AccountingSyncData> {
  const { accessToken, businessId } = auth;
  const warnings: string[] = [];
  const periodStart = `${asOfDate.slice(0, 4)}-01-01`;
  const vatPeriodStart = vatPeriod?.start || periodStart;
  const vatPeriodEnd = vatPeriod?.end || asOfDate;
  const safe = async <T>(label: string, fallback: T, run: () => Promise<T>): Promise<T> => {
    try { return await run(); } catch (error) { warnings.push(`${label}: ${describeSageError(error)}`); return fallback; }
  };

  // Chart of accounts → classification by display name (used to type TB rows).
  const ledgerAccounts = await safe("ledger accounts", [] as SageLedgerAccount[], () => fetchAll<SageLedgerAccount>(accessToken, businessId, "/ledger_accounts"));
  const classByName = new Map<string, string>();
  for (const account of ledgerAccounts) {
    const name = String(account.displayed_as ?? "").trim();
    if (name) classByName.set(name, `${account.ledger_account_classification?.displayed_as ?? account.ledger_account_type?.displayed_as ?? ""}`);
  }

  const tb = await safe("trial balance", { profitLoss: [], balanceSheet: [], trialBalance: [] }, async () => {
    const report = await sageFetch<SagePage<SageTbAccount>>(accessToken, `/trial_balance?from_date=${periodStart}&to_date=${asOfDate}&items_per_page=200`, businessId);
    const accounts = report.ledger_accounts ?? report.$items ?? [];
    return deriveSageStatements(accounts, classByName);
  });

  const [salesInvoices, purchaseInvoices] = await Promise.all([
    safe("sales invoices", [] as SageInvoice[], () => fetchAll<SageInvoice>(accessToken, businessId, "/sales_invoices")),
    safe("purchase invoices", [] as SageInvoice[], () => fetchAll<SageInvoice>(accessToken, businessId, "/purchase_invoices")),
  ]);
  const agedDebtorRows = agedRows(salesInvoices, "customer_name", asOfDate);
  const agedCreditorRows = agedRows(purchaseInvoices, "supplier_name", asOfDate);
  const vatRows = [
    ...invoiceVatRows(salesInvoices, "Sale", vatPeriodStart, vatPeriodEnd),
    ...invoiceVatRows(purchaseInvoices, "Purchase", vatPeriodStart, vatPeriodEnd),
  ];

  // Bank rows from the balance sheet's bank/cash lines (Sage exposes no separate
  // bank-summary/statement report here).
  const bankReconRows = tb.balanceSheet
    .filter((row) => /\bbank\b|cash/i.test(row.item ?? ""))
    .map((row) => ({ account: row.item ?? "Bank", closing_balance: row.amount ?? "0", unreconciled_count: "0", unreconciled_amount: "0", status: "cash position (from trial balance)" }));

  return {
    trialBalanceRows: tb.trialBalance,
    profitLossRows: tb.profitLoss,
    priorProfitLossRows: [],
    balanceSheetRows: tb.balanceSheet,
    agedDebtorRows,
    agedCreditorRows,
    bankReconRows,
    vatRows,
    counts: {
      trialBalance: tb.trialBalance.length,
      profitLoss: tb.profitLoss.length,
      balanceSheet: tb.balanceSheet.length,
      agedDebtors: agedDebtorRows.length,
      agedCreditors: agedCreditorRows.length,
      vatRows: vatRows.length,
    },
    warnings,
    periodStart,
    vatPeriodStart,
    vatPeriodEnd,
  };
}
