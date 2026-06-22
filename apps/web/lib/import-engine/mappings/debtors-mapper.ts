import type { Debtor } from "../models";
import { parseDateValue, parseRequiredAmount } from "../normalisers/amount-normaliser";
import { mappingFromSuggestions, readMappedValue, suggestMappings, type ColumnMapping, type MappingSuggestion } from "./aliases";

export interface DebtorsMappingResult {
  debtors: Debtor[];
  mapping: ColumnMapping;
  suggestions: MappingSuggestion[];
}

export function mapDebtors(rows: Record<string, string>[], headers: string[], mapping?: ColumnMapping, sourceFile?: string): DebtorsMappingResult {
  const suggestions = suggestMappings(headers, ["customerName", "invoiceNumber", "dueDate", "amount"]);
  const resolved = mapping ?? mappingFromSuggestions(suggestions);
  const debtors = rows.map((row, index) => ({
    customerName: readMappedValue(row, resolved, "customerName"),
    invoiceNumber: readMappedValue(row, resolved, "invoiceNumber"),
    dueDate: parseDateValue(readMappedValue(row, resolved, "dueDate")),
    amount: parseRequiredAmount(readMappedValue(row, resolved, "amount")),
    sourceRowIndex: index + 2,
    sourceFile,
  }));

  return { debtors, mapping: resolved, suggestions };
}
