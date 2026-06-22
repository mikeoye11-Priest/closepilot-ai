import type { VatTransaction } from "../models";
import { parseDateValue, parseRequiredAmount } from "../normalisers/amount-normaliser";
import { mappingFromSuggestions, readMappedValue, suggestMappings, type ColumnMapping, type MappingSuggestion } from "./aliases";

export interface VatMappingResult {
  transactions: VatTransaction[];
  mapping: ColumnMapping;
  suggestions: MappingSuggestion[];
}

export function mapVatTransactions(rows: Record<string, string>[], headers: string[], mapping?: ColumnMapping, sourceFile?: string): VatMappingResult {
  const suggestions = suggestMappings(headers, ["date", "vatCode", "netAmount", "vatAmount"]);
  const resolved = mapping ?? mappingFromSuggestions(suggestions);
  const transactions = rows.map((row, index) => ({
    date: parseDateValue(readMappedValue(row, resolved, "date")),
    vatCode: readMappedValue(row, resolved, "vatCode"),
    netAmount: parseRequiredAmount(readMappedValue(row, resolved, "netAmount")),
    vatAmount: parseRequiredAmount(readMappedValue(row, resolved, "vatAmount")),
    sourceRowIndex: index + 2,
    sourceFile,
  }));

  return { transactions, mapping: resolved, suggestions };
}
