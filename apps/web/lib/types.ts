export type RiskLevel = "low" | "medium" | "high" | "critical";
export type FindingStatus =
  | "open"
  | "under_review"
  | "evidence_requested"
  | "evidence_received"
  | "resolved"
  | "approved"
  | "closed"
  | "false_positive"
  | "accepted_risk"
  // Legacy review states kept so saved workspaces continue to load.
  | "in_review"
  | "accepted"
  | "rejected"
  | "needs_investigation"
  | "not_applicable";
export type ConfidenceLevel = "high" | "medium" | "low";
export type ValidationStatus = "passed" | "warning" | "failed";
export type TenantType = "accounting_practice" | "company";
export type ManagerReviewStatus = "not_ready" | "ready" | "approved" | "returned" | "escalated";
export type PartnerSignOffStatus = "draft" | "under_review" | "partner_review" | "approved" | "locked" | "signed";
export type ReviewPackStatus = "DRAFT" | "UNDER_REVIEW" | "PARTNER_REVIEW" | "APPROVED" | "LOCKED";
export type ImportMappingProfileStatus = "suggested" | "known_profile" | "confirmed" | "needs_confirmation";

export type Tenant = {
  id: string;
  name: string;
  type: TenantType;
  plan: string;
};

export type Company = {
  id: string;
  tenantId: string;
  name: string;
  industry: string;
  accountingSystem: string;
  currency: string;
  country: string;
};

export type Upload = {
  id: string;
  tenantId: string;
  companyId: string;
  fileType:
    | "trial_balance"
    | "profit_loss"
    | "balance_sheet"
    | "aged_debtors"
    | "aged_creditors"
    | "vat_report"
    | "bank_reconciliation"
    | "cashflow_forecast"
    | "payroll_summary"
    | "fixed_asset_register"
    | "inventory_report";
  fileName: string;
  originalFileName?: string;
  uploadedAt: string;
  rowCount?: number;
  detectionConfidence?: number;
  detectedVendor?: string;
  detectionBasis?: string;
  mappingProfileId?: string;
  mappingProfileName?: string;
  mappingProfileStatus?: ImportMappingProfileStatus;
  mappingConfidence?: number;
  importConfidence?: number;
  importGateStatus?: "ready" | "review_required" | "blocked";
  storageBucket?: string;
  storageKey?: string;
  fileUrl?: string;
  storageStatus?: "stored" | "skipped" | "failed";
};

export type ImportMappingProfileField = {
  targetField: string;
  sourceColumn: string;
  confidence: number;
};

export type ImportMappingProfile = {
  id: string;
  tenantId?: string;
  companyId?: string;
  profileName: string;
  vendor?: string;
  fileType: Upload["fileType"];
  mapping: Record<string, string>;
  fields: ImportMappingProfileField[];
  confidence: number;
  status: ImportMappingProfileStatus;
  source: "built_in" | "reviewer_confirmed" | "suggested";
  headersSignature?: string;
  createdAt?: string;
  confirmedAt?: string;
  lastUsedAt?: string;
};

export type ValidationCheck = {
  id: string;
  tenantId: string;
  companyId: string;
  name: string;
  status: ValidationStatus;
  detail: string;
};

export type FindingEvidence = {
  sourceFile: string;
  accountCode: string;
  period: string;
  calculation: string;
  rows?: FindingEvidenceRow[];
  // Extended evidence fields
  matchCount?: number;
  matchValue?: number;
  matchNames?: string[];
};

export type FindingEvidenceRow = {
  sourceFile: string;
  sheetName?: string;
  rowIndex?: number;
  accountCode?: string;
  period?: string;
  amount?: number;
  sourceRow: Record<string, string>;
  calculationInput?: Record<string, string | number | boolean | null>;
};

export type EvidenceStatus =
  | "not_required"
  | "requested"
  | "uploaded"
  | "under_review"
  | "accepted"
  | "rejected"
  | "superseded";

export type Evidence = {
  id: string;
  findingId: string;
  title?: string;
  description?: string;
  fileName: string;
  fileUrl?: string;
  requestedBy?: string;
  requestedAt?: string;
  uploadedBy: string;
  uploadedAt: string;
  notes?: string;
  status?: EvidenceStatus;
  reviewedBy?: string;
  reviewedAt?: string;
  reviewNote?: string;
  acceptedBy?: string;
  acceptedAt?: string;
  rejectedBy?: string;
  rejectedAt?: string;
};

export interface EvidenceRequest {
  id: string;
  findingId: string;
  title: string;
  description: string;
  requestedBy: string;
  requestedAt: string;
  status: Extract<EvidenceStatus, "requested" | "uploaded" | "under_review" | "accepted" | "rejected" | "superseded">;
  uploadedBy?: string;
  uploadedAt?: string;
  reviewedBy?: string;
  reviewedAt?: string;
  reviewNote?: string;
}

export type FindingComment = {
  id: string;
  findingId: string;
  userId: string;
  comment: string;
  createdAt: string;
};

export type FindingActivity = {
  id: string;
  findingId: string;
  action:
    | "created"
    | "updated"
    | "assigned"
    | "evidence_requested"
    | "evidence_uploaded"
    | "evidence_under_review"
    | "evidence_accepted"
    | "evidence_rejected"
    | "evidence_superseded"
    | "commented"
    | "reviewed"
    | "approved"
    | "resolved"
    | "false_positive"
    | "accepted_risk"
    | "manager_approved"
    | "manager_returned"
    | "manager_escalated"
    | "closed";
  userId: string;
  timestamp: string;
  details?: string;
};

export type CollectionStatus = "not_contacted" | "contacted" | "promised" | "disputed" | "paid" | "escalated";

export type CollectionContact = {
  id: string;
  channel: "email" | "phone" | "meeting" | "note";
  note: string;
  contactedBy: string;
  contactedAt: string;
};

export type CollectionCase = {
  id: string;
  findingId: string;
  customer: string;
  status: CollectionStatus;
  owner: string;
  promiseAmount?: number;
  promiseDate?: string;
  disputeReason?: string;
  contacts: CollectionContact[];
  updatedAt: string;
};

export type PartnerSignOffGateSnapshot = {
  criticalOpen: number;
  highOpen: number;
  mediumOpen: number;
  evidenceOutstanding: number;
  validationBlockers: number;
  managerReviewComplete: boolean;
  readiness: number;
  findingCount: number;
  uploadCount: number;
};

export type PartnerApproval = {
  approvedBy: string;
  approvedAt: string;
  readinessScore: number;
  confidenceScore: number;
  openFindings: number;
  acceptedRisks: number;
  approvalComment?: string;
};

export type PartnerSignOff = {
  id: string;
  tenantId: string;
  companyId: string;
  status: PartnerSignOffStatus;
  reviewPackStatus?: ReviewPackStatus;
  preparedBy?: string;
  reviewedBy?: string;
  approvedBy?: string;
  signedBy: string;
  signedAt: string;
  lockedAt?: string;
  note?: string;
  gateSnapshot: PartnerSignOffGateSnapshot;
  approval?: PartnerApproval;
};

export type Finding = {
  id: string;
  tenantId: string;
  companyId: string;
  severity: RiskLevel;
  category: "month_end" | "cashflow" | "ar" | "ap" | "vat" | "controls" | "data_quality" | "financial_statements";
  title: string;
  description: string;
  expectedImpact: string;
  status: FindingStatus;
  assignedTo?: string;
  dueDate?: string;
  recommendation?: string;
  resolutionNote?: string;
  evidenceIds?: string[];
  evidenceLinks?: string[];
  attachments?: Evidence[];
  comments?: FindingComment[];
  owner?: string;
  manager?: string;
  partner?: string;
  evidenceAttached?: boolean;
  managerReviewStatus?: ManagerReviewStatus;
  managerReviewedBy?: string;
  managerReviewedAt?: string;
  managerReviewNote?: string;
  confidence: ConfidenceLevel;
  riskScore?: number;
  amount?: number;
  sourceFile?: string;
  confidenceScore?: number;   // 0–100 granular confidence
  ruleId?: string;            // which rule generated this finding
  evidenceStrength?: "deterministic" | "indicator" | "advisory";
  evidence: FindingEvidence;
  reviewer?: string;
  reviewAction?: FindingStatus;
  reviewReason?: string;
  reviewedAt?: string;
  resolvedAt?: string;
  resolvedBy?: string;
  approvedAt?: string;
  approvedBy?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type Recommendation = {
  id: string;
  tenantId: string;
  companyId: string;
  findingId: string;
  action: string;
  expectedImpact: string;
  priority: "low" | "medium" | "high";
  completed: boolean;
};

export type FinanceScoreBreakdown = {
  cashFlow: number;
  receivables: number;
  payables: number;
  vatRisk: number;
  controls: number;
  closeReview: number;
  financialStatements: number;
  dataQuality: number;
};

export type CashForecastPoint = {
  period: string;
  cash: number;
  risk: RiskLevel;
};

export type ClientCompany = {
  id: string;
  name: string;
  system: string;
  score: number;
  risk: RiskLevel;
  openFindings: number;
  closeStatus: string;
};

export type UserCompanyAccess = {
  userId: string;
  tenantId: string;
  companyId: string;
  role: "practice_admin" | "manager" | "reviewer" | "client_user";
};

export type AnalysisResult = {
  uploads: Upload[];
  validationChecks: ValidationCheck[];
  findings: Finding[];
  importProfiles?: ImportMappingProfile[];
  findingEvidence?: Evidence[];
  findingComments?: FindingComment[];
  findingActivities?: FindingActivity[];
  collectionCases?: CollectionCase[];
  partnerSignOff?: PartnerSignOff;
  recommendations: Recommendation[];
  vatReview?: import("./vat-engine/types").VatReviewResult;
  inventoryReview?: import("./inventory-engine").InventoryReviewResult;
};
