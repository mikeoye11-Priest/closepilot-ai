import type { TrialBalanceLine } from "../models";
import type { ValidationResult } from "./mapping-validation";

export function validateTrialBalanceBalances(lines: TrialBalanceLine[], tolerance = 1): ValidationResult {
  const total = lines.reduce((sum, line) => sum + line.balance, 0);
  const passed = Math.abs(total) <= tolerance;
  return {
    passed,
    errors: passed ? [] : [`Trial balance does not balance. Difference ${total.toFixed(2)}.`],
    warnings: [],
    missingColumns: [],
    unknownMappings: [],
  };
}
