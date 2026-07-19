// Adapter: assemble accounts-production `statements` from uploaded documents, so
// uploaded trial balance / P&L / balance sheet files produce the same
// management, financial (statutory) and CT600 packs as a Xero sync. It maps the
// parsed upload rows into the SyncStatements shape that buildManagementAccounts /
// buildStatutoryAccounts already consume (P&L: {category, description, amount};
// balance sheet: {category, item, amount}). Deterministic — no AI.
//
// Precedence: explicit profit_loss / balance_sheet files are authoritative; when
// one is absent, the corresponding statement is DERIVED from the trial balance by
// classifying each account from its name (best-effort — a well-named TB works
// well, but confirm before issuing). No prior-period column is produced, so the
// packs render single-period (hasComparatives = false).

import type { SyncStatements } from "./management-accounts";
import type { ParsedFile } from "./upload-analysis";

type Row = Record<string, string>;

// ── Row helpers (local, so this module stays decoupled from upload-analysis) ──
const NAME_KEYS = ["account_name", "account_description", "description", "item", "nominal", "gl_account", "ledger_account", "account", "narrative", "name", "line_item", "particulars"];
const CATEGORY_KEYS = ["category", "section", "group", "account_type", "type", "classification", "report_group", "heading", "sub_category"];
const PL_AMOUNT_KEYS = ["amount", "value", "net_amount", "net", "total", "this_period", "current_period", "current", "period_amount", "ytd", "balance"];
const BS_AMOUNT_KEYS = ["amount", "value", "balance", "closing_balance", "balance_at_date", "this_period", "current", "net", "total"];
const TB_BALANCE_KEYS = ["balance", "closing_balance", "balance_at_date", "net", "net_movement", "amount"];
const DEBIT_KEYS = ["debit", "debits", "dr", "debit_amount", "debit_ytd", "ytd_debit"];
const CREDIT_KEYS = ["credit", "credits", "cr", "credit_amount", "credit_ytd", "ytd_credit"];
const AGED_AMOUNT_KEYS = ["amount", "balance", "outstanding", "total", "total_outstanding", "due", "net_balance", "value"];
const AGED_DAYS_KEYS = ["days_overdue", "days_outstanding", "age", "age_days", "days", "overdue_days"];
const BANK_BALANCE_KEYS = ["closing_balance", "balance", "amount", "net"];
const DATE_KEYS = ["invoice_date", "date", "transaction_date", "posting_date", "doc_date", "entry_date", "as_at", "as_of", "period_end", "statement_date"];

const val = (row: Row, keys: string[]): string => {
  for (const k of keys) { const v = row[k]; if (v != null && String(v).trim()) return String(v).trim(); }
  return "";
};
const num = (raw: string): number => {
  if (!raw) return 0;
  const cleaned = raw.replace(/[£$,\s]/g, "").replace(/^\((.*)\)$/, "-$1");
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
};
const amt = (row: Row, keys: string[]): number => num(val(row, keys));
const str = (value: number) => String(Math.round(value * 100) / 100);

// A row that is a total/subtotal/computed line, not a postable account — skip it
// so the statement engine (which recomputes subtotals) does not double-count.
const isTotalRow = (name: string) =>
  /^(total|sub[\s-]?total|gross profit|net profit|operating profit|profit (before|for|after)|net (assets|current assets)|shareholders?[' ]?funds?|balance (b|c)\/?f|opening balance|closing balance)\b/i.test(name.trim());

// ── Classifiers ──────────────────────────────────────────────────────────────
const INCOME_RE = /income|revenue|turnover|\bsales\b|fees?\b|grant|other operating income/i;
const COGS_RE = /cost of (sales|goods)|\bcogs\b|direct cost|materials? (cost|used|consumed)|opening stock|closing stock|carriage in/i;
// Strong balance-sheet signals — used to keep TB balance-sheet accounts out of
// the P&L when deriving both from one trial balance.
const BS_RE = /debtor|receivable|prepay|\bstock\b|inventor|work in progress|\bwip\b|\bbank\b|cash|petty cash|creditor|payable|\bloan\b|borrowing|accrual|overdraft|provision|\bvat\b|paye|\bnic?\b|corporation tax|deferred|equity|\bcapital\b|reserve|retained|earnings|\bshares?\b|share (capital|premium)|goodwill|intangible|freehold|leasehold|fixed asset|non-?current|tangible|\bfixtures?\b|fittings?|motor vehicle|\bplant\b|machinery|property|equipment|investment/i;

function plBucket(text: string): "income" | "cogs" | "expense" {
  if (COGS_RE.test(text)) return "cogs";
  if (INCOME_RE.test(text)) return "income";
  return "expense";
}
function bsBucket(text: string): "fixed" | "current" | "liability" | "equity" {
  if (/equity|\bcapital\b|reserve|retained|earnings|\bshares?\b|share (capital|premium)/i.test(text)) return "equity";
  if (/liabilit|creditor|payable|\bloan\b|borrowing|accrual|overdraft|provision|deferred|\bvat\b|paye|corporation tax/i.test(text)) return "liability";
  if (/fixed asset|non-?current|tangible|intangible|property|\bplant\b|machinery|motor vehicle|\bfixtures?\b|fittings?|goodwill|freehold|leasehold|equipment|computer|investment/i.test(text)) return "fixed";
  return "current";
}
const PL_SECTION = { income: "Turnover", cogs: "Cost of Sales", expense: "Administrative expenses" } as const;
const BS_SECTION = { fixed: "Fixed assets", current: "Current assets", liability: "Creditors: amounts falling due within one year", equity: "Capital and reserves" } as const;

// ── P&L / BS from explicit uploaded files ────────────────────────────────────
function mapProfitAndLoss(rows: Row[]): Row[] {
  const out: Row[] = [];
  for (const r of rows) {
    const name = val(r, NAME_KEYS) || val(r, CATEGORY_KEYS);
    if (!name || isTotalRow(name)) continue;
    const raw = amt(r, PL_AMOUNT_KEYS);
    if (raw === 0) continue;
    const bucket = plBucket(`${val(r, CATEGORY_KEYS)} ${name}`);
    // Sign by classification: income positive, cost of sales and overheads
    // negative — the convention buildProfitAndLoss expects.
    const amount = bucket === "income" ? Math.abs(raw) : -Math.abs(raw);
    out.push({ category: PL_SECTION[bucket], description: name, amount: str(amount), prior_amount: "0" });
  }
  return out;
}
function mapBalanceSheet(rows: Row[]): Row[] {
  const out: Row[] = [];
  for (const r of rows) {
    const name = val(r, NAME_KEYS);
    if (!name || isTotalRow(name)) continue;
    const raw = amt(r, BS_AMOUNT_KEYS);
    if (raw === 0) continue;
    const bucket = bsBucket(`${val(r, CATEGORY_KEYS)} ${name}`);
    out.push({ category: BS_SECTION[bucket], item: name, amount: str(raw), prior_amount: "0" });
  }
  return out;
}

// ── P&L + BS derived from a single trial balance (fallback) ──────────────────
function tbBalance(r: Row): number {
  const balance = val(r, TB_BALANCE_KEYS);
  if (balance) return num(balance);
  return amt(r, DEBIT_KEYS) - amt(r, CREDIT_KEYS);
}
function deriveFromTrialBalance(rows: Row[]): { pl: Row[]; bs: Row[] } {
  const pl: Row[] = [];
  const bs: Row[] = [];
  for (const r of rows) {
    const name = val(r, NAME_KEYS);
    if (!name || isTotalRow(name)) continue;
    const balance = tbBalance(r);
    if (balance === 0) continue;
    const text = `${val(r, CATEGORY_KEYS)} ${name}`;
    // Unknown accounts default to the balance sheet, so the P&L only picks up
    // clear income/expense accounts.
    const isPnl = !BS_RE.test(text) && (INCOME_RE.test(text) || COGS_RE.test(text) || /expense|cost|purchase|wages|salar|payroll|staff|rent|rates|insurance|deprec|amortis|utilit|electric|\bgas\b|water|telephone|phone|broadband|marketing|advertis|travel|subsistence|office|stationery|postage|professional|legal|account(anc|ing)|audit|bank charge|interest|subscription|repairs?|maintenance|motor|fuel|training|consultan|sundry|admin|carriage/i.test(text));
    if (isPnl) {
      const bucket = plBucket(text);
      // In a TB, income carries a credit (negative) balance and expenses a debit
      // (positive) balance — normalise by classification regardless of raw sign.
      const amount = bucket === "income" ? Math.abs(balance) : -Math.abs(balance);
      pl.push({ category: PL_SECTION[bucket], description: name, amount: str(amount), prior_amount: "0" });
    } else {
      const bucket = bsBucket(text);
      // Assets keep their (debit, positive) balance; liabilities and equity carry
      // credit (negative) balances — flip to positive magnitudes so the sheet
      // balances the way the engine expects (assets = liabilities + equity).
      const amount = bucket === "fixed" || bucket === "current" ? balance : -balance;
      bs.push({ category: BS_SECTION[bucket], item: name, amount: str(amount), prior_amount: "0" });
    }
  }
  // A trial balance's reserves exclude the current-year result (it lives in the
  // P&L accounts). The balance sheet includes it, so add the derived net profit
  // as a reserves line — without it a TB-derived sheet is out by the year's P&L.
  const netProfit = pl.reduce((total, r) => total + num(r.amount), 0);
  if (pl.length && Math.abs(netProfit) > 0.005) {
    bs.push({ category: BS_SECTION.equity, item: "Profit for the financial year", amount: str(netProfit), prior_amount: "0" });
  }
  return { pl, bs };
}

// ── Aged / bank pass-through ─────────────────────────────────────────────────
function mapAged(rows: Row[]): Row[] {
  return rows
    .map((r) => ({ amount: str(amt(r, AGED_AMOUNT_KEYS)), days_overdue: String(Math.round(amt(r, AGED_DAYS_KEYS))) }))
    .filter((r) => num(r.amount) !== 0);
}
function mapBank(rows: Row[]): Row[] {
  return rows.map((r) => ({ account: val(r, NAME_KEYS) || "Bank", closing_balance: str(amt(r, BANK_BALANCE_KEYS)) }));
}

// ── Period inference ─────────────────────────────────────────────────────────
function parseIsoDate(raw: string): Date | null {
  if (!raw) return null;
  const t = Date.parse(raw);
  if (!Number.isNaN(t)) return new Date(t);
  const m = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/); // dd/mm/yyyy
  if (m) {
    const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    const d = new Date(Date.UTC(year, Number(m[2]) - 1, Number(m[1])));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}
// Latest month-end found across the documents' dates, else today.
function inferAsOfDate(files: ParsedFile[]): string {
  let max: Date | null = null;
  for (const file of files) {
    for (const row of file.rows) {
      const d = parseIsoDate(val(row, DATE_KEYS));
      if (d && (!max || d > max)) max = d;
    }
  }
  const end = max ? new Date(Date.UTC(max.getUTCFullYear(), max.getUTCMonth() + 1, 0)) : new Date();
  return end.toISOString().slice(0, 10);
}

/**
 * Build accounts-production statements from parsed upload files. Returns
 * undefined when there is nothing to build (no P&L, balance sheet or trial
 * balance with usable rows).
 */
export function buildStatementsFromUploads(
  files: ParsedFile[],
  meta: { asOfDate?: string; periodStart?: string; companyName?: string; companyIndustry?: string; currency?: string } = {},
): SyncStatements | undefined {
  const find = (type: string) => files.find((f) => f.upload.fileType === type && f.isParsed && f.rows.length > 0);
  const plFile = find("profit_loss");
  const bsFile = find("balance_sheet");
  const tbFile = find("trial_balance");
  const arFile = find("aged_debtors");
  const apFile = find("aged_creditors");
  const bankFile = find("bank_reconciliation");
  if (!plFile && !bsFile && !tbFile) return undefined;

  const derived = tbFile ? deriveFromTrialBalance(tbFile.rows) : { pl: [], bs: [] };
  const profitLoss = plFile ? mapProfitAndLoss(plFile.rows) : derived.pl;
  const balanceSheet = bsFile ? mapBalanceSheet(bsFile.rows) : derived.bs;
  if (profitLoss.length === 0 && balanceSheet.length === 0) return undefined;

  const asOfDate = meta.asOfDate || inferAsOfDate(files);
  const periodStart = meta.periodStart || `${asOfDate.slice(0, 4)}-01-01`;

  return {
    asOfDate,
    periodStart,
    currency: meta.currency,
    companyName: meta.companyName,
    companyIndustry: meta.companyIndustry,
    profitLoss,
    balanceSheet,
    agedDebtors: arFile ? mapAged(arFile.rows) : [],
    agedCreditors: apFile ? mapAged(apFile.rows) : [],
    bank: bankFile ? mapBank(bankFile.rows) : [],
    trialBalance: tbFile ? tbFile.rows : [],
  };
}
