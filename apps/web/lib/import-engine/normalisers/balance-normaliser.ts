import { readMappedValue, type ColumnMapping } from "../mappings/aliases";
import { parseRequiredAmount } from "./amount-normaliser";

export function normaliseBalance(row: Record<string, string>, mapping: ColumnMapping) {
  const balance = readMappedValue(row, mapping, "balance");
  if (balance !== "") return parseRequiredAmount(balance);

  const debit = parseRequiredAmount(readMappedValue(row, mapping, "debit"));
  const credit = parseRequiredAmount(readMappedValue(row, mapping, "credit"));
  return debit - credit;
}
