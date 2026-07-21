import type { Upload } from "../types";
import type { ParsedFile } from "../upload-analysis";
import type { AccountingSyncData } from "./accounting-sync";

// Turn a provider-agnostic accounting sync into the parsed "review files" the
// analyser consumes. Headers match the analyzer's column-detection keys so they
// map without a manual mapping. Used by both the Xero and QuickBooks syncs.
export function accountingParsedFiles(
  sync: AccountingSyncData,
  meta: { source: string; vendor: string; basis: string },
  asOfDate: string,
): ParsedFile[] {
  const prefix = meta.source.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || meta.vendor.toLowerCase();
  const slug = meta.vendor.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const tbHeaders = ["account_code", "account_name", "debit", "credit", "balance"];
  const plHeaders = ["category", "description", "amount"];
  const bsHeaders = ["category", "item", "amount"];
  const arHeaders = ["customer_name", "invoice_number", "invoice_date", "due_date", "days_overdue", "amount", "status"];
  const apHeaders = ["supplier_name", "invoice_number", "invoice_date", "due_date", "days_overdue", "amount", "status"];
  const bankHeaders = ["account", "closing_balance", "unreconciled_count", "unreconciled_amount", "status"];
  const vatHeaders = ["date", "type", "party", "description", "net_amount", "vat_amount", "gross_amount", "vat_code", "nominal_code", "reference", "source_system"];
  const file = (name: string, fileType: Upload["fileType"], rowCount: number): Upload => ({
    id: `up_${crypto.randomUUID()}`,
    tenantId: "demo_tenant",
    companyId: "demo_company",
    fileType,
    fileName: name,
    uploadedAt: new Date().toISOString().slice(0, 10),
    rowCount,
    detectedVendor: meta.vendor,
    detectionConfidence: 100,
    detectionBasis: meta.basis,
  });
  return [
    { upload: file(`${prefix}-${slug}-trial-balance-${asOfDate}.csv`, "trial_balance", sync.trialBalanceRows.length), headers: tbHeaders, rows: sync.trialBalanceRows, isParsed: true },
    { upload: file(`${prefix}-${slug}-profit-loss-${asOfDate}.csv`, "profit_loss", sync.profitLossRows.length), headers: plHeaders, rows: sync.profitLossRows, isParsed: true },
    { upload: file(`${prefix}-${slug}-balance-sheet-${asOfDate}.csv`, "balance_sheet", sync.balanceSheetRows.length), headers: bsHeaders, rows: sync.balanceSheetRows, isParsed: true },
    { upload: file(`${prefix}-${slug}-aged-debtors-${asOfDate}.csv`, "aged_debtors", sync.agedDebtorRows.length), headers: arHeaders, rows: sync.agedDebtorRows, isParsed: true },
    { upload: file(`${prefix}-${slug}-aged-creditors-${asOfDate}.csv`, "aged_creditors", sync.agedCreditorRows.length), headers: apHeaders, rows: sync.agedCreditorRows, isParsed: true },
    { upload: file(`${prefix}-${slug}-bank-reconciliation-${asOfDate}.csv`, "bank_reconciliation", sync.bankReconRows.length), headers: bankHeaders, rows: sync.bankReconRows, isParsed: true },
    { upload: file(`${prefix}-${slug}-vat-transactions-${asOfDate}.csv`, "vat_report", sync.vatRows.length), headers: vatHeaders, rows: sync.vatRows, isParsed: true },
  ];
}

// Back-compat wrapper — the Xero sync route calls this. Output is unchanged.
export function xeroParsedFiles(sync: AccountingSyncData, organisation: string, asOfDate: string): ParsedFile[] {
  return accountingParsedFiles(sync, { source: organisation || "xero", vendor: "Xero", basis: "Direct Xero Accounting API sync" }, asOfDate);
}
