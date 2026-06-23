import type { AnalysisResult, ClientCompany, Company, Tenant } from "./types";
import type { VatReviewResult } from "./vat-engine/types";

export const tenant: Tenant = {
  id: "tenant_default",
  name: "Your Firm",
  type: "accounting_practice",
  plan: "practice"
};

export const company: Company = {
  id: "company_default",
  tenantId: tenant.id,
  name: "Your Company",
  industry: "",
  accountingSystem: "Sage",
  currency: "GBP",
  country: "United Kingdom"
};

export const pilotTenant: Tenant = {
  id: "tenant_pilot_brightlane",
  name: "Northgate Advisory LLP",
  type: "accounting_practice",
  plan: "practice"
};

export const pilotCompany: Company = {
  id: "company_pilot_brightlane",
  tenantId: pilotTenant.id,
  name: "Brightlane Manufacturing Ltd",
  industry: "Manufacturing and Distribution",
  accountingSystem: "Sage",
  currency: "GBP",
  country: "United Kingdom"
};

export const pilotClient: ClientCompany = {
  id: pilotCompany.id,
  name: pilotCompany.name,
  system: pilotCompany.accountingSystem,
  score: 82,
  risk: "medium",
  openFindings: 0,
  closeStatus: "Partner signed"
};

const uploadedAt = "2026-06-18T09:00:00.000Z";
const reviewedAt = "2026-06-18T11:45:00.000Z";
const signedAt = "2026-06-18T12:20:00.000Z";

const pilotVatReview: VatReviewResult = {
  vatReturn: { box1: 31000, box2: 2000, box3: 33000, box4: 17800, box5: 15200, box6: 173000, box7: 99000, box8: 0, box9: 10000 },
  findings: [],
  healthScore: 96,
  readinessScore: 92,
  readinessDrivers: { boxValidation: 100, controlReconciliations: 100, piva: 95, reverseCharge: 95, evidence: 90 },
  assuranceChecks: [
    { id: "VAT-A01", suite: "vat_assurance_v2", category: "box_validation", title: "VAT return arithmetic", status: "passed", severity: "high", expected: 15200, actual: 15200, difference: 0, detail: "Boxes 1–5 recalculate correctly." },
    { id: "VAT-A02", suite: "vat_assurance_v2", category: "control_reconciliation", title: "VAT control reconciliation", status: "passed", severity: "high", expected: 15200, actual: 15200, difference: 0, detail: "VAT control agrees to the adjusted return after the late purchase journal." },
    { id: "VAT-A03", suite: "vat_assurance_v2", category: "reverse_charge", title: "Reverse-charge treatment", status: "passed", severity: "medium", detail: "Reverse-charge services are represented in output and input VAT evidence." },
    { id: "VAT-A04", suite: "vat_assurance_v2", category: "piva", title: "Postponed import VAT", status: "passed", severity: "medium", detail: "PIVA evidence agrees to Boxes 2, 4 and 9." },
    { id: "VAT-A05", suite: "vat_assurance_v2", category: "trend_analysis", title: "Prior-period comparison", status: "not_tested", severity: "low", detail: "No comparative VAT return was included in the synthetic pack." },
  ],
  workpaper: {
    reference: "WP-02 VAT",
    objective: "Confirm the May 2026 VAT return is arithmetically correct, reconciled and supported by transaction evidence.",
    risk: "Incorrect VAT coding or an unreconciled control balance could misstate the liability.",
    evidenceReviewed: ["vat-detail-may.csv", "vat-control-reconciliation.xlsx", "trial-balance-may.csv"],
    proceduresPerformed: ["Recalculated Boxes 1–9", "Agreed Box 5 to the VAT control account", "Reviewed reverse-charge and PIVA treatments", "Inspected the late purchase VAT journal"],
    findings: ["The initial GBP 12,300 control difference was cleared by an evidenced late journal.", "No filing blocker remains."],
    conclusion: "The adjusted VAT return is ready for reviewer acknowledgement. Prior-period trend comparison remains outside this synthetic pack.",
  },
  periodComparison: { currentVatDue: 15200, previousVatDue: 0, movement: 15200, percentageChange: null, threshold: 30, status: "not_available", primaryDriver: "Prior-period data unavailable", detail: "Load a comparative VAT return to activate movement analysis." },
  exceptionDashboard: { high: 0, medium: 0, low: 1, total: 1, categories: { boxValidation: 0, controlReconciliation: 0, manualJournals: 0, reverseCharge: 0, piva: 0, trendAnalysis: 1, codingAndRates: 0 } },
  filingSignOff: { status: "ready_with_risks", label: "Ready with Risks", blockers: [], risks: ["Prior-period VAT comparison not tested in the synthetic pack."], detail: "Core return and reconciliation checks passed; acknowledge the missing comparative review." },
  scoreBreakdown: { computationAccuracy: 100, reconciliation: 100, missingVatCodes: 100, blockedVatExposure: 100, documentationQuality: 90, manualAdjustments: 85 },
  status: "HMRC VAT Return Ready for Review",
  reconciliationResults: [
    { name: "VAT control to Box 5", status: "passed", expected: 15200, actual: 15200, difference: 0, detail: "Adjusted VAT control agrees to the return liability." },
    { name: "VAT return arithmetic", status: "passed", expected: 15200, actual: 15200, difference: 0, detail: "Box 3 less Box 4 equals Box 5." },
  ],
  boxContributions: [
    { box: "box1", amount: 31000, party: "UK customers", description: "Output VAT on taxable sales", vatCode: "STD", canonicalCode: "STD", countryCode: "GB", countryRegion: "domestic", recoverability: "not_applicable", riskCategory: "standard", treatment: "standard", sourceFile: "vat-detail-may.csv", reason: "Standard-rated sales output VAT." },
    { box: "box2", amount: 2000, party: "Import suppliers", description: "Postponed import VAT", vatCode: "PVA", canonicalCode: "PVA", countryCode: "CN", countryRegion: "non_eu", recoverability: "recoverable", riskCategory: "import", treatment: "import_vat", sourceFile: "vat-detail-may.csv", reason: "PIVA output VAT." },
    { box: "box3", amount: 33000, description: "Total VAT due", treatment: "standard", sourceFile: "vat-detail-may.csv", reason: "Boxes 1 and 2 combined." },
    { box: "box4", amount: 17800, party: "UK and import suppliers", description: "Recoverable input VAT", vatCode: "PSTD/PVA", treatment: "standard", sourceFile: "vat-detail-may.csv", reason: "Input VAT supported by purchase and PIVA evidence." },
    { box: "box5", amount: 15200, description: "Net VAT payable", treatment: "standard", sourceFile: "vat-detail-may.csv", reason: "Box 3 less Box 4." },
    { box: "box6", amount: 173000, party: "Customers", description: "Sales excluding VAT", treatment: "standard", sourceFile: "vat-detail-may.csv", reason: "Taxable and zero-rated sales." },
    { box: "box7", amount: 99000, party: "Suppliers", description: "Purchases excluding VAT", treatment: "standard", sourceFile: "vat-detail-may.csv", reason: "Purchases and other inputs." },
    { box: "box9", amount: 10000, party: "Import suppliers", description: "Imported goods value", treatment: "import_vat", sourceFile: "vat-detail-may.csv", reason: "PIVA goods value." },
  ],
  reviewActions: [{ question: "Has the prior-period movement been reviewed?", action: "Add the preceding VAT return before a live filing review.", priority: "low" }],
  blockedVatRisk: 0,
  highRiskCount: 0,
  exceptionsCount: 1,
  reconciliationStatus: "PASS",
  transactionsAnalysed: 142,
  source: "computed_transactions",
};

export const pilotAnalysisResult: AnalysisResult = {
  uploads: [
    { id: "up_pilot_tb", tenantId: pilotTenant.id, companyId: pilotCompany.id, fileType: "trial_balance", fileName: "trial-balance-may.csv", originalFileName: "trial-balance-may.csv", uploadedAt, rowCount: 184, detectionConfidence: 0.98, detectedVendor: "Sage" },
    { id: "up_pilot_pl", tenantId: pilotTenant.id, companyId: pilotCompany.id, fileType: "profit_loss", fileName: "profit-loss-may.csv", originalFileName: "profit-loss-may.csv", uploadedAt, rowCount: 96, detectionConfidence: 0.96, detectedVendor: "Sage" },
    { id: "up_pilot_bs", tenantId: pilotTenant.id, companyId: pilotCompany.id, fileType: "balance_sheet", fileName: "balance-sheet-may.csv", originalFileName: "balance-sheet-may.csv", uploadedAt, rowCount: 112, detectionConfidence: 0.97, detectedVendor: "Sage" },
    { id: "up_pilot_ar", tenantId: pilotTenant.id, companyId: pilotCompany.id, fileType: "aged_debtors", fileName: "aged-debtors-may.csv", originalFileName: "aged-debtors-may.csv", uploadedAt, rowCount: 76, detectionConfidence: 0.95, detectedVendor: "Sage" },
    { id: "up_pilot_ap", tenantId: pilotTenant.id, companyId: pilotCompany.id, fileType: "aged_creditors", fileName: "aged-creditors-may.csv", originalFileName: "aged-creditors-may.csv", uploadedAt, rowCount: 68, detectionConfidence: 0.95, detectedVendor: "Sage" },
    { id: "up_pilot_vat", tenantId: pilotTenant.id, companyId: pilotCompany.id, fileType: "vat_report", fileName: "vat-detail-may.csv", originalFileName: "vat-detail-may.csv", uploadedAt, rowCount: 142, detectionConfidence: 0.94, detectedVendor: "Sage" }
  ],
  validationChecks: [
    { id: "val_pilot_tb_balance", tenantId: pilotTenant.id, companyId: pilotCompany.id, name: "Trial balance balances", status: "passed", detail: "Debits and credits agree within tolerance." },
    { id: "val_pilot_ar_ctrl", tenantId: pilotTenant.id, companyId: pilotCompany.id, name: "AR ledger agrees to control", status: "passed", detail: "Aged debtors agrees to the debtors control account after review adjustment." },
    { id: "val_pilot_ap_ctrl", tenantId: pilotTenant.id, companyId: pilotCompany.id, name: "AP ledger agrees to control", status: "passed", detail: "Aged creditors agrees to the creditors control account." },
    { id: "val_pilot_vat_ctrl", tenantId: pilotTenant.id, companyId: pilotCompany.id, name: "VAT report agrees to ledger", status: "passed", detail: "VAT control reconciliation cleared after evidence review." },
    { id: "val_pilot_bank_rec", tenantId: pilotTenant.id, companyId: pilotCompany.id, name: "Bank reconciliation agrees", status: "warning", detail: "One reconciling item remains listed as a timing item for next close." }
  ],
  findings: [
    {
      id: "find_pilot_ar_001",
      tenantId: pilotTenant.id,
      companyId: pilotCompany.id,
      severity: "high",
      category: "ar",
      title: "Aged debtor concentration reviewed and accepted",
      description: "Three customers make up 64% of overdue receivables, creating a collection and recoverability risk.",
      expectedImpact: "Potential cash and ECL exposure of GBP 42,600.",
      status: "accepted_risk",
      assignedTo: "Michael Grant",
      dueDate: "2026-06-25",
      recommendation: "Partner agreed the risk is acceptable after reviewing post-period receipts and customer correspondence.",
      resolutionNote: "Accepted risk supported by receipts after month-end and management collection plan.",
      evidenceIds: ["ev_pilot_ar_receipts"],
      managerReviewStatus: "approved",
      managerReviewedBy: "Sarah Patel",
      managerReviewedAt: reviewedAt,
      managerReviewNote: "Approved. Evidence supports recoverability conclusion.",
      confidence: "high",
      riskScore: 82,
      amount: 42600,
      sourceFile: "aged-debtors-may.csv",
      confidenceScore: 91,
      ruleId: "AR_002",
      evidenceStrength: "deterministic",
      evidence: {
        sourceFile: "aged-debtors-may.csv",
        accountCode: "Multiple customers",
        period: "May 2026",
        calculation: "Top three overdue balances divided by total overdue receivables.",
        rows: [
          { sourceFile: "aged-debtors-may.csv", rowIndex: 14, accountCode: "CUST-1042", period: "May 2026", amount: 18800, sourceRow: { customer: "Harbour Components", over_60: "18800" } },
          { sourceFile: "aged-debtors-may.csv", rowIndex: 27, accountCode: "CUST-1189", period: "May 2026", amount: 14600, sourceRow: { customer: "Cobalt Retail Group", over_60: "14600" } }
        ]
      },
      reviewer: "Aisha Morgan",
      reviewAction: "accepted_risk",
      reviewReason: "Post-period cash receipts verified for two of three customers.",
      reviewedAt,
      createdAt: "2026-06-18T09:08:00.000Z",
      updatedAt: reviewedAt
    },
    {
      id: "find_pilot_vat_001",
      tenantId: pilotTenant.id,
      companyId: pilotCompany.id,
      severity: "critical",
      category: "vat",
      title: "VAT control difference resolved",
      description: "VAT return total initially differed from the VAT control account by GBP 12,300.",
      expectedImpact: "Potential VAT misstatement of GBP 12,300 before reconciliation.",
      status: "resolved",
      assignedTo: "Michael Grant",
      dueDate: "2026-06-20",
      recommendation: "Retain reconciliation and late-posted journal evidence in the review pack.",
      resolutionNote: "Late purchase VAT journal was posted after the first export. Re-export agrees to VAT control.",
      evidenceIds: ["ev_pilot_vat_recon"],
      managerReviewStatus: "approved",
      managerReviewedBy: "Sarah Patel",
      managerReviewedAt: reviewedAt,
      managerReviewNote: "Approved. Difference reconciled and no blocker remains.",
      confidence: "high",
      riskScore: 95,
      amount: 12300,
      sourceFile: "vat-detail-may.csv",
      confidenceScore: 96,
      ruleId: "VAT_006",
      evidenceStrength: "deterministic",
      evidence: {
        sourceFile: "vat-detail-may.csv",
        accountCode: "VAT-CTRL",
        period: "May 2026",
        calculation: "VAT return box totals reconciled to VAT control after late journal.",
        rows: [
          { sourceFile: "vat-detail-may.csv", rowIndex: 41, accountCode: "VAT-CTRL", period: "May 2026", amount: 12300, sourceRow: { description: "Late purchase VAT journal", vat_amount: "12300" } }
        ]
      },
      reviewer: "Aisha Morgan",
      reviewAction: "resolved",
      reviewReason: "Reconciliation uploaded and manager approved.",
      reviewedAt,
      createdAt: "2026-06-18T09:10:00.000Z",
      updatedAt: reviewedAt
    },
    {
      id: "find_pilot_ap_001",
      tenantId: pilotTenant.id,
      companyId: pilotCompany.id,
      severity: "medium",
      category: "ap",
      title: "Potential duplicate supplier invoice closed",
      description: "Two AP rows shared invoice reference, supplier and amount.",
      expectedImpact: "Duplicate payment exposure of GBP 4,820.",
      status: "false_positive",
      assignedTo: "Aisha Morgan",
      dueDate: "2026-06-21",
      recommendation: "No adjustment required; one row is a credit note reversal.",
      resolutionNote: "False positive. Supporting AP statement confirms reversal posting.",
      evidenceIds: ["ev_pilot_ap_statement"],
      managerReviewStatus: "approved",
      managerReviewedBy: "Sarah Patel",
      managerReviewedAt: reviewedAt,
      managerReviewNote: "Approved as false positive.",
      confidence: "medium",
      riskScore: 58,
      amount: 4820,
      sourceFile: "aged-creditors-may.csv",
      confidenceScore: 78,
      ruleId: "AP_004",
      evidenceStrength: "indicator",
      evidence: {
        sourceFile: "aged-creditors-may.csv",
        accountCode: "SUP-221",
        period: "May 2026",
        calculation: "Duplicate invoice reference and supplier amount match.",
        rows: [
          { sourceFile: "aged-creditors-may.csv", rowIndex: 33, accountCode: "SUP-221", period: "May 2026", amount: 4820, sourceRow: { supplier: "Vector Plastics", invoice_ref: "VP-7781", amount: "4820" } }
        ]
      },
      reviewer: "Aisha Morgan",
      reviewAction: "false_positive",
      reviewReason: "Credit note reversal confirmed.",
      reviewedAt,
      createdAt: "2026-06-18T09:12:00.000Z",
      updatedAt: reviewedAt
    },
    {
      id: "find_pilot_close_001",
      tenantId: pilotTenant.id,
      companyId: pilotCompany.id,
      severity: "high",
      category: "month_end",
      title: "Suspense balance cleared before close",
      description: "Suspense account held a material balance at first upload.",
      expectedImpact: "Close accuracy exposure of GBP 18,400.",
      status: "closed",
      assignedTo: "Michael Grant",
      dueDate: "2026-06-22",
      recommendation: "Keep journal listing and support with the month-end pack.",
      resolutionNote: "Balance allocated to accruals and prepaid tooling invoices.",
      evidenceIds: ["ev_pilot_close_journals"],
      managerReviewStatus: "escalated",
      managerReviewedBy: "Sarah Patel",
      managerReviewedAt: reviewedAt,
      managerReviewNote: "Escalated for partner awareness because the adjustment was material.",
      confidence: "high",
      riskScore: 88,
      amount: 18400,
      sourceFile: "trial-balance-may.csv",
      confidenceScore: 90,
      ruleId: "CR_012",
      evidenceStrength: "deterministic",
      evidence: {
        sourceFile: "trial-balance-may.csv",
        accountCode: "9998",
        period: "May 2026",
        calculation: "Suspense account closing balance reviewed against journal listing.",
        rows: [
          { sourceFile: "trial-balance-may.csv", rowIndex: 91, accountCode: "9998", period: "May 2026", amount: 18400, sourceRow: { account_name: "Suspense", balance: "18400" } }
        ]
      },
      reviewer: "Aisha Morgan",
      reviewAction: "closed",
      reviewReason: "Journal support uploaded and partner escalation accepted.",
      reviewedAt,
      createdAt: "2026-06-18T09:14:00.000Z",
      updatedAt: reviewedAt
    }
  ],
  findingEvidence: [
    { id: "ev_pilot_ar_receipts", findingId: "find_pilot_ar_001", fileName: "post-period-receipts.pdf", fileUrl: "#", uploadedBy: "Michael Grant", uploadedAt: "2026-06-18T10:20:00.000Z", notes: "Bank receipts for Harbour Components and Cobalt Retail Group.", status: "accepted" },
    { id: "ev_pilot_vat_recon", findingId: "find_pilot_vat_001", fileName: "vat-control-reconciliation.xlsx", fileUrl: "#", uploadedBy: "Michael Grant", uploadedAt: "2026-06-18T10:34:00.000Z", notes: "Reconciles VAT return boxes to ledger after late journal.", status: "accepted" },
    { id: "ev_pilot_ap_statement", findingId: "find_pilot_ap_001", fileName: "vector-plastics-statement.pdf", fileUrl: "#", uploadedBy: "Aisha Morgan", uploadedAt: "2026-06-18T10:50:00.000Z", notes: "Supplier statement confirms reversal.", status: "accepted" },
    { id: "ev_pilot_close_journals", findingId: "find_pilot_close_001", fileName: "suspense-clearance-journals.xlsx", fileUrl: "#", uploadedBy: "Michael Grant", uploadedAt: "2026-06-18T11:05:00.000Z", notes: "Journal listing and invoice support.", status: "accepted" }
  ],
  findingComments: [
    { id: "com_pilot_ar_001", findingId: "find_pilot_ar_001", userId: "Sarah Patel", comment: "Evidence is sufficient. Keep this as accepted risk rather than reopening the finding.", createdAt: "2026-06-18T11:30:00.000Z" },
    { id: "com_pilot_vat_001", findingId: "find_pilot_vat_001", userId: "Michael Grant", comment: "Re-export uploaded. VAT control now agrees to return total.", createdAt: "2026-06-18T10:38:00.000Z" },
    { id: "com_pilot_close_001", findingId: "find_pilot_close_001", userId: "Sarah Patel", comment: "Partner should be aware of material suspense clearance, but I am happy with the support.", createdAt: "2026-06-18T11:42:00.000Z" }
  ],
  findingActivities: [
    { id: "act_pilot_001", findingId: "find_pilot_vat_001", action: "created", userId: "closepilot", timestamp: "2026-06-18T09:10:00.000Z", details: "Finding generated from uploaded finance evidence." },
    { id: "act_pilot_002", findingId: "find_pilot_vat_001", action: "evidence_uploaded", userId: "Michael Grant", timestamp: "2026-06-18T10:34:00.000Z", details: "vat-control-reconciliation.xlsx uploaded." },
    { id: "act_pilot_003", findingId: "find_pilot_vat_001", action: "manager_approved", userId: "Sarah Patel", timestamp: reviewedAt, details: "Approved. Difference reconciled and no blocker remains." },
    { id: "act_pilot_004", findingId: "find_pilot_ar_001", action: "accepted_risk", userId: "Aisha Morgan", timestamp: reviewedAt, details: "Accepted risk supported by post-period receipts." },
    { id: "act_pilot_005", findingId: "find_pilot_close_001", action: "manager_escalated", userId: "Sarah Patel", timestamp: reviewedAt, details: "Escalated for partner awareness." }
  ],
  partnerSignOff: {
    id: "signoff_pilot_001",
    tenantId: pilotTenant.id,
    companyId: pilotCompany.id,
    status: "locked",
    reviewPackStatus: "LOCKED",
    preparedBy: "Michael Grant",
    reviewedBy: "Sarah Patel",
    approvedBy: "Priya Desai",
    signedBy: "Priya Desai",
    signedAt,
    lockedAt: signedAt,
    note: "Partner sign-off complete. Material suspense adjustment noted; no critical findings, blockers, or open evidence requests remain.",
    gateSnapshot: {
      criticalOpen: 0,
      highOpen: 0,
      mediumOpen: 0,
      evidenceOutstanding: 0,
      validationBlockers: 0,
      managerReviewComplete: true,
      readiness: 85,
      findingCount: 4,
      uploadCount: 6
    },
    approval: {
      approvedBy: "Priya Desai",
      approvedAt: signedAt,
      readinessScore: 85,
      confidenceScore: 92,
      openFindings: 0,
      acceptedRisks: 1,
      approvalComment: "Partner sign-off complete. Accepted debtor concentration risk remains visible in the review pack."
    }
  },
  recommendations: [
    { id: "rec_pilot_ar_001", tenantId: pilotTenant.id, companyId: pilotCompany.id, findingId: "find_pilot_ar_001", action: "Monitor two large overdue debtors weekly until cleared.", expectedImpact: "Reduce cash collection risk by GBP 42,600.", priority: "high", completed: true },
    { id: "rec_pilot_close_001", tenantId: pilotTenant.id, companyId: pilotCompany.id, findingId: "find_pilot_close_001", action: "Add suspense clearance review to month-end checklist.", expectedImpact: "Reduce recurring close adjustment risk.", priority: "medium", completed: true }
  ],
  vatReview: pilotVatReview,
};
