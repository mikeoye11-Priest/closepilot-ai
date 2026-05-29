import type { ClientCompany, Company, FinanceScoreBreakdown, Finding, Recommendation, Tenant, Upload, UserCompanyAccess, ValidationCheck } from "./types";

export const tenant: Tenant = {
  id: "tenant_demo",
  name: "Northbridge Advisory LLP",
  type: "accounting_practice",
  plan: "practice"
};

export const company: Company = {
  id: "company_aurora",
  tenantId: tenant.id,
  name: "Aurora Components Ltd",
  industry: "Manufacturing",
  accountingSystem: "Sage",
  currency: "GBP",
  country: "United Kingdom"
};

export const uploads: Upload[] = [
  { id: "up_tb", tenantId: tenant.id, companyId: company.id, fileType: "trial_balance", fileName: "trial-balance-april.xlsx", uploadedAt: "2026-05-27" },
  { id: "up_pl", tenantId: tenant.id, companyId: company.id, fileType: "profit_loss", fileName: "p-and-l-april.xlsx", uploadedAt: "2026-05-27" },
  { id: "up_bs", tenantId: tenant.id, companyId: company.id, fileType: "balance_sheet", fileName: "balance-sheet-april.xlsx", uploadedAt: "2026-05-27" },
  { id: "up_ar", tenantId: tenant.id, companyId: company.id, fileType: "aged_debtors", fileName: "aged-debtors-april.csv", uploadedAt: "2026-05-28" },
  { id: "up_vat", tenantId: tenant.id, companyId: company.id, fileType: "vat_report", fileName: "vat-detail-april.csv", uploadedAt: "2026-05-28" }
];

export const validationChecks: ValidationCheck[] = [
  { id: "val_tb", tenantId: tenant.id, companyId: company.id, name: "Trial balance balances to zero", status: "passed", detail: "Debit and credit totals agree within £0.00 tolerance." },
  { id: "val_bs", tenantId: tenant.id, companyId: company.id, name: "Balance sheet equation", status: "passed", detail: "Assets equal liabilities plus equity for uploaded period." },
  { id: "val_ar", tenantId: tenant.id, companyId: company.id, name: "AR agrees to debtor control", status: "warning", detail: "Aged debtors is £3,840 below debtor control. Review unmatched receipts." },
  { id: "val_ap", tenantId: tenant.id, companyId: company.id, name: "AP agrees to creditor control", status: "passed", detail: "Aged creditors agrees to creditor control account." },
  { id: "val_vat", tenantId: tenant.id, companyId: company.id, name: "VAT report agrees to VAT control", status: "warning", detail: "VAT detail includes 47 blank-coded purchase transactions." }
];

export const scoreBreakdown: FinanceScoreBreakdown = {
  cashFlow: 66,
  receivables: 58,
  payables: 81,
  vatRisk: 62,
  controls: 74,
  dataQuality: 88
};

export const findings: Finding[] = [
  {
    id: "finding_accruals",
    tenantId: tenant.id,
    companyId: company.id,
    severity: "high",
    category: "month_end",
    title: "Likely missing accruals in logistics and utilities",
    description: "April cost run-rate is below the prior three-month average despite stable volumes.",
    expectedImpact: "£18k-£26k close adjustment",
    status: "open",
    confidence: "high",
    evidence: {
      sourceFile: "trial-balance-april.xlsx",
      accountCode: "5200 Logistics / 5400 Utilities",
      period: "Apr 2026",
      calculation: "Jan-Mar average £42k vs Apr £24k. Variance £18k below expected run-rate."
    }
  },
  {
    id: "finding_ar",
    tenantId: tenant.id,
    companyId: company.id,
    severity: "critical",
    category: "ar",
    title: "Three debtors create 64% of overdue cash risk",
    description: "Large invoices moved into 60+ day ageing with no recent collection notes.",
    expectedImpact: "£96k collection exposure",
    status: "open",
    confidence: "high",
    evidence: {
      sourceFile: "aged-debtors-april.csv",
      accountCode: "Topline Retail / Wyvern Group / Aster Foods",
      period: "Apr 2026",
      calculation: "60+ day balances total £96k out of £150k overdue AR."
    }
  },
  {
    id: "finding_vat",
    tenantId: tenant.id,
    companyId: company.id,
    severity: "high",
    category: "vat",
    title: "Missing VAT codes on 47 purchase transactions",
    description: "Supplier spend includes blank VAT treatment on categories normally coded standard-rate.",
    expectedImpact: "Potential VAT return error",
    status: "in_review",
    confidence: "medium",
    reviewer: "Priya Shah",
    evidence: {
      sourceFile: "vat-detail-april.csv",
      accountCode: "Purchase VAT detail",
      period: "Apr 2026",
      calculation: "47 purchase rows have blank VAT treatment where supplier category usually carries standard-rate VAT."
    }
  },
  {
    id: "finding_ap",
    tenantId: tenant.id,
    companyId: company.id,
    severity: "medium",
    category: "ap",
    title: "Possible duplicate supplier invoice",
    description: "Two invoices share supplier, date, amount and similar invoice references.",
    expectedImpact: "£4,820 potential saving",
    status: "open",
    confidence: "medium",
    evidence: {
      sourceFile: "aged-creditors-april.csv",
      accountCode: "Supplier: Meridian Freight",
      period: "Apr 2026",
      calculation: "Invoice 4491A and 4491-A match supplier, date and amount £4,820."
    }
  },
  {
    id: "finding_controls",
    tenantId: tenant.id,
    companyId: company.id,
    severity: "medium",
    category: "controls",
    title: "Unusual manual journal posted after close cut-off",
    description: "Manual journal posted by non-recurring user after normal close window.",
    expectedImpact: "Control review required",
    status: "open",
    confidence: "low",
    evidence: {
      sourceFile: "trial-balance-april.xlsx",
      accountCode: "Manual journal batch MJ-2048",
      period: "Apr 2026",
      calculation: "Journal posted 2 days after close cut-off by a user with no prior journal history."
    }
  }
];

export const recommendations: Recommendation[] = [
  { id: "rec_collect", tenantId: tenant.id, companyId: company.id, findingId: "finding_ar", action: "Prioritise collection calls for Topline Retail, Wyvern Group and Aster Foods.", expectedImpact: "+£74k expected collections", priority: "high", completed: false },
  { id: "rec_accrual", tenantId: tenant.id, companyId: company.id, findingId: "finding_accruals", action: "Create accrual review for logistics, utilities and professional fees.", expectedImpact: "+9 close confidence", priority: "high", completed: false },
  { id: "rec_vat", tenantId: tenant.id, companyId: company.id, findingId: "finding_vat", action: "Review blank VAT code transactions and attach exception notes.", expectedImpact: "+12 VAT health", priority: "high", completed: false },
  { id: "rec_duplicate", tenantId: tenant.id, companyId: company.id, findingId: "finding_ap", action: "Hold duplicate invoice candidate pending supplier confirmation.", expectedImpact: "£4.8k leakage avoided", priority: "medium", completed: false }
];

export const userCompanyAccess: UserCompanyAccess[] = [
  { userId: "user_michael", tenantId: tenant.id, companyId: company.id, role: "practice_admin" },
  { userId: "user_michael", tenantId: tenant.id, companyId: "client_brook", role: "practice_admin" },
  { userId: "user_michael", tenantId: tenant.id, companyId: "client_crest", role: "practice_admin" }
];

export const clients: ClientCompany[] = [
  { id: company.id, name: "Aurora Components Ltd", system: "Sage", score: 68, risk: "high", openFindings: 5, closeStatus: "Day 4 close" },
  { id: "client_brook", name: "Brookline Services", system: "Xero", score: 86, risk: "low", openFindings: 2, closeStatus: "Ready for review" },
  { id: "client_crest", name: "Crest Retail Group", system: "QuickBooks", score: 74, risk: "medium", openFindings: 4, closeStatus: "AR review" },
  { id: "client_nova", name: "Nova Clinics", system: "Business Central", score: 59, risk: "high", openFindings: 8, closeStatus: "VAT exceptions" },
  { id: "client_unity", name: "Unity Projects", system: "Unit4", score: 91, risk: "low", openFindings: 1, closeStatus: "Closed" }
];
