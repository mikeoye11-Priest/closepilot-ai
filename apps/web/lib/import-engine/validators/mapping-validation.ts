import type { CanonicalField, ColumnMapping } from "../mappings/aliases";

export interface ValidationResult {
  passed: boolean;
  errors: string[];
  warnings: string[];
  missingColumns: string[];
  unknownMappings: string[];
}

export function emptyValidation(): ValidationResult {
  return { passed: true, errors: [], warnings: [], missingColumns: [], unknownMappings: [] };
}

export function mergeValidation(...items: ValidationResult[]): ValidationResult {
  const merged = {
    passed: items.every((item) => item.passed),
    errors: items.flatMap((item) => item.errors),
    warnings: items.flatMap((item) => item.warnings),
    missingColumns: Array.from(new Set(items.flatMap((item) => item.missingColumns))),
    unknownMappings: Array.from(new Set(items.flatMap((item) => item.unknownMappings))),
  };
  return merged;
}

export function validateMapping(mapping: ColumnMapping, requiredFields: CanonicalField[]): ValidationResult {
  const missing = requiredFields.filter((field) => !mapping[field]);
  return {
    passed: missing.length === 0,
    errors: missing.map((field) => `Missing mapping for ${field}.`),
    warnings: [],
    missingColumns: missing,
    unknownMappings: [],
  };
}
