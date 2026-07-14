import type { RiskLevel } from "../types";

export type VatTreatment =
  | "standard"
  | "reduced"
  | "zero"
  | "exempt"
  | "outside_scope"
  | "reverse_charge"
  | "import_vat"
  | "construction_reverse_charge"
  | "unknown";

export type VatTransaction = {
  date?: string;
  taxPointDate?: string;
  paidDate?: string;
  reference?: string;
  status?: string;
  party?: string;
  description?: string;
  netAmount: number;
  vatAmount: number;
  grossAmount: number;
  vatCode?: string;
  nominalCode?: string;
  customerCountry?: string;
  supplierCountry?: string;
  countryCode?: string;
  countryRegion?: "domestic" | "eu" | "non_eu" | "unknown";
  supplyType?: "goods" | "services" | "unknown";
  type?: "sale" | "purchase" | "adjustment" | "unknown";
  treatment: VatTreatment;
  sourceFile: string;
};

export type VatCompanySize = "small" | "large" | "unknown";

export type VatScheme =
  | "standard"
  | "cash_accounting"
  | "flat_rate"
  | "partial_exemption"
  | "margin_scheme"
  | "mixed"
  | "unknown";

export type VatAssuranceProfile = {
  version: "VAT-V3";
  companySize: VatCompanySize;
  scheme: VatScheme;
  materiality: number;
  riskTolerance: "focused" | "standard" | "enhanced";
  detectedSignals: string[];
};

export type VatReturn = {
  box1: number;
  box2: number;
  box3: number;
  box4: number;
  box5: number;
  box6: number;
  box7: number;
  box8: number;
  box9: number;
};

export type VatBoxContribution = {
  box: keyof VatReturn;
  amount: number;
  party?: string;
  description?: string;
  vatCode?: string;
  canonicalCode?: string;
  countryCode?: string;
  countryRegion?: VatTransaction["countryRegion"];
  recoverability?: "recoverable" | "not_recoverable" | "review" | "not_applicable";
  riskCategory?: "standard" | "reverse_charge" | "import" | "blocked" | "zero_exempt" | "outside_scope" | "specialist" | "unknown";
  treatment: VatTreatment;
  sourceFile: string;
  reason: string;
};

export type VatFinding = {
  id?: string;
  layer?: number;
  severity: RiskLevel;
  finding: string;
  title?: string;
  recommendation: string;
  evidence: string;
  impact?: string;
  exposure?: number;
  evidenceDetail?: {
    transactionId?: string;
    supplier?: string;
    customer?: string;
    sourceFile?: string;
  };
};

export type VatReconciliationResult = {
  name: string;
  status: "passed" | "warning" | "failed";
  expected: number;
  actual: number;
  difference: number;
  detail: string;
};

export type VatReviewAction = {
  question: string;
  action: string;
  priority: "high" | "medium" | "low";
};

export type VatAssuranceStatus = "passed" | "failed" | "review" | "not_tested";

export type VatAssuranceCheck = {
  id: string;
  suite: "vat_assurance_v2" | "vat_assurance_v3";
  category: "box_validation" | "control_reconciliation" | "manual_journals" | "reverse_charge" | "piva" | "trend_analysis" | "scheme_compliance" | "coding_and_rates" | "evidence_quality";
  title: string;
  status: VatAssuranceStatus;
  severity: RiskLevel;
  expected?: number;
  actual?: number;
  difference?: number;
  detail: string;
  recommendation?: string;
};

export type VatReadinessDrivers = {
  boxValidation: number;
  controlReconciliations: number;
  piva: number;
  reverseCharge: number;
  evidence: number;
  schemeCompliance?: number;
  codingAndRates?: number;
};

export type VatWorkpaper = {
  reference: "WP-02 VAT";
  objective: string;
  risk: string;
  evidenceReviewed: string[];
  proceduresPerformed: string[];
  findings: string[];
  conclusion: string;
};

export type VatPeriodComparison = {
  currentVatDue: number;
  previousVatDue: number;
  movement: number;
  percentageChange: number | null;
  threshold: number;
  status: "stable" | "review" | "not_available";
  primaryDriver: string;
  detail: string;
};

export type VatExceptionDashboard = {
  high: number;
  medium: number;
  low: number;
  total: number;
  categories: {
    boxValidation: number;
    controlReconciliation: number;
    manualJournals: number;
    reverseCharge: number;
    piva: number;
    trendAnalysis: number;
    codingAndRates: number;
    schemeCompliance: number;
    evidenceQuality: number;
  };
};

export type VatFilingSignOff = {
  status: "not_ready" | "ready_with_risks" | "ready_to_submit";
  label: "Not Ready" | "Ready with Risks" | "Ready to Submit";
  blockers: string[];
  risks: string[];
  detail: string;
};

export type VatFilingAuditEvent = {
  action: "approved" | "approved_with_risks" | "reopened";
  actor: string;
  at: string;
  reason?: string;
};

export type VatFilingApproval = {
  id: string;
  status: "approved" | "approved_with_risks" | "reopened";
  preparedBy: string;
  reviewedBy: string;
  approvedBy: string;
  approvedAt?: string;
  acknowledgedRisks: string[];
  locked: boolean;
  snapshotHash?: string;
  snapshot: {
    vatReturn: VatReturn;
    readinessScore: number;
    assuranceChecks: VatAssuranceCheck[];
    filingSignOff: VatFilingSignOff;
    periodComparison?: VatPeriodComparison;
  };
  evidenceReferences: string[];
  reportMetadata: {
    title: string;
    version: "VAT-V2";
    generatedAt: string;
  };
  reopenedAt?: string;
  reopenedBy?: string;
  reopenReason?: string;
  auditTrail: VatFilingAuditEvent[];
};

export type VatScoreBreakdown = {
  computationAccuracy: number;
  reconciliation: number;
  missingVatCodes: number;
  blockedVatExposure: number;
  documentationQuality: number;
  manualAdjustments: number;
};

export type VatReviewResult = {
  engineVersion?: string;
  vatReturn: VatReturn;
  assuranceProfile?: VatAssuranceProfile;
  findings: VatFinding[];
  healthScore: number;
  readinessScore?: number;
  readinessDrivers?: VatReadinessDrivers;
  assuranceChecks?: VatAssuranceCheck[];
  workpaper?: VatWorkpaper;
  periodComparison?: VatPeriodComparison;
  exceptionDashboard?: VatExceptionDashboard;
  filingSignOff?: VatFilingSignOff;
  filingApproval?: VatFilingApproval;
  scoreBreakdown?: VatScoreBreakdown;
  status: "HMRC VAT Return Ready for Review" | "Review Required Before Submission" | "VAT Data Required";
  reconciliationResults: VatReconciliationResult[];
  boxContributions: VatBoxContribution[];
  reviewActions?: VatReviewAction[];
  blockedVatRisk?: number;
  highRiskCount?: number;
  exceptionsCount?: number;
  reconciliationStatus?: "PASS" | "REVIEW" | "FAIL";
  transactionsAnalysed: number;
  source: "explicit_return" | "computed_transactions" | "empty";
};
