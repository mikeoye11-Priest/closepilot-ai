import type { Finding, FindingEvidenceRow } from "@/lib/types";

export type AssuranceLayer = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

/**
 * evidenceStrength classifies how reliably a rule's finding can be proven.
 *
 * deterministic — mathematically provable from the data (blank field, date mismatch, sum error).
 *                 Confidence: 95-100%. Show without qualification.
 *
 * indicator     — strong accounting basis but depends on correct column mapping / description text.
 *                 Confidence: 70-90%. Show with confidence score.
 *
 * advisory      — inferred from keywords or statistical patterns. May have false positives.
 *                 Confidence: 40-70%. Show as "Advisory Observations" — useful but not conclusive.
 */
export type EvidenceStrength = "deterministic" | "indicator" | "advisory";

export type RuleType =
  | "threshold"   // numeric field vs fixed value
  | "keyword"     // text field contains keyword(s)
  | "pattern"     // text field matches regex
  | "sign"        // numeric field is negative or positive
  | "comparison"  // field1 vs field2 (e.g. balance > credit_limit)
  | "aging"       // date field is N+ days past
  | "existence"   // account/row matching keyword exists or doesn't
  | "percentage"  // % of rows matching a condition
  | "variance"    // value deviates from expected/average
  | "cross_file"  // requires two file types
  | "financial_statement_metric" // calculated balance-sheet / FS ratios
  | "close_review_metric" // calculated P&L / close-review ratios
  | "ledger_metric"; // grouped ledger analysis such as duplicates and concentration

export type FileType =
  | "trial_balance"
  | "profit_loss"
  | "balance_sheet"
  | "aged_debtors"
  | "aged_creditors"
  | "vat_report"
  | "any";

export type Comparator = "gt" | "lt" | "gte" | "lte" | "eq" | "ne";

export type FinancialStatementMetric =
  | "balance_sheet_equation"
  | "negative_cash"
  | "current_ratio"
  | "quick_ratio"
  | "debt_ratio"
  | "negative_net_assets"
  | "net_asset_ratio"
  | "fixed_asset_depreciation_gap"
  | "intangible_amortisation_gap"
  | "cash_ratio"
  | "asset_coverage"
  | "going_concern_score";

export type CloseReviewMetric =
  | "gross_margin_below"
  | "operating_loss"
  | "overhead_ratio_high"
  | "payroll_burden_high"
  | "finance_cost_ratio_high"
  | "revenue_missing_but_costs_present";

export type LedgerMetric =
  | "duplicate_reference"
  | "duplicate_party_amount_date"
  | "single_party_concentration"
  | "top_five_party_concentration";

export interface AssuranceRule {
  // Identity
  id: string;
  layer: AssuranceLayer;
  name: string;
  description: string;

  // Classification
  severity: Finding["severity"];
  confidence: Finding["confidence"];
  category: Finding["category"];
  fileType: FileType;
  type: RuleType;

  // Field resolution — arrays allow multiple column name aliases
  field?: string[];           // primary field to evaluate
  referenceField?: string[];  // secondary field (for comparison type)
  nameField?: string[];       // identifier/name field for evidence
  dateField?: string[];       // date field (for aging type)

  // Type-specific parameters
  threshold?: number;         // numeric threshold (threshold, sign)
  comparator?: Comparator;    // how to compare (threshold, comparison)
  keywords?: string[];        // keywords to match (keyword, existence, pattern)
  pattern?: string;           // regex string (pattern)
  days?: number;              // age in days (aging)
  percentage?: number;        // % threshold (percentage)
  mustExist?: boolean;        // true = must find row, false = must NOT find row (existence)
  minRows?: number;           // skip rule if fewer rows
  metric?: FinancialStatementMetric; // financial_statement_metric calculation
  closeMetric?: CloseReviewMetric; // close_review_metric calculation
  ledgerMetric?: LedgerMetric; // ledger_metric calculation

  // Evidence tier — how reliably can this finding be proven?
  // Defaults to "indicator" if not specified.
  evidenceStrength?: EvidenceStrength;

  // Output templates (support {{placeholder}} substitution)
  message: string;            // finding title
  detail?: string;            // finding description
  impact?: string;            // expectedImpact
  recommendation: string;
}

// Result from running a single rule against a file
export interface RuleResult {
  triggered: boolean;
  matchCount: number;
  matchTotal: number;
  matchNames: string[];
  rows?: FindingEvidenceRow[];
  evidence: string;
}
