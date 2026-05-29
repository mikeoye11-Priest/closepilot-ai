export type RiskLevel = "low" | "medium" | "high" | "critical";
export type FindingStatus = "open" | "in_review" | "accepted" | "rejected" | "resolved";
export type ConfidenceLevel = "high" | "medium" | "low";
export type ValidationStatus = "passed" | "warning" | "failed";
export type TenantType = "accounting_practice" | "company";

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
  fileType: "trial_balance" | "profit_loss" | "balance_sheet" | "aged_debtors" | "aged_creditors" | "vat_report";
  fileName: string;
  uploadedAt: string;
  rowCount?: number;
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
};

export type Finding = {
  id: string;
  tenantId: string;
  companyId: string;
  severity: RiskLevel;
  category: "month_end" | "cashflow" | "ar" | "ap" | "vat" | "controls" | "data_quality";
  title: string;
  description: string;
  expectedImpact: string;
  status: FindingStatus;
  confidence: ConfidenceLevel;
  evidence: FindingEvidence;
  reviewer?: string;
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
  recommendations: Recommendation[];
};
