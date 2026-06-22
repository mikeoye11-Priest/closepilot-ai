import type { CanonicalField, ColumnMapping } from "../mappings/aliases";
import type { ValidationResult } from "./mapping-validation";

export function validateMandatoryColumns(mapping: ColumnMapping, requiredFields: CanonicalField[]): ValidationResult {
  const missing = requiredFields.filter((field) => !mapping[field]);
  return {
    passed: missing.length === 0,
    errors: missing.map((field) => `Required column for ${field} was not mapped.`),
    warnings: [],
    missingColumns: missing,
    unknownMappings: [],
  };
}
