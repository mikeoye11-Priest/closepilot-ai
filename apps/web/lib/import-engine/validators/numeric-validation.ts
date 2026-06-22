import { readMappedValue, type CanonicalField, type ColumnMapping } from "../mappings/aliases";
import { parseAmount } from "../normalisers/amount-normaliser";
import type { ValidationResult } from "./mapping-validation";

export function validateNumericValues(values: Array<{ label: string; value: number }>): ValidationResult {
  const invalid = values.filter((item) => !Number.isFinite(item.value));
  return {
    passed: invalid.length === 0,
    errors: invalid.map((item) => `${item.label} is not a valid number.`),
    warnings: [],
    missingColumns: [],
    unknownMappings: [],
  };
}

export function validateMappedNumericColumns(
  rows: Record<string, string>[],
  mapping: ColumnMapping,
  fields: CanonicalField[],
): ValidationResult {
  const invalid: string[] = [];

  for (const field of fields) {
    if (!mapping[field]) continue;
    rows.forEach((row, index) => {
      const raw = readMappedValue(row, mapping, field);
      if (raw === "") return;
      if (parseAmount(raw) === null) {
        invalid.push(`${field} row ${row.__sourceRowIndex ?? index + 2}`);
      }
    });
  }

  return {
    passed: invalid.length === 0,
    errors: invalid.map((item) => `Invalid numeric value for ${item}.`),
    warnings: [],
    missingColumns: [],
    unknownMappings: [],
  };
}
