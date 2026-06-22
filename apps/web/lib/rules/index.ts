import { dataIntegrityRules }      from "./data-integrity";
import { arIntelligenceRules }     from "./ar-intelligence";
import { apIntelligenceRules }     from "./ap-intelligence";
import { vatAssuranceRules }       from "./vat-assurance";
import { closeReviewRules }        from "./close-review";
import { financialStatementRules } from "./financial-statements";
import { controlsFraudRules }      from "./controls-fraud";
import { statisticalRules }        from "./statistical";

export {
  dataIntegrityRules,
  arIntelligenceRules,
  apIntelligenceRules,
  vatAssuranceRules,
  closeReviewRules,
  financialStatementRules,
  controlsFraudRules,
  statisticalRules,
};

export const ALL_RULES = [
  ...dataIntegrityRules,
  ...arIntelligenceRules,
  ...apIntelligenceRules,
  ...vatAssuranceRules,
  ...closeReviewRules,
  ...financialStatementRules,
  ...controlsFraudRules,
  ...statisticalRules,
];

const total =
  dataIntegrityRules.length +
  arIntelligenceRules.length +
  apIntelligenceRules.length +
  vatAssuranceRules.length +
  closeReviewRules.length +
  financialStatementRules.length +
  controlsFraudRules.length +
  statisticalRules.length;

export const RULE_COUNTS = {
  dataIntegrity:      dataIntegrityRules.length,
  arIntelligence:     arIntelligenceRules.length,
  apIntelligence:     apIntelligenceRules.length,
  vatAssurance:       vatAssuranceRules.length,
  closeReview:        closeReviewRules.length,
  financialStatement: financialStatementRules.length,
  controlsFraud:      controlsFraudRules.length,
  statistical:        statisticalRules.length,
  total,
} as const;
