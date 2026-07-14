import type { Upload } from "../types";
import type { ParsedFile } from "../upload-analysis";
import type { XeroSyncData } from "./xero-sync";

export function xeroParsedFiles(sync: XeroSyncData, organisation: string, asOfDate: string): ParsedFile[] {
  const prefix = organisation.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "xero";
  const tbHeaders = ["account_code", "account_name", "debit", "credit", "balance"];
  const plHeaders = ["category", "description", "amount"];
  const bsHeaders = ["category", "item", "amount"];
  const arHeaders = ["customer_name", "invoice_number", "invoice_date", "due_date", "days_overdue", "amount", "status"];
  const apHeaders = ["supplier_name", "invoice_number", "invoice_date", "due_date", "days_overdue", "amount", "status"];
  const bankHeaders = ["account", "closing_balance", "unreconciled_count", "unreconciled_amount", "status"];
  const vatHeaders = ["date", "type", "party", "description", "net_amount", "vat_amount", "gross_amount", "vat_code", "nominal_code", "reference", "source_system"];
  return [
    { upload: xeroUpload(`${prefix}-xero-trial-balance-${asOfDate}.csv`, "trial_balance", sync.trialBalanceRows.length), headers: tbHeaders, rows: sync.trialBalanceRows, isParsed: true },
    { upload: xeroUpload(`${prefix}-xero-profit-loss-${asOfDate}.csv`, "profit_loss", sync.profitLossRows.length), headers: plHeaders, rows: sync.profitLossRows, isParsed: true },
    { upload: xeroUpload(`${prefix}-xero-balance-sheet-${asOfDate}.csv`, "balance_sheet", sync.balanceSheetRows.length), headers: bsHeaders, rows: sync.balanceSheetRows, isParsed: true },
    { upload: xeroUpload(`${prefix}-xero-aged-debtors-${asOfDate}.csv`, "aged_debtors", sync.agedDebtorRows.length), headers: arHeaders, rows: sync.agedDebtorRows, isParsed: true },
    { upload: xeroUpload(`${prefix}-xero-aged-creditors-${asOfDate}.csv`, "aged_creditors", sync.agedCreditorRows.length), headers: apHeaders, rows: sync.agedCreditorRows, isParsed: true },
    { upload: xeroUpload(`${prefix}-xero-bank-reconciliation-${asOfDate}.csv`, "bank_reconciliation", sync.bankReconRows.length), headers: bankHeaders, rows: sync.bankReconRows, isParsed: true },
    { upload: xeroUpload(`${prefix}-xero-vat-transactions-${asOfDate}.csv`, "vat_report", sync.vatRows.length), headers: vatHeaders, rows: sync.vatRows, isParsed: true },
  ];
}

function xeroUpload(fileName: string, fileType: Upload["fileType"], rowCount: number): Upload {
  return {
    id: `up_${crypto.randomUUID()}`,
    tenantId: "demo_tenant",
    companyId: "demo_company",
    fileType,
    fileName,
    uploadedAt: new Date().toISOString().slice(0, 10),
    rowCount,
    detectedVendor: "Xero",
    detectionConfidence: 100,
    detectionBasis: "Direct Xero Accounting API sync",
  };
}
