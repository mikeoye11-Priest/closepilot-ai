import type { Upload } from "@/lib/types";
import { normaliseColumnName } from "./mappings/aliases";

export type RecognisedImportFileType = Upload["fileType"];

type DocumentProfile = {
  fileType: RecognisedImportFileType;
  nameHints: RegExp[];
  headerHints: string[];
  rowHints: RegExp[];
};

const DOCUMENT_PROFILES: DocumentProfile[] = [
  {
    fileType: "vat_report",
    nameHints: [/vat|tax/i],
    headerHints: ["vat_code", "tax_code", "vat_amount", "tax_amount", "net_amount", "box", "rate"],
    rowHints: [/vat|tax|standard rated|zero rated|exempt|reverse charge|pva/i],
  },
  {
    fileType: "aged_debtors",
    nameHints: [/aged.?debt|debtor|receivable|customer.?age|ar\b/i],
    headerHints: ["contact", "customer_name", "customer", "debtor_name", "invoice_ref", "invoice_number", "due_date", "due_local", "days_91_plus", "outstanding", "current"],
    rowHints: [/customer|debtor|invoice|overdue|91\+|receivable/i],
  },
  {
    fileType: "aged_creditors",
    nameHints: [/aged.?credit|creditor|payable|supplier.?age|ap\b/i],
    headerHints: ["contact", "supplier_name", "supplier", "vendor_name", "invoice_ref", "invoice_number", "due_date", "due_local", "days_91_plus", "outstanding", "current"],
    rowHints: [/supplier|vendor|creditor|invoice|overdue|91\+|payable/i],
  },
  {
    fileType: "bank_reconciliation",
    nameHints: [/bank.?rec|bank.?reconciliation/i],
    headerHints: ["bank_statement", "tb_balance", "difference", "reconciled", "unreconciled"],
    rowHints: [/bank statement|reconciled|unreconciled|variance/i],
  },
  {
    fileType: "payroll_summary",
    nameHints: [/payroll|paye|wages|salary/i],
    headerHints: ["gross_pay", "employer_nic", "total_cost", "posted_to_tb"],
    rowHints: [/payroll|gross pay|employer nic|paye|salary/i],
  },
  {
    fileType: "fixed_asset_register",
    nameHints: [/fixed.?asset|asset.?register|far/i],
    headerHints: ["asset_code", "asset_description", "cost", "annual_depn", "depreciation", "nbv", "useful_life"],
    rowHints: [/asset|depreciation|nbv|useful life|cost/i],
  },
  {
    fileType: "cashflow_forecast",
    nameHints: [/cash.?flow|forecast/i],
    headerHints: ["week", "period", "opening_cash", "cash_in", "cash_out", "closing_cash", "forecast"],
    rowHints: [/forecast|closing cash|week\s*\d+|cash in|cash out/i],
  },
  {
    fileType: "profit_loss",
    nameHints: [/p&l|profit|loss|pnl|income statement/i],
    headerHints: ["account", "account_name", "amount", "revenue", "gross_profit", "ebit", "category"],
    rowHints: [/revenue|turnover|cost of sales|gross profit|ebit|operating profit|interest/i],
  },
  {
    fileType: "balance_sheet",
    nameHints: [/balance.?sheet|\bbs\b|statement of financial position/i],
    headerHints: ["account", "account_name", "amount", "assets", "liabilities", "equity", "net_assets"],
    rowHints: [/total assets|current assets|fixed assets|liabilities|equity|net assets|shareholders/i],
  },
  {
    fileType: "trial_balance",
    nameHints: [/trial.?balance|\btb\b|nominal ledger|general ledger/i],
    headerHints: ["account_code", "account_name", "nominal_code", "description", "debit", "credit", "balance", "net_change", "balance_at_date", "amount_company_code_currency"],
    rowHints: [/trial balance|nominal|debit|credit|retained earnings|control account/i],
  },
];

const HEADER_ALIASES: Record<string, string> = {
  account_no: "account_code",
  account_number: "account_code",
  account_number_long: "account_code",
  nominal_code: "account_code",
  nominal: "account_code",
  g_l_account: "account_code",
  gl_account_no: "account_code",
  g_l_account_no: "account_code",
  gl_account_number: "account_code",
  g_l_account_number: "account_code",
  gl_account: "account_code",
  no: "account_code",
  ledger_account: "account_name",
  account_description: "account_name",
  account_title: "account_name",
  gl_account_name: "account_name",
  g_l_account_name: "account_name",
  description: "account_name",
  desc: "account_name",
  company: "company_code",
  co_code: "company_code",
  bukrs: "company_code",
  gjahr: "fiscal_year",
  poper: "posting_period",
  accounting_document: "document_number",
  document_no: "document_number",
  belnr: "document_number",
  budat: "posting_date",
  bldat: "document_date",
  dr: "debit",
  debit_amount: "debit",
  cr: "credit",
  credit_amount: "credit",
  debit_credit_indicator: "debit_credit_code",
  shkzg: "debit_credit_code",
  amount_in_company_code_currency: "amount_company_code_currency",
  amount_in_local_currency: "amount_company_code_currency",
  local_currency_amount: "amount_company_code_currency",
  hsl: "amount_company_code_currency",
  dmbtr: "amount_company_code_currency",
  wrbtr: "amount_transaction_currency",
  customer: "customer_name",
  debtor: "customer_name",
  debtor_name: "customer_name",
  supplier: "supplier_name",
  vendor: "supplier_name",
  vendor_name: "supplier_name",
  creditor: "supplier_name",
  creditor_name: "supplier_name",
  invoice_no: "invoice_ref",
  invoice_number: "invoice_ref",
  inv_no: "invoice_ref",
  inv_ref: "invoice_ref",
  reference: "invoice_ref",
  invoice_reference: "invoice_ref",
  tax_code: "vat_code",
  tax_amount: "vat_amount",
  vat_value: "vat_amount",
  tax_value: "vat_amount",
  gross: "gross_amount",
  net: "net_amount",
  value: "amount",
  open_balance: "outstanding",
  amount_due: "outstanding",
  total_due: "total",
  due_amount: "due",
  "1_30": "days_1_30",
  "31_60": "days_31_60",
  "61_90": "days_61_90",
  "91_and_over": "days_91_plus",
  "90_plus": "days_91_plus",
  over_90_days: "days_91_plus",
  debit_month: "debit",
  credit_month: "credit",
  debit_year_to_date: "debit_ytd",
  credit_year_to_date: "credit_ytd",
  annual_depreciation: "annual_depn",
  closing_balance: "closing_cash",
  current_year: "balance",
  this_year: "balance",
  current_year_balance: "balance",
  cy_balance: "balance",
};

export function recogniseFinanceDocument(contextName: string, headers: string[], rows: Record<string, string>[] = []): Pick<Upload, "fileType" | "detectionConfidence" | "detectedVendor" | "detectionBasis"> {
  const context = contextName.toLowerCase();
  const canonicalHeaders = headers.map(canonicalImportHeader);
  const headerSet = new Set(canonicalHeaders);
  const sampleText = rows.slice(0, 12).flatMap((row) => Object.values(row)).join(" ");
  const detectedVendor = detectImportVendor(context, headerSet, sampleText);

  if (/bank statement balance/i.test(sampleText) && /tb bank balance|reconciling difference|unreconciled/i.test(sampleText)) {
    return {
      fileType: "bank_reconciliation",
      detectionConfidence: 96,
      detectedVendor,
      detectionBasis: "Bank statement and trial-balance reconciliation rows identified",
    };
  }

  const explicitVatBoxes = new Set((sampleText.match(/box\s*[1-9]/gi) ?? []).map((value) => value.match(/[1-9]/)?.[0]));
  if (explicitVatBoxes.size >= 5) {
    return {
      fileType: "vat_report",
      detectionConfidence: 96,
      detectedVendor,
      detectionBasis: "Explicit VAT return Box 1-9 rows identified",
    };
  }

  if ((headerSet.has("vat_code") || headerSet.has("tax_code")) && (headerSet.has("vat_amount") || headerSet.has("tax_amount"))) {
    return {
      fileType: "vat_report",
      detectionConfidence: 96,
      detectedVendor,
      detectionBasis: "Tax/VAT code and tax amount headers identified",
    };
  }

  const ranked = DOCUMENT_PROFILES
    .map((profile) => {
      const nameScore = profile.nameHints.some((hint) => hint.test(context)) ? 6 : 0;
      const headerScore = profile.headerHints.reduce((score, hint) => score + (headerSet.has(hint) ? 2 : 0), 0);
      const rowScore = profile.rowHints.reduce((score, hint) => score + (hint.test(sampleText) ? 1 : 0), 0);
      return { fileType: profile.fileType, score: nameScore + headerScore + rowScore };
    })
    .sort((a, b) => b.score - a.score);
  const best = ranked[0] ?? { fileType: "trial_balance" as RecognisedImportFileType, score: 0 };
  const runnerUp = ranked[1]?.score ?? 0;
  const ambiguityPenalty = best.score > 0 && best.score - runnerUp <= 2 ? 8 : 0;
  const confidence = Math.max(45, Math.min(98, 55 + best.score * 5 - ambiguityPenalty));
  const basis = `${headers.length} header(s), ${rows.length} row(s), ${best.score} document signal(s) matched`;
  return { fileType: best.fileType, detectionConfidence: confidence, detectedVendor, detectionBasis: basis };
}

export function canonicalImportHeader(header: string) {
  const normalised = normaliseColumnName(header);
  return HEADER_ALIASES[normalised] ?? normalised;
}

export function detectImportVendor(context: string, headers: Set<string>, sampleText = "") {
  const text = `${context} ${sampleText}`.toLowerCase();
  if (/iris(?:[\s_-]+accounts[\s_-]+production)?|iris[\s_-]?ap/.test(text)) return "IRIS";
  if (/sap|s\/4hana|bukrs|belnr|gjahr|budat/.test(text) || headers.has("company_code") && headers.has("document_number") && headers.has("amount_company_code_currency")) return "SAP";
  if (/xero/.test(text) || headers.has("contact") && (headers.has("due_local") || headers.has("invoice_ref"))) return "Xero";
  if (/quickbooks|intuit|qbo/.test(text) || headers.has("days_91_plus") && headers.has("current")) return "QuickBooks";
  if (/business[\s_-]?central|dynamics|microsoft/.test(text) || headers.has("g_l_account_name") || headers.has("balance_at_date")) return "Business Central";
  if (/freeagent/.test(text)) return "FreeAgent";
  if (/sage/.test(text) || headers.has("account_code") && headers.has("account_name") && headers.has("debit") && headers.has("credit")) return "Sage";
  if (context.endsWith(".xlsx") || context.endsWith(".csv") || context.endsWith(".tsv")) return "Excel/CSV";
  return "Unknown";
}
