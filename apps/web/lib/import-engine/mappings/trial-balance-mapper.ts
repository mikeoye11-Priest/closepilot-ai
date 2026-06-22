import type { TrialBalanceLine } from "../models";
import { normaliseBalance } from "../normalisers/balance-normaliser";
import { mappingFromSuggestions, readMappedValue, suggestMappings, type ColumnMapping, type MappingSuggestion } from "./aliases";

export interface TrialBalanceMappingResult {
  lines: TrialBalanceLine[];
  mapping: ColumnMapping;
  suggestions: MappingSuggestion[];
}

export function mapTrialBalance(rows: Record<string, string>[], headers: string[], mapping?: ColumnMapping, sourceFile?: string): TrialBalanceMappingResult {
  const suggestions = suggestMappings(headers, ["accountCode", "accountName", "balance", "debit", "credit"]);
  const resolved = mapping ?? mappingFromSuggestions(suggestions);
  const lines = rows.map((row, index) => ({
    accountCode: readMappedValue(row, resolved, "accountCode"),
    accountName: readMappedValue(row, resolved, "accountName"),
    balance: normaliseBalance(row, resolved),
    sourceRowIndex: index + 2,
    sourceFile,
  }));

  return { lines, mapping: resolved, suggestions };
}
