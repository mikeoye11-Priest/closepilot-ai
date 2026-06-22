import type { Creditor } from "../models";
import { parseDateValue, parseRequiredAmount } from "../normalisers/amount-normaliser";
import { mappingFromSuggestions, readMappedValue, suggestMappings, type ColumnMapping, type MappingSuggestion } from "./aliases";

export interface CreditorsMappingResult {
  creditors: Creditor[];
  mapping: ColumnMapping;
  suggestions: MappingSuggestion[];
}

export function mapCreditors(rows: Record<string, string>[], headers: string[], mapping?: ColumnMapping, sourceFile?: string): CreditorsMappingResult {
  const suggestions = suggestMappings(headers, ["supplierName", "invoiceNumber", "dueDate", "amount"]);
  const resolved = mapping ?? mappingFromSuggestions(suggestions);
  const creditors = rows.map((row, index) => ({
    supplierName: readMappedValue(row, resolved, "supplierName"),
    invoiceNumber: readMappedValue(row, resolved, "invoiceNumber"),
    dueDate: parseDateValue(readMappedValue(row, resolved, "dueDate")),
    amount: parseRequiredAmount(readMappedValue(row, resolved, "amount")),
    sourceRowIndex: index + 2,
    sourceFile,
  }));

  return { creditors, mapping: resolved, suggestions };
}
