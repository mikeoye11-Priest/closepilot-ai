import { mapCreditors } from "./mappings/creditors-mapper";
import { mapDebtors } from "./mappings/debtors-mapper";
import { mapTrialBalance } from "./mappings/trial-balance-mapper";
import { mapVatTransactions } from "./mappings/vat-mapper";
import type { ColumnMapping, MappingSuggestion } from "./mappings/aliases";
import type { Creditor, Debtor, TrialBalanceLine, VatTransaction } from "./models";
import { profileFromSuggestions, resolveImportProfile } from "./profiles";
import { validateMandatoryColumns } from "./validators/mandatory-columns";
import { mergeValidation, type ValidationResult } from "./validators/mapping-validation";
import { validateMappedNumericColumns } from "./validators/numeric-validation";
import { validateTrialBalanceBalances } from "./validators/tb-balance-validation";
import type { ImportMappingProfile } from "@/lib/types";

export type ImportFileType = "trial_balance" | "aged_debtors" | "aged_creditors" | "vat_report";

export interface NormalisedImportResult {
  fileType: ImportFileType;
  mapping: ColumnMapping;
  suggestions: MappingSuggestion[];
  validation: ValidationResult;
  profile?: ImportMappingProfile;
  importConfidence: number;
  gateStatus: "ready" | "review_required" | "blocked";
  trialBalance?: TrialBalanceLine[];
  debtors?: Debtor[];
  creditors?: Creditor[];
  vatTransactions?: VatTransaction[];
}

export function normaliseFinanceRows(input: {
  fileType: ImportFileType;
  headers: string[];
  rows: Record<string, string>[];
  mapping?: ColumnMapping;
  sourceFile?: string;
  vendor?: string;
  savedProfiles?: ImportMappingProfile[];
  tenantId?: string;
  companyId?: string;
}): NormalisedImportResult {
  const resolvedProfile = resolveImportProfile({
    fileType: input.fileType,
    headers: input.headers,
    vendor: input.vendor,
    savedProfiles: input.savedProfiles,
  });
  const mapping = input.mapping ?? resolvedProfile.mapping;

  if (input.fileType === "trial_balance") {
    const mapped = mapTrialBalance(input.rows, input.headers, mapping, input.sourceFile);
    const hasBalance = Boolean(mapped.mapping.balance);
    const required = hasBalance ? ["accountName", "balance"] as const : ["accountName", "debit", "credit"] as const;
    const profile = resolvedProfile.profile ?? profileFromSuggestions({
      tenantId: input.tenantId,
      companyId: input.companyId,
      fileType: input.fileType,
      vendor: input.vendor,
      headers: input.headers,
      mapping: mapped.mapping,
      suggestions: mapped.suggestions,
    });
    const validation = mergeValidation(
      validateMandatoryColumns(mapped.mapping, [...required]),
      validateMappedNumericColumns(input.rows, mapped.mapping, hasBalance ? ["balance"] : ["debit", "credit"]),
      validateTrialBalanceBalances(mapped.lines),
    );
    const importConfidence = calculateImportConfidence(profile, validation);
    return {
      fileType: input.fileType,
      mapping: mapped.mapping,
      suggestions: mapped.suggestions,
      profile,
      validation,
      importConfidence,
      gateStatus: importGateStatus(validation, importConfidence),
      trialBalance: mapped.lines,
    };
  }

  if (input.fileType === "aged_debtors") {
    const mapped = mapDebtors(input.rows, input.headers, mapping, input.sourceFile);
    const profile = resolvedProfile.profile ?? profileFromSuggestions({
      tenantId: input.tenantId,
      companyId: input.companyId,
      fileType: input.fileType,
      vendor: input.vendor,
      headers: input.headers,
      mapping: mapped.mapping,
      suggestions: mapped.suggestions,
    });
    const validation = mergeValidation(
      validateMandatoryColumns(mapped.mapping, isAgingSummary(input.headers, mapped.mapping) ? ["customerName", "amount"] : ["customerName", "invoiceNumber", "amount"]),
      validateMappedNumericColumns(input.rows, mapped.mapping, ["amount"]),
    );
    const importConfidence = calculateImportConfidence(profile, validation);
    return {
      fileType: input.fileType,
      mapping: mapped.mapping,
      suggestions: mapped.suggestions,
      profile,
      validation,
      importConfidence,
      gateStatus: importGateStatus(validation, importConfidence),
      debtors: mapped.debtors,
    };
  }

  if (input.fileType === "aged_creditors") {
    const mapped = mapCreditors(input.rows, input.headers, mapping, input.sourceFile);
    const profile = resolvedProfile.profile ?? profileFromSuggestions({
      tenantId: input.tenantId,
      companyId: input.companyId,
      fileType: input.fileType,
      vendor: input.vendor,
      headers: input.headers,
      mapping: mapped.mapping,
      suggestions: mapped.suggestions,
    });
    const validation = mergeValidation(
      validateMandatoryColumns(mapped.mapping, isAgingSummary(input.headers, mapped.mapping) ? ["supplierName", "amount"] : ["supplierName", "invoiceNumber", "amount"]),
      validateMappedNumericColumns(input.rows, mapped.mapping, ["amount"]),
    );
    const importConfidence = calculateImportConfidence(profile, validation);
    return {
      fileType: input.fileType,
      mapping: mapped.mapping,
      suggestions: mapped.suggestions,
      profile,
      validation,
      importConfidence,
      gateStatus: importGateStatus(validation, importConfidence),
      creditors: mapped.creditors,
    };
  }

  const mapped = mapVatTransactions(input.rows, input.headers, mapping, input.sourceFile);
  const profile = resolvedProfile.profile ?? profileFromSuggestions({
    tenantId: input.tenantId,
    companyId: input.companyId,
    fileType: input.fileType,
    vendor: input.vendor,
    headers: input.headers,
    mapping: mapped.mapping,
    suggestions: mapped.suggestions,
  });
  const validation = mergeValidation(
    validateMandatoryColumns(mapped.mapping, ["vatCode", "netAmount", "vatAmount"]),
    validateMappedNumericColumns(input.rows, mapped.mapping, ["netAmount", "vatAmount"]),
  );
  const importConfidence = calculateImportConfidence(profile, validation);
  return {
    fileType: input.fileType,
    mapping: mapped.mapping,
    suggestions: mapped.suggestions,
    profile,
    validation,
    importConfidence,
    gateStatus: importGateStatus(validation, importConfidence),
    vatTransactions: mapped.transactions,
  };
}

function calculateImportConfidence(profile: ImportMappingProfile, validation: ValidationResult) {
  let score = profile.confidence;
  if (profile.status === "confirmed") score += 6;
  if (profile.status === "known_profile") score += 4;
  score -= validation.errors.length * 18;
  score -= validation.warnings.length * 6;
  score -= validation.missingColumns.length * 12;
  score -= validation.unknownMappings.length * 8;
  if (validation.passed) score += 3;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function importGateStatus(validation: ValidationResult, importConfidence: number): NormalisedImportResult["gateStatus"] {
  if (!validation.passed) return "blocked";
  if (importConfidence < 70) return "review_required";
  return "ready";
}

function isAgingSummary(headers: string[], mapping: ColumnMapping) {
  if (mapping.invoiceNumber) return false;
  const normalised = headers.map((header) => header.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_"));
  const hasAccountIdentifier = normalised.some((header) => ["account_code", "customer_code", "supplier_code", "contact_code"].includes(header));
  const hasAgingMeasure = normalised.some((header) => /outstanding|current|days?_aged|days?_overdue|credit_limit|total/.test(header));
  return hasAccountIdentifier && hasAgingMeasure;
}

export type { ColumnMapping, MappingSuggestion, ValidationResult };
export type { Creditor, Debtor, TrialBalanceLine, VatTransaction };
export type { ImportMappingProfile };
export { parseCsv } from "./parsers/csv-parser";
export { parseExcelRows } from "./parsers/excel-parser";
export { parseAmount, parseDateValue } from "./normalisers/amount-normaliser";
export { normaliseBalance } from "./normalisers/balance-normaliser";
export { canonicalImportHeader, detectImportVendor, recogniseFinanceDocument } from "./recogniser";
