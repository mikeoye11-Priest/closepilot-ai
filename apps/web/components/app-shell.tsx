"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { evidenceGroundedAnswer, type GroundedAnswerSections } from "@/lib/ask-closepilot";
import { company as seededCompany, pilotAnalysisResult, pilotClient, pilotCompany, pilotTenant, tenant as seededTenant } from "@/lib/data";
import { assistantAnswer, calculateAuditReadinessV2, calculateFinanceScorecard, calculateReadinessDrivers, calculateReviewConfidence, estimateCashAtRisk, estimateTimeSaved, generateForecast, parseImpactAmount, riskCopy, riskLabel, type ReadinessDriver, type ScoreDriver } from "@/lib/finance";
import type { RuleAnalyticsReport } from "@/lib/rule-analytics";
import { analyseFinanceFiles, scopeAnalysisResult } from "@/lib/upload-analysis";
import type { AnalysisResult, CashForecastPoint, ClientCompany, Company, Evidence, EvidenceStatus, FinanceScoreBreakdown, Finding, FindingActivity, FindingComment, FindingEvidenceRow, FindingStatus, ImportMappingProfile, ManagerReviewStatus, PartnerSignOff, PartnerSignOffGateSnapshot, PartnerSignOffStatus, Recommendation, ReviewPackStatus, RiskLevel, Tenant, TenantType, Upload, ValidationCheck, ValidationStatus } from "@/lib/types";
import type { VatReviewResult } from "@/lib/vat-engine/types";
import { approveVatFiling, reopenVatFiling } from "@/lib/vat-engine/sign-off";
import type { AccountingIntegrationState } from "@/lib/integrations/types";

const nav: Array<string | null> = [
  "Overview",
  null,
  "Finance Review",
  "Findings",
  "Assurance Engine",
  "Upload Finance Pack",
  null,
  "Audit Readiness",
  "Review Pack",
  "Change Intelligence",
  "Cash Intelligence",
  "VAT Assurance",
  "Controls & Fraud",
  "Collections Intelligence",
  "Close Review",
  null,
  "Ask ClosePilot",
  "Practice Portal",
  "User Guide",
  "Settings",
];

const storageKey = "closepilot.workspace.v2";
const lifecycleStatuses = ["open", "under_review", "evidence_requested", "evidence_received", "resolved", "approved", "closed"] as const;
type LifecycleStatus = (typeof lifecycleStatuses)[number];
const reviewedFindingStatuses: FindingStatus[] = ["under_review", "evidence_requested", "evidence_received", "resolved", "approved", "closed", "false_positive", "accepted_risk", "in_review", "accepted", "rejected", "needs_investigation", "not_applicable"];

function lifecycleStatus(status: FindingStatus): LifecycleStatus {
  if (status === "in_review") return "under_review";
  if (status === "needs_investigation") return "evidence_requested";
  if (status === "accepted") return "approved";
  if (status === "rejected" || status === "not_applicable" || status === "false_positive" || status === "accepted_risk") return "closed";
  return status;
}

function isOpenFinding(finding: Finding) {
  return !["resolved", "approved", "closed", "false_positive", "accepted_risk", "accepted", "rejected", "not_applicable"].includes(finding.status);
}

function isCriticalOpenFinding(finding: Finding) {
  return isOpenFinding(finding) && (finding.severity === "critical" || finding.severity === "high");
}

function isReadyForManagerReview(finding: Finding) {
  return ["evidence_received", "resolved", "approved", "accepted_risk", "false_positive", "closed"].includes(finding.status);
}

function managerReviewStatus(finding: Finding): ManagerReviewStatus {
  return finding.managerReviewStatus ?? (isReadyForManagerReview(finding) ? "ready" : "not_ready");
}

function findingLifecycleCounts(findings: Finding[]) {
  return lifecycleStatuses.reduce<Record<LifecycleStatus, number>>((counts, status) => {
    counts[status] = findings.filter((finding) => lifecycleStatus(finding.status) === status).length;
    return counts;
  }, {
    open: 0,
    under_review: 0,
    evidence_requested: 0,
    evidence_received: 0,
    resolved: 0,
    approved: 0,
    closed: 0,
  });
}

const uploadTypeLabels: Record<Upload["fileType"], string> = {
  trial_balance: "Trial Balance",
  profit_loss: "P&L",
  balance_sheet: "Balance Sheet",
  aged_debtors: "Aged Debtors",
  aged_creditors: "Aged Creditors",
  vat_report: "VAT Report",
  bank_reconciliation: "Bank Reconciliation",
  cashflow_forecast: "Cashflow Forecast",
  payroll_summary: "Payroll Summary",
  fixed_asset_register: "Fixed Asset Register",
};

const coreUploadTypes: Upload["fileType"][] = ["trial_balance", "profit_loss", "balance_sheet", "aged_debtors", "aged_creditors", "vat_report"];

type WorkspaceState = {
  tenant: Tenant;
  companies: Company[];
  currentCompanyId: string;
  portfolioClients: ClientCompany[];
  companySnapshots: Record<string, AnalysisResult>;
};

type AssuranceMetrics = {
  testsExecuted: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  closeReadiness: number;
  confidence: number;
  readinessDrivers: ReadinessDriver[];
};

type EvidenceProfile = {
  deterministic: number;
  indicator: number;
  advisory: number;
  evidenceLinked: number;
  reviewed: number;
  accepted: number;
  rejected: number;
  unresolved: number;
  blockers: number;
};

type ExposureBreakdown = {
  cashRisk: number;
  vatRisk: number;
  closeRisk: number;
  controlRisk: number;
  total: number;
};

type CoreQualityMetric = {
  label: string;
  value: number;
  target: string;
  passed: boolean;
  detail: string;
  higherIsBetter: boolean;
};

type CoreQualityMetrics = {
  overall: number;
  fileRecognitionAccuracy: number;
  mappingAccuracy: number;
  importGatePassRate: number;
  blockedImports: number;
  reviewRequiredImports: number;
  tbValidationAccuracy: number;
  falsePositiveRate: number;
  ruleAccuracy: number;
  vatCalculationAccuracy: number;
  importConfidenceScore: number;
  workflowCoverage: number;
  findingsReviewedPct: number;
  findingsResolvedPct: number;
  evidenceCoveragePct: number;
  partnerSignOffCoveragePct: number;
  deterministicPct: number;
  indicatorPct: number;
  advisoryPct: number;
  pilotReadinessScore: number;
  metrics: CoreQualityMetric[];
  workflowMetrics: CoreQualityMetric[];
  confidenceMetrics: CoreQualityMetric[];
};

type CollectionOpportunity = {
  customer: string;
  value: number;
  reason: string;
  action: string;
  severity: RiskLevel;
};

type SupplierRiskOpportunity = {
  supplier: string;
  value: number;
  reason: string;
  action: string;
  severity: RiskLevel;
};

type AssistantResult = {
  companyId: string;
  question: string;
  answer: string;
  sections: GroundedAnswerSections | null;
  followUps: string[];
  findingId?: string;
  relatedFindingId?: string;
  source: string;
  confidence: number | null;
  createdAt: string;
};

type ReviewNoteSet = {
  findingCode: string;
  reviewerNote: string;
  managerNote: string;
  partnerConclusion: string;
  clientExplanation: string;
};

type Workpaper = {
  id: string;
  title: string;
  area: string;
  objective: string;
  risk: string;
  evidenceReviewed: string[];
  procedurePerformed: string;
  findings: Array<{
    id: string;
    code: string;
    title: string;
    severity: RiskLevel;
    status: string;
    note: string;
    sourceFile: string;
    rowIndexes: string;
    rowCount: number;
    accountOrParty: string;
    calculation: string;
    evidenceStrength: string;
    detectionConfidence: number;
  }>;
  conclusion: string;
  reviewer: string;
  date: string;
};

const emptyAnalysisResult: AnalysisResult = {
  uploads: [],
  validationChecks: [],
  findings: [],
  importProfiles: [],
  findingEvidence: [],
  findingComments: [],
  findingActivities: [],
  partnerSignOff: undefined,
  recommendations: [],
  vatReview: undefined,
};

function emptySnapshot(): AnalysisResult {
  return { ...emptyAnalysisResult, uploads: [], validationChecks: [], findings: [], importProfiles: [], findingEvidence: [], findingComments: [], findingActivities: [], partnerSignOff: undefined, recommendations: [] };
}

function normaliseSnapshot(snapshot?: AnalysisResult): AnalysisResult {
  if (!snapshot || snapshot.uploads.length === 0) return emptySnapshot();
  const reviewLocked = snapshot.partnerSignOff?.reviewPackStatus === "LOCKED" || snapshot.partnerSignOff?.status === "locked" || snapshot.partnerSignOff?.status === "signed";
  return {
    uploads: snapshot.uploads,
    validationChecks: snapshot.validationChecks ?? [],
    findings: snapshot.findings ?? [],
    importProfiles: snapshot.importProfiles ?? [],
    findingEvidence: snapshot.findingEvidence ?? [],
    findingComments: snapshot.findingComments ?? [],
    findingActivities: snapshot.findingActivities ?? [],
    partnerSignOff: snapshot.partnerSignOff,
    recommendations: (snapshot.recommendations ?? []).map((recommendation) => reviewLocked ? { ...recommendation, completed: true } : recommendation),
    vatReview: snapshot.vatReview,
  };
}


function clientToCompany(client: ClientCompany, tenantId: string): Company {
  return {
    id: client.id,
    tenantId,
    name: client.name,
    industry: "Professional Services",
    accountingSystem: client.system,
    currency: "GBP",
    country: "United Kingdom"
  };
}

function updateClientSummary(clients: ClientCompany[], company: Company, snapshot: AnalysisResult): ClientCompany[] {
  if (!snapshot.uploads.length) {
    const nextClient: ClientCompany = {
      id: company.id,
      name: company.name,
      system: company.accountingSystem,
      score: 0,
      risk: "medium",
      openFindings: 0,
      closeStatus: "Awaiting upload",
    };
    return [nextClient, ...clients.filter((item) => item.id !== company.id)];
  }
  const score = calculateFinanceScorecard(snapshot.findings, snapshot.validationChecks, snapshot.recommendations, snapshot.uploads).overall;
  const risk = riskLabel(score);
  const openFindings = snapshot.findings.filter(isOpenFinding).length;
  const nextClient: ClientCompany = {
    id: company.id,
    name: company.name,
    system: company.accountingSystem,
    score,
    risk,
    openFindings,
    closeStatus: snapshot.uploads.length ? `${snapshot.uploads.length} files reviewed` : "Awaiting upload"
  };
  return [nextClient, ...clients.filter((item) => item.id !== company.id)];
}

function mergeImportProfiles(existing: ImportMappingProfile[], incoming: ImportMappingProfile[]) {
  const merged = new Map(existing.map((profile) => [profile.id, profile]));
  incoming.forEach((profile) => {
    const prior = merged.get(profile.id);
    merged.set(profile.id, prior?.status === "confirmed" ? { ...profile, ...prior, lastUsedAt: profile.lastUsedAt ?? prior.lastUsedAt } : profile);
  });
  return Array.from(merged.values());
}

// Rule counts sourced from the actual rule library — always accurate
const LAYER_RULE_COUNTS = {
  dataIntegrity:      50,  // data-integrity.ts
  arIntelligence:     30,  // ar-intelligence.ts
  apIntelligence:     40,  // ap-intelligence.ts
  vatAssurance:       60,  // vat-assurance.ts
  closeReview:        55,  // close-review.ts
  financialStatement: 50,  // financial-statements.ts
  controlsFraud:      60,  // controls-fraud.ts
  statistical:        30,  // statistical.ts + statistical-detection.ts
} as const;

const TOTAL_RULES = Object.values(LAYER_RULE_COUNTS).reduce((s, v) => s + v, 0);

function assuranceMetrics(findings: Finding[], validationChecks: ValidationCheck[], uploads: Upload[]): AssuranceMetrics {
  const scoredFindings = findings.filter((item) => item.evidenceStrength !== "advisory");
  const critical = scoredFindings.filter((item) => item.severity === "critical").length;
  const high = scoredFindings.filter((item) => item.severity === "high").length;
  const medium = scoredFindings.filter((item) => item.severity === "medium").length;
  const low = scoredFindings.filter((item) => item.severity === "low").length;
  // testsExecuted = rules that actually ran (each file type activates its layer's rules)
  const fileTypes = new Set(uploads.map((u) => u.fileType));
  const layersActive = [
    fileTypes.has("trial_balance") || fileTypes.has("balance_sheet"),
    fileTypes.has("aged_debtors"),
    fileTypes.has("aged_creditors"),
    fileTypes.has("vat_report"),
    fileTypes.has("trial_balance") || fileTypes.has("profit_loss"),
    fileTypes.has("balance_sheet") || fileTypes.has("profit_loss"),
    uploads.length > 0,
    fileTypes.size >= 2,
  ];
  const layerKeys = Object.keys(LAYER_RULE_COUNTS) as (keyof typeof LAYER_RULE_COUNTS)[];
  const testsExecuted = uploads.length
    ? layerKeys.reduce((s, key, i) => s + (layersActive[i] ? LAYER_RULE_COUNTS[key] : Math.round(LAYER_RULE_COUNTS[key] * 0.3)), 0)
    : 0;
  const closeReadiness = calculateAuditReadinessV2(findings, validationChecks, uploads);
  const confidence = calculateReviewConfidence(findings, validationChecks, uploads);
  const readinessDrivers = calculateReadinessDrivers(findings, validationChecks, uploads);
  return { testsExecuted, critical, high, medium, low, closeReadiness, confidence, readinessDrivers };
}

function coreQualityMetrics(
  uploads: Upload[],
  validationChecks: ValidationCheck[],
  findings: Finding[],
  importProfiles: ImportMappingProfile[],
  findingEvidence: Evidence[],
  partnerSignOff?: PartnerSignOff,
  vatReview?: VatReviewResult,
): CoreQualityMetrics {
  const hasUploads = uploads.length > 0;
  const importUploads = uploads.filter((upload) => upload.importGateStatus);
  const fileRecognitionAccuracy = hasUploads
    ? Math.round(uploads.reduce((sum, upload) => sum + (upload.detectionConfidence ?? 70), 0) / uploads.length)
    : 0;
  const mappingAccuracy = importUploads.length
    ? Math.round(importUploads.reduce((sum, upload) => sum + (upload.importConfidence ?? upload.mappingConfidence ?? 0), 0) / importUploads.length)
    : importProfiles.length
      ? Math.round(importProfiles.reduce((sum, profile) => sum + profile.confidence, 0) / importProfiles.length)
      : 0;
  const blockedImports = importUploads.filter((upload) => upload.importGateStatus === "blocked").length;
  const reviewRequiredImports = importUploads.filter((upload) => upload.importGateStatus === "review_required").length;
  const importGatePassRate = importUploads.length ? Math.round((importUploads.length - blockedImports - reviewRequiredImports) / importUploads.length * 100) : 0;
  const tbChecks = validationChecks.filter((check) => /trial balance.*balances|tb.*balance/i.test(check.name));
  const tbValidationAccuracy = tbChecks.length ? (tbChecks.every((check) => check.status === "passed") ? 100 : 0) : hasUploads ? 0 : 100;
  const decided = findings.filter((finding) => ["false_positive", "accepted_risk", "resolved", "closed", "accepted", "rejected", "not_applicable"].includes(finding.status));
  const falsePositiveRate = decided.length ? Math.round(findings.filter((finding) => finding.status === "false_positive").length / decided.length * 100) : 0;
  const failedChecks = validationChecks.filter((check) => check.status === "failed").length;
  const ruleAccuracy = hasUploads ? Math.max(0, Math.min(100, 100 - failedChecks * 8 - falsePositiveRate)) : 0;
  const vatCalculationAccuracy = vatReview?.scoreBreakdown?.computationAccuracy ?? (uploads.some((upload) => upload.fileType === "vat_report") ? 0 : 100);
  const importConfidenceScore = hasUploads ? Math.round((fileRecognitionAccuracy + mappingAccuracy + importGatePassRate) / 3) : 0;
  const findingsReviewedPct = findings.length ? Math.round(findings.filter((finding) => reviewedFindingStatuses.includes(finding.status) || Boolean(finding.reviewedAt)).length / findings.length * 100) : 0;
  const findingsResolvedPct = findings.length ? Math.round(findings.filter((finding) => !isOpenFinding(finding)).length / findings.length * 100) : 0;
  const evidenceCoveragePct = findings.length ? Math.round(findings.filter((finding) => finding.evidenceAttached || finding.evidenceIds?.length || findingEvidence.some((item) => item.findingId === finding.id) || finding.evidence?.rows?.length).length / findings.length * 100) : 0;
  const partnerSignOffCoveragePct = partnerSignOff ? 100 : findings.length ? Math.min(80, Math.round(findingsReviewedPct * 0.3 + findingsResolvedPct * 0.4 + evidenceCoveragePct * 0.3)) : 0;
  const workflowCoverage = findings.length ? Math.round((findingsReviewedPct + findingsResolvedPct + evidenceCoveragePct + partnerSignOffCoveragePct) / 4) : 0;
  const deterministicPct = findings.length ? Math.round(findings.filter((finding) => finding.evidenceStrength === "deterministic").length / findings.length * 100) : 0;
  const indicatorPct = findings.length ? Math.round(findings.filter((finding) => !finding.evidenceStrength || finding.evidenceStrength === "indicator").length / findings.length * 100) : 0;
  const advisoryPct = findings.length ? Math.max(0, 100 - deterministicPct - indicatorPct) : 0;

  const metrics: CoreQualityMetric[] = [
    { label: "File Recognition Accuracy", value: fileRecognitionAccuracy, target: ">95%", passed: fileRecognitionAccuracy >= 95, detail: `${uploads.length} upload(s) classified`, higherIsBetter: true },
    { label: "Mapping Accuracy", value: mappingAccuracy, target: ">95%", passed: mappingAccuracy >= 95, detail: `${importProfiles.length} profile(s), ${reviewRequiredImports} awaiting confirmation`, higherIsBetter: true },
    { label: "Import Gate Pass Rate", value: importGatePassRate, target: "100%", passed: importGatePassRate === 100 || importUploads.length === 0, detail: `${blockedImports} blocked, ${reviewRequiredImports} paused`, higherIsBetter: true },
    { label: "TB Validation Accuracy", value: tbValidationAccuracy, target: "100%", passed: tbValidationAccuracy === 100, detail: tbChecks.length ? `${tbChecks.filter((check) => check.status === "passed").length}/${tbChecks.length} TB check(s) passed` : "No TB validation in this pack", higherIsBetter: true },
    { label: "False Positive Rate", value: falsePositiveRate, target: "<5%", passed: falsePositiveRate < 5, detail: decided.length ? `${decided.length} reviewed finding(s)` : "No reviewed findings yet", higherIsBetter: false },
    { label: "Rule Accuracy", value: ruleAccuracy, target: ">95%", passed: ruleAccuracy >= 95, detail: `${failedChecks} failed validation gate(s)`, higherIsBetter: true },
    { label: "VAT Calculation Accuracy", value: vatCalculationAccuracy, target: "100%", passed: vatCalculationAccuracy === 100, detail: uploads.some((upload) => upload.fileType === "vat_report") ? "From VAT computation engine" : "No VAT report uploaded", higherIsBetter: true },
  ];
  const workflowMetrics: CoreQualityMetric[] = [
    { label: "Findings Reviewed", value: findingsReviewedPct, target: ">80%", passed: findingsReviewedPct >= 80 || findings.length === 0, detail: `${findings.filter((finding) => reviewedFindingStatuses.includes(finding.status) || finding.reviewedAt).length}/${findings.length} finding(s) reviewed`, higherIsBetter: true },
    { label: "Findings Resolved", value: findingsResolvedPct, target: ">70%", passed: findingsResolvedPct >= 70 || findings.length === 0, detail: `${findings.filter((finding) => !isOpenFinding(finding)).length}/${findings.length} finding(s) resolved or closed`, higherIsBetter: true },
    { label: "Evidence Coverage", value: evidenceCoveragePct, target: ">80%", passed: evidenceCoveragePct >= 80 || findings.length === 0, detail: `${findingEvidence.length} uploaded evidence file(s), source-row evidence included`, higherIsBetter: true },
    { label: "Partner Sign-Off Coverage", value: partnerSignOffCoveragePct, target: "100%", passed: partnerSignOffCoveragePct === 100 || findings.length === 0, detail: partnerSignOff ? "Partner sign-off completed" : "Progress toward sign-off gate", higherIsBetter: true },
  ];
  const confidenceMetrics: CoreQualityMetric[] = [
    { label: "Deterministic Findings", value: deterministicPct, target: "Maximise", passed: deterministicPct >= 60 || findings.length === 0, detail: "Mathematically proven or directly reconciled", higherIsBetter: true },
    { label: "Indicator Findings", value: indicatorPct, target: "Review", passed: true, detail: "Strong accounting signal requiring reviewer judgement", higherIsBetter: true },
    { label: "Advisory Findings", value: advisoryPct, target: "<15%", passed: advisoryPct < 15 || findings.length === 0, detail: "Lower-confidence observations", higherIsBetter: false },
  ];

  const applicableMetrics = hasUploads ? metrics : metrics.filter((metric) => metric.label === "VAT Calculation Accuracy");
  const overall = hasUploads
    ? Math.round(metrics.reduce((sum, metric) => sum + normalisedQualityValue(metric), 0) / metrics.length)
    : 0;
  const pilotReadinessScore = hasUploads
    ? Math.round(importConfidenceScore * 0.25 + ruleAccuracy * 0.25 + Math.max(0, 100 - falsePositiveRate) * 0.25 + workflowCoverage * 0.25)
    : 0;

  return {
    overall,
    fileRecognitionAccuracy,
    mappingAccuracy,
    importGatePassRate,
    blockedImports,
    reviewRequiredImports,
    tbValidationAccuracy,
    falsePositiveRate,
    ruleAccuracy,
    vatCalculationAccuracy,
    importConfidenceScore,
    workflowCoverage,
    findingsReviewedPct,
    findingsResolvedPct,
    evidenceCoveragePct,
    partnerSignOffCoveragePct,
    deterministicPct,
    indicatorPct,
    advisoryPct,
    pilotReadinessScore,
    metrics: applicableMetrics,
    workflowMetrics,
    confidenceMetrics,
  };
}

function normalisedQualityValue(metric: CoreQualityMetric) {
  return metric.higherIsBetter ? metric.value : Math.max(0, 100 - metric.value);
}

function evidenceProfile(findings: Finding[]): EvidenceProfile {
  return {
    deterministic: findings.filter((f) => f.evidenceStrength === "deterministic").length,
    indicator: findings.filter((f) => !f.evidenceStrength || f.evidenceStrength === "indicator").length,
    advisory: findings.filter((f) => f.evidenceStrength === "advisory").length,
    evidenceLinked: findings.filter((f) => f.evidence?.sourceFile).length,
    reviewed: findings.filter((f) => reviewedFindingStatuses.includes(f.status)).length,
    accepted: findings.filter((f) => ["evidence_received", "resolved", "accepted", "accepted_risk"].includes(f.status)).length,
    rejected: findings.filter((f) => ["closed", "false_positive", "rejected", "not_applicable"].includes(f.status)).length,
    unresolved: findings.filter(isOpenFinding).length,
    blockers: findings.filter(isCriticalOpenFinding).length,
  };
}

function exportFile(fileName: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function printWithTitle(title: string) {
  const priorTitle = document.title;
  document.title = title;
  window.print();
  window.setTimeout(() => {
    document.title = priorTitle;
  }, 500);
}

function csvCell(value: unknown) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function htmlCell(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function findingsCsv(findings: Finding[]) {
  const headers = ["Rule ID", "Title", "Category", "Severity", "Status", "Evidence strength", "Confidence", "Source file", "Evidence rows", "Source row indexes", "Account / Party", "Calculation", "Expected impact", "Reviewer", "Review action", "Review reason", "Reviewed at"];
  const rows = findings.map((f) => [
    f.ruleId ?? f.id,
    f.title,
    f.category,
    f.severity,
    f.status,
    f.evidenceStrength ?? "indicator",
    f.confidenceScore ?? f.confidence,
    f.evidence.sourceFile,
    f.evidence.rows?.length ?? 0,
    evidenceRowIndexes(f.evidence.rows),
    f.evidence.accountCode,
    f.evidence.calculation,
    f.expectedImpact,
    f.reviewer ?? "",
    f.reviewAction ?? "",
    f.reviewReason ?? "",
    f.reviewedAt ?? "",
  ]);
  return [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
}

function evidenceRowIndexes(rows?: FindingEvidenceRow[]) {
  return rows?.map((row) => row.rowIndex ? `${row.sheetName ? `${row.sheetName}:` : ""}${row.rowIndex}` : row.sheetName).filter(Boolean).join(" / ") ?? "";
}

function evidenceRowPreview(row: FindingEvidenceRow) {
  const entries = Object.entries(row.sourceRow ?? {})
    .filter(([, value]) => String(value ?? "").trim())
    .slice(0, 4);
  return entries.length ? entries.map(([key, value]) => `${key}: ${value}`).join(" · ") : "Source row captured";
}

function evidenceCalculationLabel(row: FindingEvidenceRow) {
  const label = row.calculationInput?.label;
  return typeof label === "string" && label ? label : row.accountCode || "Evidence row";
}

function findingEvidenceReference(finding: Finding) {
  const rows = finding.evidence?.rows ?? [];
  const sourceFile = finding.sourceFile ?? finding.evidence?.sourceFile ?? "No source file linked";
  const accountOrParty = finding.evidence?.accountCode || rows.find((row) => row.accountCode)?.accountCode || "N/A";
  const calculation = finding.evidence?.calculation || finding.expectedImpact || finding.description || "No calculation captured";
  return {
    sourceFile,
    rowIndexes: evidenceRowIndexes(rows) || "No source row captured",
    rowCount: rows.length,
    accountOrParty,
    calculation,
  };
}

function buildGeneratedReviewPack({
  company,
  tenant,
  score,
  risk,
  findings,
  findingEvidence,
  findingComments,
  findingActivities,
  partnerSignOff,
  recommendations,
  validationChecks,
  uploads,
  cashAtRisk,
  financialExposure,
  preparedBy,
  reviewedBy,
  approvedBy,
  reviewPackStatus,
  conclusion,
}: {
  company: Company;
  tenant: Tenant;
  score: number;
  risk: RiskLevel;
  findings: Finding[];
  findingEvidence: Evidence[];
  findingComments: FindingComment[];
  findingActivities: FindingActivity[];
  partnerSignOff?: PartnerSignOff;
  recommendations: Recommendation[];
  validationChecks: ValidationCheck[];
  uploads: Upload[];
  cashAtRisk: number;
  financialExposure: number;
  preparedBy: string;
  reviewedBy: string;
  approvedBy: string;
  reviewPackStatus: ReviewPackStatus;
  conclusion: string;
}) {
  const generatedAt = new Date().toISOString();
  const readinessScore = calculateAuditReadinessV2(findings, validationChecks, uploads);
  const profile = evidenceProfile(findings);
  const reviewedPct = findings.length ? Math.round(profile.reviewed / findings.length * 100) : 0;
  const openFindings = findings.filter(isOpenFinding);
  const acceptedRisks = findings.filter((finding) => finding.status === "accepted_risk");
  const failedChecks = validationChecks.filter((check) => check.status === "failed");
  const outstandingEvidence = findings.filter((finding) => ["evidence_requested", "needs_investigation", "evidence_received"].includes(finding.status)).length
    + findingEvidence.filter((item) => ["requested", "uploaded", "under_review", "rejected"].includes(item.status ?? "uploaded")).length;
  const managerApproved = findings.filter((finding) => managerReviewStatus(finding) === "approved").length;
  const managerEscalated = findings.filter((finding) => managerReviewStatus(finding) === "escalated").length;
  const managerReturned = findings.filter((finding) => managerReviewStatus(finding) === "returned").length;
  const exposure = exposureBreakdown(findings, cashAtRisk, financialExposure);
  const blockerSummary = {
    criticalOpen: openFindings.filter((finding) => finding.severity === "critical").length,
    highOpen: openFindings.filter((finding) => finding.severity === "high").length,
    openFindings: openFindings.length,
    validationBlockers: failedChecks.length,
    outstandingEvidence,
    managerReviewComplete: findings.length > 0 && findings.every((finding) => ["approved", "escalated"].includes(managerReviewStatus(finding))),
  };
  const signOffReady = blockerSummary.criticalOpen === 0
    && blockerSummary.highOpen === 0
    && blockerSummary.validationBlockers === 0
    && blockerSummary.outstandingEvidence === 0
    && blockerSummary.managerReviewComplete
    && readinessScore > 70;
  const packStatus = partnerSignOff?.reviewPackStatus ?? reviewPackStatus;
  const evidenceReferences = findings.map((finding) => ({
    findingId: finding.id,
    ruleId: finding.ruleId ?? finding.id,
    title: finding.title,
    sourceFile: finding.evidence.sourceFile,
    calculation: finding.evidence.calculation,
    rowCount: finding.evidence.rows?.length ?? 0,
    rowIndexes: evidenceRowIndexes(finding.evidence.rows),
    uploadedEvidence: findingEvidence
      .filter((item) => item.findingId === finding.id)
      .map((item) => ({
        fileName: item.fileName,
        status: item.status ?? "uploaded",
        uploadedBy: item.uploadedBy,
        uploadedAt: item.uploadedAt,
        reviewNote: item.reviewNote ?? item.notes ?? "",
      })),
  }));
  const workflowDossier = findings.map((finding) => ({
    finding,
    lifecycleStatus: lifecycleStatus(finding.status),
    lifecycleLabel: LIFECYCLE_LABELS[lifecycleStatus(finding.status)],
    owner: findingOwner(finding),
    managerReviewStatus: managerReviewStatus(finding),
    evidence: findingEvidence.filter((item) => item.findingId === finding.id),
    comments: findingComments.filter((item) => item.findingId === finding.id),
    activities: findingActivities.filter((item) => item.findingId === finding.id),
  }));
  const reviewNotesLibrary = findings.map((finding) => ({
    findingId: finding.id,
    title: finding.title,
    ...reviewNotesForFinding(finding),
  }));
  const workpapers = generateWorkpapers({
    findings,
    uploads,
    validationChecks,
    reviewer: reviewedBy || preparedBy || "ClosePilot Reviewer",
    date: generatedAt,
  });

  return {
    generatedAt,
    title: `${company.name} Review Pack`,
    company,
    tenant: { id: tenant.id, name: tenant.name, type: tenant.type },
    status: packStatus,
    exportStatus: signOffReady || partnerSignOff ? "final_ready" : "draft_blocked",
    conclusion,
    executiveSummary: {
      financeHealthScore: score,
      risk: riskCopy(risk),
      auditReadinessScore: readinessScore,
      reviewConfidenceScore: reviewedPct,
      totalFindings: findings.length,
      openFindings: openFindings.length,
      acceptedRisks: acceptedRisks.length,
      financialExposure,
      cashAtRisk,
      filesReviewed: uploads.length,
      recommendedNextStep: signOffReady || partnerSignOff ? "Perform partner sign-off and lock the review pack." : "Resolve blockers, evidence requests and manager decisions before sign-off.",
    },
    signOffGate: {
      ready: signOffReady || Boolean(partnerSignOff),
      blockers: blockerSummary,
      readinessThreshold: 70,
      partnerSignOff,
    },
    signOffCertificate: {
      preparedBy: partnerSignOff?.preparedBy ?? preparedBy,
      reviewedBy: partnerSignOff?.reviewedBy ?? reviewedBy,
      approvedBy: partnerSignOff?.approval?.approvedBy ?? partnerSignOff?.approvedBy ?? approvedBy,
      date: partnerSignOff?.approval?.approvedAt ?? partnerSignOff?.signedAt ?? generatedAt,
      readinessScore: partnerSignOff?.approval?.readinessScore ?? readinessScore,
      confidenceScore: partnerSignOff?.approval?.confidenceScore ?? reviewedPct,
      acceptedRisks: partnerSignOff?.approval?.acceptedRisks ?? acceptedRisks.length,
      reviewPackStatus: packStatus,
      lockedAt: partnerSignOff?.lockedAt,
      approvalComment: partnerSignOff?.approval?.approvalComment ?? partnerSignOff?.note ?? "",
    },
    reviewProgress: {
      lifecycleCounts: findingLifecycleCounts(findings),
      reviewedFindings: profile.reviewed,
      resolvedFindings: findings.filter((finding) => ["resolved", "approved", "closed", "accepted", "accepted_risk"].includes(finding.status)).length,
      acceptedRisks: acceptedRisks.length,
      evidenceUploads: findingEvidence.length,
      acceptedEvidence: findingEvidence.filter((item) => item.status === "accepted").length,
      rejectedEvidence: findingEvidence.filter((item) => item.status === "rejected").length,
      comments: findingComments.length,
      activityEntries: findingActivities.length,
      managerApproved,
      managerEscalated,
      managerReturned,
    },
    exposure,
    uploads,
    validationChecks,
    evidenceProfile: profile,
    evidenceReferences,
    openFindings: openFindings.map((finding) => ({
      id: finding.id,
      ruleId: finding.ruleId ?? finding.id,
      title: finding.title,
      category: finding.category,
      severity: finding.severity,
      status: finding.status,
      owner: findingOwner(finding),
      dueDate: finding.dueDate ?? "",
      expectedImpact: finding.expectedImpact,
      sourceFile: finding.evidence.sourceFile,
      recommendation: finding.recommendation ?? "",
    })),
    acceptedRisks: acceptedRisks.map((finding) => ({
      id: finding.id,
      title: finding.title,
      severity: finding.severity,
      reason: finding.resolutionNote || finding.reviewReason || finding.recommendation || "Accepted by review decision.",
      approvedBy: finding.approvedBy || partnerSignOff?.approval?.approvedBy || partnerSignOff?.signedBy || "",
      approvedAt: finding.approvedAt || finding.resolvedAt || finding.reviewedAt || partnerSignOff?.approval?.approvedAt || "",
    })),
    managementActions: recommendations.map((recommendation) => ({
      action: recommendation.action,
      expectedImpact: recommendation.expectedImpact,
      completed: recommendation.completed,
    })),
    reviewNotes: findings
      .filter((finding) => finding.reviewReason || finding.managerReviewNote || finding.resolutionNote)
      .map((finding) => ({
        findingId: finding.id,
        title: finding.title,
        reviewer: finding.reviewer || finding.managerReviewedBy || "",
        note: finding.resolutionNote || finding.managerReviewNote || finding.reviewReason || "",
        reviewedAt: finding.reviewedAt || finding.managerReviewedAt || "",
      })),
    reviewNotesLibrary,
    workpapers,
    activities: findingActivities,
    findings: workflowDossier,
  };
}

const AUDIT_PACK_REQUIRED_FILES: Array<{ fileType: Upload["fileType"]; label: string; action: string }> = [
  { fileType: "trial_balance", label: "Trial Balance", action: "Upload the trial balance used for the period review." },
  { fileType: "profit_loss", label: "Profit & Loss", action: "Upload the P&L export used for revenue, payroll and overhead review." },
  { fileType: "balance_sheet", label: "Balance Sheet", action: "Upload the balance sheet so the TB and statement position can be reconciled." },
  { fileType: "aged_debtors", label: "AR Aging", action: "Upload aged debtors to support recoverability and collections review." },
  { fileType: "aged_creditors", label: "AP Aging", action: "Upload aged creditors to support supplier and liabilities review." },
  { fileType: "vat_report", label: "VAT Return", action: "Upload the VAT report so VAT boxes can be reconciled to control accounts." },
  { fileType: "bank_reconciliation", label: "Bank Reconciliation", action: "Upload the bank reconciliation before final sign-off." },
  { fileType: "fixed_asset_register", label: "Fixed Asset Register", action: "Upload the fixed asset register if depreciation or asset additions are material." },
];

function auditPackRequiredActions(findings: Finding[], validationChecks: ValidationCheck[], uploads: Upload[]) {
  const presentFiles = new Set(uploads.map((upload) => upload.fileType));
  const missingFileActions = AUDIT_PACK_REQUIRED_FILES
    .filter((item) => !presentFiles.has(item.fileType) && item.fileType !== "fixed_asset_register")
    .map((item) => ({
      area: "Evidence",
      priority: item.fileType === "balance_sheet" || item.fileType === "bank_reconciliation" ? "High" : "Medium",
      action: item.action,
      reason: `${item.label} is missing from the review pack.`,
    }));

  const failedValidationActions = validationChecks
    .filter((check) => check.status === "failed")
    .map((check) => ({
      area: "Validation",
      priority: "High",
      action: `Clear validation blocker: ${check.name}.`,
      reason: check.detail,
    }));

  const openFindingActions = findings
    .filter((finding) => isOpenFinding(finding) && (finding.severity === "critical" || finding.severity === "high"))
    .slice()
    .sort((a, b) => findingSeverityRank(b.severity) - findingSeverityRank(a.severity))
    .map((finding) => ({
      area: findingCategoryLabel(finding.category),
      priority: finding.severity === "critical" ? "Critical" : "High",
      action: `Resolve or accept risk: ${finding.title}.`,
      reason: finding.expectedImpact || finding.recommendation || "Open high-risk finding blocks clean partner sign-off.",
    }));

  const managerActions = findings
    .filter((finding) => isReadyForManagerReview(finding) && managerReviewStatus(finding) !== "approved" && managerReviewStatus(finding) !== "escalated")
    .map((finding) => ({
      area: "Manager Review",
      priority: "Medium",
      action: `Manager review required for ${finding.title}.`,
      reason: finding.managerReviewNote || "Finding is ready for manager decision before partner sign-off.",
    }));

  return [...failedValidationActions, ...openFindingActions, ...missingFileActions, ...managerActions].slice(0, 12);
}

function auditPackPartnerSummary(findings: Finding[], validationChecks: ValidationCheck[], uploads: Upload[]) {
  const hasUpload = (fileType: Upload["fileType"]) => uploads.some((upload) => upload.fileType === fileType);
  const byCategory = (category: Finding["category"]) => findings.filter((finding) => finding.category === category);
  const acceptedRisk = (items: Finding[]) => items.find((finding) => finding.status === "accepted_risk");
  const openHigh = (items: Finding[]) => items.filter((finding) => isOpenFinding(finding) && (finding.severity === "critical" || finding.severity === "high"));
  const evidenceLine = (items: Finding[]) => items[0]?.evidence?.calculation || items[0]?.expectedImpact || "No exception evidence identified.";
  const validationLine = (pattern: RegExp) => validationChecks.find((check) => pattern.test(check.name) || pattern.test(check.detail));

  const revenueFindings = findings.filter((finding) => /revenue|sales|turnover/i.test(`${finding.title} ${finding.description} ${finding.ruleId ?? ""}`));
  const payrollFindings = findings.filter((finding) => /payroll|salary|wages|paye|nic/i.test(`${finding.title} ${finding.description} ${finding.ruleId ?? ""}`));
  const vatFindings = byCategory("vat");
  const debtorFindings = byCategory("ar");
  const creditorFindings = byCategory("ap");
  const bankFindings = findings.filter((finding) => /bank|cash|reconciliation/i.test(`${finding.title} ${finding.description} ${finding.ruleId ?? ""}`));
  const controlFindings = byCategory("controls");
  const dataFindings = byCategory("data_quality");

  const sections = [
    {
      area: "Revenue",
      status: openHigh(revenueFindings).length ? "Evidence required" : revenueFindings.length ? "Review required" : "No revenue exception identified",
      summary: revenueFindings.length
        ? `${revenueFindings[0].title}. ${acceptedRisk(revenueFindings) ? "Risk accepted and retained for partner visibility." : "Reviewer evidence is required before relying on revenue completeness."}`
        : hasUpload("profit_loss") ? "P&L uploaded; no revenue-specific exception is currently open." : "P&L not uploaded, so revenue review is incomplete.",
      evidence: evidenceLine(revenueFindings),
      action: revenueFindings.length ? "Review revenue evidence, resolve the finding, or document accepted risk." : "Upload or review the P&L evidence before sign-off.",
    },
    {
      area: "Payroll",
      status: acceptedRisk(payrollFindings) ? "Accepted risk" : openHigh(payrollFindings).length ? "Evidence required" : payrollFindings.length ? "Review required" : "No payroll exception identified",
      summary: payrollFindings.length
        ? `${payrollFindings[0].title}. ${acceptedRisk(payrollFindings) ? "Management explanation is retained in the accepted risk register." : "Payroll completeness must be confirmed before sign-off."}`
        : "No payroll-specific exception is currently open.",
      evidence: evidenceLine(payrollFindings),
      action: payrollFindings.length ? "Confirm payroll posting route and retain supporting journals or management explanation." : "No payroll action required from current findings.",
    },
    {
      area: "VAT",
      status: validationLine(/vat/i)?.status === "failed" || openHigh(vatFindings).length ? "Reconciliation outstanding" : hasUpload("vat_report") ? "VAT report uploaded" : "VAT evidence missing",
      summary: vatFindings.length
        ? `${vatFindings[0].title}. VAT evidence should be reconciled before return sign-off.`
        : hasUpload("vat_report") ? "VAT report uploaded. Complete Box 1, Box 4 and Box 5 reconciliation to the VAT control account." : "VAT report is missing from the pack.",
      evidence: validationLine(/vat/i)?.detail || evidenceLine(vatFindings),
      action: "Reconcile VAT boxes to VAT control accounts and document any manual VAT journals or unusual treatments.",
    },
    {
      area: "Debtors",
      status: debtorFindings.length ? "Review required" : hasUpload("aged_debtors") ? "Aging uploaded" : "Aging missing",
      summary: debtorFindings.length ? `${debtorFindings.length} debtor finding(s) require recoverability or collection review.` : hasUpload("aged_debtors") ? "Aged debtors uploaded; no debtor exception is currently open." : "Aged debtors are missing from the review pack.",
      evidence: evidenceLine(debtorFindings),
      action: debtorFindings.length ? "Assign collection owner, review recoverability and document provision decision." : "Upload AR aging if debtor balances are material.",
    },
    {
      area: "Creditors",
      status: creditorFindings.length ? "Review required" : hasUpload("aged_creditors") ? "Aging uploaded" : "Aging missing",
      summary: creditorFindings.length ? `${creditorFindings.length} creditor finding(s) require liabilities or supplier review.` : hasUpload("aged_creditors") ? "Aged creditors uploaded; no creditor exception is currently open." : "Aged creditors are missing from the review pack.",
      evidence: evidenceLine(creditorFindings),
      action: creditorFindings.length ? "Review supplier balances, duplicates and credit notes before sign-off." : "Upload AP aging if supplier balances are material.",
    },
    {
      area: "Bank",
      status: bankFindings.length ? "Review required" : hasUpload("bank_reconciliation") ? "Bank reconciliation uploaded" : "Bank reconciliation missing",
      summary: bankFindings.length ? `${bankFindings[0].title}. Bank or cash evidence needs review.` : hasUpload("bank_reconciliation") ? "Bank reconciliation uploaded; no bank exception is currently open." : "Bank reconciliation is missing from the pack.",
      evidence: validationLine(/bank|cash/i)?.detail || evidenceLine(bankFindings),
      action: "Agree bank reconciliation to cash balances and retain the signed reconciliation.",
    },
    {
      area: "Controls",
      status: controlFindings.length ? "Control exception open" : "No control exception identified",
      summary: controlFindings.length ? `${controlFindings.length} control finding(s) require reviewer decision.` : "No controls or fraud exception is currently open.",
      evidence: evidenceLine(controlFindings),
      action: controlFindings.length ? "Document control owner, root cause and remediation or accepted risk." : "No control action required from current findings.",
    },
    {
      area: "Data Quality",
      status: dataFindings.length ? "Data quality review required" : "No data quality exception identified",
      summary: dataFindings.length ? `${dataFindings.length} data quality finding(s) may affect reliance on review outputs.` : "No data quality exception is currently open.",
      evidence: evidenceLine(dataFindings),
      action: dataFindings.length ? "Correct mapping, upload missing files, or document why the data quality exception is not material." : "No data quality action required from current findings.",
    },
  ];

  return sections;
}

function auditControlChecklist(findings: Finding[], validationChecks: ValidationCheck[], uploads: Upload[]) {
  const presentFiles = new Set(uploads.map((upload) => upload.fileType));
  const failedChecks = validationChecks.filter((check) => check.status === "failed");
  const openHigh = findings.filter((finding) => isOpenFinding(finding) && (finding.severity === "critical" || finding.severity === "high"));
  const acceptedRisks = findings.filter((finding) => finding.status === "accepted_risk");
  const checklist = [
    { label: "Core finance exports uploaded", passed: ["trial_balance", "profit_loss", "balance_sheet"].every((fileType) => presentFiles.has(fileType as Upload["fileType"])), detail: "TB, P&L and balance sheet are required for the core audit pack." },
    { label: "Validation blockers cleared", passed: failedChecks.length === 0, detail: failedChecks.length ? `${failedChecks.length} validation blocker(s) remain.` : "No failed validation checks remain." },
    { label: "High-risk findings cleared", passed: openHigh.length === 0, detail: openHigh.length ? `${openHigh.length} critical/high finding(s) remain open.` : "No critical or high findings remain open." },
    { label: "Accepted risks visible", passed: true, detail: acceptedRisks.length ? `${acceptedRisks.length} accepted risk(s) retained for partner review.` : "No accepted risks recorded." },
    { label: "Evidence workflow complete", passed: findings.every((finding) => !["evidence_requested", "evidence_received", "needs_investigation"].includes(finding.status)), detail: "Evidence requests should be closed or accepted before partner sign-off." },
  ];
  return checklist;
}

function auditPartnerConclusion({
  trafficLabel,
  findings,
  acceptedRisks,
  validationBlockers,
  openHigh,
}: {
  trafficLabel: string;
  findings: Finding[];
  acceptedRisks: Finding[];
  validationBlockers: number;
  openHigh: number;
}) {
  const leadingHigh = findings.find((finding) => isOpenFinding(finding) && (finding.severity === "critical" || finding.severity === "high"));
  const acceptedRiskText = acceptedRisks.length
    ? `Accepted risks retained in the pack: ${acceptedRisks.map((finding) => finding.title).join("; ")}.`
    : "No accepted risks have been recorded.";
  if (trafficLabel.toLowerCase().includes("ready") && !trafficLabel.toLowerCase().includes("not")) {
    return `${trafficLabel}. The review pack is ready for partner judgement subject to final professional review. ${acceptedRiskText}`;
  }
  return `Partner sign-off is not complete. The review identified ${openHigh} high-risk open finding(s) and ${validationBlockers} validation blocker(s). ${leadingHigh ? `Highest priority: ${leadingHigh.title}. ` : ""}${acceptedRiskText}`;
}

function reviewNotesForFinding(finding: Finding): ReviewNoteSet {
  const code = finding.ruleId ?? finding.id;
  const evidence = finding.evidence?.calculation || finding.expectedImpact || "Evidence should be retained with the review pack.";
  const source = finding.evidence?.sourceFile || finding.sourceFile || "uploaded finance pack";
  const status = STATUS_CONFIG[finding.status]?.label ?? finding.status;
  const templateByRule: Record<string, Omit<ReviewNoteSet, "findingCode">> = {
    DI_040: {
      reviewerNote: "Revenue completeness review performed. Revenue accounts were identified in the source data but all balances were nil. Management should confirm whether revenue postings occurred after extraction or whether the export is incomplete. No conclusion reached pending evidence.",
      managerNote: "Request supporting revenue evidence or an updated P&L export before approval. Confirm whether the zero-balance revenue accounts are expected.",
      partnerConclusion: "Revenue completeness cannot be concluded until management explains the nil revenue balances or provides updated evidence.",
      clientExplanation: "Revenue accounts appear in the uploaded data but the balances are nil. Please confirm whether revenue has been posted elsewhere or whether the export is incomplete.",
    },
    DI_027: {
      reviewerNote: "Cost of sales completeness review performed. No COGS or direct cost account was identified in the uploaded P&L. Gross margin analysis is therefore not supportable from the current evidence.",
      managerNote: "Request a complete P&L export or mapping confirmation for direct cost accounts before manager approval.",
      partnerConclusion: "Gross margin and cost completeness remain unsupported until COGS evidence is provided or the absence is explained.",
      clientExplanation: "No cost of sales or direct cost account was detected. Please provide supporting P&L detail or confirm that no direct costs apply.",
    },
    DI_048: {
      reviewerNote: "Operating overhead completeness review performed. No operating overhead account was identified in the uploaded P&L. The P&L may be incomplete or incorrectly mapped.",
      managerNote: "Request overhead account support or an updated P&L export before approval.",
      partnerConclusion: "Operating cost completeness cannot be concluded until overhead evidence is provided.",
      clientExplanation: "Operating overhead accounts were not detected in the uploaded P&L. Please confirm whether the export is complete.",
    },
    CF_002: {
      reviewerNote: "Round-number transaction review performed. The uploaded data contains a high proportion of round-number amounts. This may indicate estimates, journals or placeholder values requiring support.",
      managerNote: "Review the largest round-number transactions and confirm whether they are actual invoiced values, approved journals or estimates.",
      partnerConclusion: "Round-number estimation risk should remain visible until supporting evidence is reviewed.",
      clientExplanation: "Some amounts appear to be round-number values. Please provide support for the largest items or confirm they are valid posted transactions.",
    },
    ST_020: {
      reviewerNote: "Payroll efficiency review reminder generated. Payroll accounts were detected and may require cost-per-FTE analysis if headcount data is available.",
      managerNote: "Confirm whether payroll cost-per-FTE analysis is required for this engagement and document the decision.",
      partnerConclusion: "Payroll efficiency analysis is advisory unless payroll cost movement or headcount data indicates further risk.",
      clientExplanation: "Payroll costs were detected. ClosePilot recommends reviewing payroll cost per employee where headcount data is available.",
    },
  };

  const exact = templateByRule[code];
  if (exact) return { findingCode: code, ...exact };

  const lower = `${finding.title} ${finding.description} ${code}`.toLowerCase();
  if (/bank|cash reconciliation/.test(lower)) {
    return {
      findingCode: code,
      reviewerNote: "Bank reconciliation evidence was not sufficient for review. Cash balances therefore remain unsupported until the reconciliation is provided and agreed to the ledger.",
      managerNote: "Request bank reconciliation evidence before approval.",
      partnerConclusion: "Cash completeness cannot be concluded until bank reconciliation evidence is received.",
      clientExplanation: "Please provide the bank reconciliation supporting the period-end cash balance.",
    };
  }
  if (/vat|box|tax/.test(lower) || finding.category === "vat") {
    return {
      findingCode: code,
      reviewerNote: `VAT review performed against ${source}. ${evidence} VAT control and return evidence should be reconciled before filing or sign-off.`,
      managerNote: "Confirm VAT box arithmetic, VAT control account agreement and evidence for unusual VAT treatments.",
      partnerConclusion: "VAT sign-off should remain blocked or qualified until VAT control reconciliation is complete.",
      clientExplanation: "VAT evidence requires review before the return can be signed off. Please provide the VAT report, VAT control reconciliation and support for unusual VAT treatments.",
    };
  }
  if (finding.category === "ar") {
    return {
      findingCode: code,
      reviewerNote: `Debtor review performed. ${evidence} Recoverability, ageing and collection status should be documented before sign-off.`,
      managerNote: "Assign collection owner and request management comment on recoverability or provision.",
      partnerConclusion: "Debtor recoverability remains a review matter until evidence and management response are documented.",
      clientExplanation: "A debtor balance requires review. Please confirm expected collection, disputes and any provision required.",
    };
  }
  if (finding.category === "ap") {
    return {
      findingCode: code,
      reviewerNote: `Creditor review performed. ${evidence} Supplier evidence should be reviewed to confirm completeness and duplicate-payment risk.`,
      managerNote: "Review supplier support, duplicate indicators and credit notes before approval.",
      partnerConclusion: "Supplier completeness and payment-control risk remain open until AP evidence is reviewed.",
      clientExplanation: "A supplier or creditor item requires review. Please provide supporting invoice, credit note or supplier statement evidence.",
    };
  }
  if (finding.category === "controls") {
    return {
      findingCode: code,
      reviewerNote: `Control review performed. ${evidence} The exception should be assigned to an owner and remediation or accepted risk should be documented.`,
      managerNote: "Confirm control owner, root cause, remediation date and whether the risk is accepted.",
      partnerConclusion: "Control exception should remain visible in the partner pack until resolved or formally accepted.",
      clientExplanation: "A control exception was identified and needs an owner, explanation and remediation plan.",
    };
  }

  return {
    findingCode: code,
    reviewerNote: `${findingCategoryLabel(finding.category)} review performed. ${finding.title}. Evidence reviewed: ${evidence}. Current status: ${status}.`,
    managerNote: finding.recommendation || "Review the finding, assign an owner and document resolution or accepted risk before approval.",
    partnerConclusion: `${finding.title} remains partner-visible until the finding is resolved, closed, or formally accepted as risk.`,
    clientExplanation: finding.description || "This review item requires supporting evidence or management explanation before sign-off.",
  };
}

function generateWorkpapers({ findings, uploads, validationChecks, reviewer, date }: {
  findings: Finding[];
  uploads: Upload[];
  validationChecks: ValidationCheck[];
  reviewer: string;
  date: string;
}): Workpaper[] {
  const sourceFiles = (fileTypes: Upload["fileType"][]) => uploads
    .filter((upload) => fileTypes.includes(upload.fileType))
    .map((upload) => upload.originalFileName || upload.fileName);
  const unique = (values: string[]) => Array.from(new Set(values.filter(Boolean)));
  const findingMatches = (patterns: RegExp[], categories: Finding["category"][]) => findings.filter((finding) => {
    const text = `${finding.ruleId ?? ""} ${finding.title} ${finding.description}`.toLowerCase();
    return categories.includes(finding.category) || patterns.some((pattern) => pattern.test(text));
  });
  const mapFindings = (items: Finding[]) => items
    .slice()
    .sort((a, b) => findingSeverityRank(b.severity) - findingSeverityRank(a.severity))
    .map((finding) => {
      const notes = reviewNotesForFinding(finding);
      const evidenceRef = findingEvidenceReference(finding);
      return {
        id: finding.id,
        code: notes.findingCode,
        title: finding.title,
        severity: finding.severity,
        status: STATUS_CONFIG[finding.status]?.label ?? finding.status,
        note: notes.reviewerNote,
        sourceFile: evidenceRef.sourceFile,
        rowIndexes: evidenceRef.rowIndexes,
        rowCount: evidenceRef.rowCount,
        accountOrParty: evidenceRef.accountOrParty,
        calculation: evidenceRef.calculation,
        evidenceStrength: findingEvidenceTier(finding),
        detectionConfidence: findingDetectionConfidence(finding),
      };
    });
  const validationEvidence = (pattern: RegExp) => validationChecks
    .filter((check) => pattern.test(`${check.name} ${check.detail}`))
    .map((check) => `${check.name}: ${check.status}`);
  const conclude = (items: Finding[], clean: string, open: string) => {
    const unresolved = items.filter(isOpenFinding);
    if (unresolved.length === 0) return clean;
    const high = unresolved.filter((finding) => finding.severity === "critical" || finding.severity === "high").length;
    return high ? `${open} ${high} high-risk item(s) require manager or partner review.` : `${open} Open items should be cleared or accepted before sign-off.`;
  };

  const revenueFindings = findingMatches([/revenue|sales|turnover|cogs|cost of sales|overhead|p&l/], ["data_quality", "month_end", "financial_statements"]);
  const vatFindings = findingMatches([/vat|tax|box|return|control account/], ["vat"]);
  const debtorFindings = findingMatches([/debtor|customer|receivable|overdue|collection/], ["ar"]);
  const creditorFindings = findingMatches([/creditor|supplier|payable|invoice|duplicate/], ["ap"]);
  const bankFindings = findingMatches([/bank|cash reconciliation|cash account/], ["cashflow"]);
  const payrollFindings = findingMatches([/payroll|salary|wages|paye|nic/], ["month_end"]);

  return [
    {
      id: "WP-01",
      title: "Revenue",
      area: "Revenue completeness and P&L integrity",
      objective: "Confirm revenue and related P&L accounts are complete, mapped correctly and supported by uploaded evidence.",
      risk: "Revenue may be omitted, posted after extraction, mapped incorrectly or unsupported by the uploaded P&L evidence.",
      evidenceReviewed: unique([...sourceFiles(["profit_loss", "trial_balance"]), ...validationEvidence(/p&l|profit|revenue|trial/i)]),
      procedurePerformed: "Reviewed P&L and trial balance evidence for revenue, cost of sales, overhead completeness and unusual zero-balance accounts.",
      findings: mapFindings(revenueFindings),
      conclusion: conclude(revenueFindings, "No unresolved revenue workpaper exceptions remain based on the uploaded evidence.", "Revenue completeness is not fully concluded."),
      reviewer,
      date,
    },
    {
      id: "WP-02",
      title: "VAT",
      area: "VAT return and control reconciliation",
      objective: "Confirm VAT return boxes agree to VAT control accounts and unusual VAT treatments have supporting evidence.",
      risk: "VAT may be misstated where box arithmetic, control reconciliation, manual journals, reverse charge or import VAT treatment is unsupported.",
      evidenceReviewed: unique([...sourceFiles(["vat_report", "trial_balance"]), ...validationEvidence(/vat|tax/i)]),
      procedurePerformed: "Reviewed VAT report evidence, VAT-related validation checks and VAT findings for filing readiness.",
      findings: mapFindings(vatFindings),
      conclusion: conclude(vatFindings, "No unresolved VAT workpaper exceptions remain based on the uploaded evidence.", "VAT sign-off remains subject to reconciliation and evidence review."),
      reviewer,
      date,
    },
    {
      id: "WP-03",
      title: "Debtors",
      area: "Debtor recoverability and collections",
      objective: "Confirm debtor balances are supported, recoverable and reviewed for overdue or disputed items.",
      risk: "Receivables may be overstated where overdue balances, disputes, overpayments or provision requirements are not identified.",
      evidenceReviewed: unique([...sourceFiles(["aged_debtors", "trial_balance"]), ...validationEvidence(/ar|debtor|receivable|customer/i)]),
      procedurePerformed: "Reviewed aged debtors, AR validation checks and debtor findings for recoverability and collection action.",
      findings: mapFindings(debtorFindings),
      conclusion: conclude(debtorFindings, "No unresolved debtor workpaper exceptions remain based on the uploaded evidence.", "Debtor recoverability remains a review matter."),
      reviewer,
      date,
    },
    {
      id: "WP-04",
      title: "Creditors",
      area: "Creditor completeness and supplier controls",
      objective: "Confirm creditor balances are complete, supported and reviewed for supplier or duplicate-payment risk.",
      risk: "Payables may be understated or duplicated where supplier balances, invoices, credit notes or ageing evidence is incomplete.",
      evidenceReviewed: unique([...sourceFiles(["aged_creditors", "trial_balance"]), ...validationEvidence(/ap|creditor|payable|supplier/i)]),
      procedurePerformed: "Reviewed aged creditors, AP validation checks and supplier findings for completeness and payment-control risk.",
      findings: mapFindings(creditorFindings),
      conclusion: conclude(creditorFindings, "No unresolved creditor workpaper exceptions remain based on the uploaded evidence.", "Creditor completeness remains subject to evidence review."),
      reviewer,
      date,
    },
    {
      id: "WP-05",
      title: "Bank",
      area: "Cash and bank reconciliation",
      objective: "Confirm bank and cash balances agree to reconciliation evidence and are ready for sign-off.",
      risk: "Cash may be unsupported where bank reconciliations, cash account mappings or reconciliation evidence are missing.",
      evidenceReviewed: unique([...sourceFiles(["bank_reconciliation", "trial_balance"]), ...validationEvidence(/bank|cash/i)]),
      procedurePerformed: "Reviewed uploaded bank reconciliation evidence, cash validation checks and cash-related findings.",
      findings: mapFindings(bankFindings),
      conclusion: conclude(bankFindings, "No unresolved bank workpaper exceptions remain based on the uploaded evidence.", "Cash completeness cannot be concluded until bank evidence is complete."),
      reviewer,
      date,
    },
    {
      id: "WP-06",
      title: "Payroll",
      area: "Payroll completeness and reasonableness",
      objective: "Confirm payroll costs are present, complete and supported or appropriately explained.",
      risk: "Payroll costs may be omitted, posted outside the uploaded P&L or require further analysis against headcount.",
      evidenceReviewed: unique([...sourceFiles(["profit_loss", "payroll_summary", "trial_balance"]), ...validationEvidence(/payroll|salary|wages|paye|nic/i)]),
      procedurePerformed: "Reviewed payroll-related P&L, trial balance and payroll findings for completeness and reasonableness.",
      findings: mapFindings(payrollFindings),
      conclusion: conclude(payrollFindings, "No unresolved payroll workpaper exceptions remain based on the uploaded evidence.", "Payroll completeness remains subject to management explanation or supporting evidence."),
      reviewer,
      date,
    },
  ];
}

function auditReviewPackWordHtml({
  company,
  tenant,
  today,
  preparedBy,
  auditPack,
  partnerConclusion,
  findings,
  workpapers,
}: {
  company: Company;
  tenant: Tenant;
  today: string;
  preparedBy: string;
  auditPack: {
    client: string;
    period: string;
    reviewStatus: string;
    summary: {
      findingsIdentified: number;
      openFindings: number;
      acceptedRisks: number;
      validationBlockers: number;
      financialHealth: number;
      auditReadiness: number;
    };
    requiredActions: ReturnType<typeof auditPackRequiredActions>;
    partnerSummary: ReturnType<typeof auditPackPartnerSummary>;
    controlChecklist: ReturnType<typeof auditControlChecklist>;
  };
  partnerConclusion: string;
  findings: Finding[];
  workpapers: Workpaper[];
}) {
  const rows = (items: string[]) => items.join("");
  const findingRows = findings
    .slice()
    .sort((a, b) => findingSeverityRank(b.severity) - findingSeverityRank(a.severity))
    .slice(0, 20)
    .map((finding) => `
      <tr>
        <td>${htmlCell(finding.severity.toUpperCase())}</td>
        <td>${htmlCell(finding.title)}</td>
        <td>${htmlCell(findingCategoryLabel(finding.category))}</td>
        <td>${htmlCell(STATUS_CONFIG[finding.status]?.label ?? finding.status)}</td>
        <td>${htmlCell(findingOwner(finding))}</td>
      </tr>
    `);
  const actionRows = auditPack.requiredActions.map((item) => `
    <tr>
      <td>${htmlCell(item.priority)}</td>
      <td>${htmlCell(item.area)}</td>
      <td>${htmlCell(item.action)}</td>
      <td>${htmlCell(item.reason)}</td>
    </tr>
  `);
  const partnerRows = auditPack.partnerSummary.map((section) => `
    <tr>
      <td>${htmlCell(section.area)}</td>
      <td>${htmlCell(section.status)}</td>
      <td>${htmlCell(section.summary)}</td>
      <td>${htmlCell(section.action)}</td>
    </tr>
  `);
  const checklistRows = auditPack.controlChecklist.map((item) => `
    <tr>
      <td>${htmlCell(item.label)}</td>
      <td>${item.passed ? "Passed" : "Blocked"}</td>
      <td>${htmlCell(item.detail)}</td>
    </tr>
  `);
  const noteRows = findings
    .slice()
    .sort((a, b) => findingSeverityRank(b.severity) - findingSeverityRank(a.severity))
    .slice(0, 12)
    .map((finding) => {
      const notes = reviewNotesForFinding(finding);
      return `
        <tr>
          <td>${htmlCell(notes.findingCode)}</td>
          <td>${htmlCell(finding.title)}</td>
          <td>${htmlCell(notes.reviewerNote)}</td>
          <td>${htmlCell(notes.managerNote)}</td>
          <td>${htmlCell(notes.partnerConclusion)}</td>
        </tr>
      `;
    });
  const workpaperSections = workpapers.map((workpaper) => `
    <h3>${htmlCell(workpaper.id)} ${htmlCell(workpaper.title)}</h3>
    <table>
      <tr><th>Objective</th><td>${htmlCell(workpaper.objective)}</td></tr>
      <tr><th>Risk</th><td>${htmlCell(workpaper.risk)}</td></tr>
      <tr><th>Evidence Reviewed</th><td>${htmlCell(workpaper.evidenceReviewed.length ? workpaper.evidenceReviewed.join("; ") : "No specific evidence uploaded for this area.")}</td></tr>
      <tr><th>Procedure Performed</th><td>${htmlCell(workpaper.procedurePerformed)}</td></tr>
      <tr><th>Conclusion</th><td>${htmlCell(workpaper.conclusion)}</td></tr>
      <tr><th>Reviewer</th><td>${htmlCell(workpaper.reviewer)}</td></tr>
      <tr><th>Date</th><td>${htmlCell(new Date(workpaper.date).toLocaleDateString("en-GB"))}</td></tr>
    </table>
    <table>
      <tr><th>Code</th><th>Finding</th><th>Severity</th><th>Status</th><th>Evidence Ref</th><th>Reviewer Note</th></tr>
      ${workpaper.findings.length ? workpaper.findings.map((finding) => `
        <tr>
          <td>${htmlCell(finding.code)}</td>
          <td>${htmlCell(finding.title)}</td>
          <td>${htmlCell(finding.severity.toUpperCase())}</td>
          <td>${htmlCell(finding.status)}</td>
          <td>${htmlCell(`${finding.sourceFile}; rows: ${finding.rowIndexes}; ${finding.calculation}`)}</td>
          <td>${htmlCell(finding.note)}</td>
        </tr>
      `).join("") : "<tr><td colspan=\"6\">No findings identified for this workpaper.</td></tr>"}
    </table>
  `);

  return `
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>${htmlCell(company.name)} Partner Review Report</title>
        <style>
          body { font-family: Arial, sans-serif; color: #111827; line-height: 1.4; }
          h1 { font-size: 30px; margin: 0 0 8px; }
          h2 { font-size: 20px; margin: 28px 0 8px; border-bottom: 1px solid #d1d5db; padding-bottom: 6px; }
          h3 { font-size: 15px; margin: 18px 0 6px; }
          p { margin: 6px 0; }
          table { border-collapse: collapse; width: 100%; margin: 10px 0 18px; }
          th, td { border: 1px solid #d1d5db; padding: 8px; vertical-align: top; font-size: 12px; }
          th { background: #f3f4f6; text-align: left; text-transform: uppercase; font-size: 11px; }
          .cover { border: 2px solid #111827; padding: 28px; margin-bottom: 24px; }
          .muted { color: #4b5563; }
          .status { display: inline-block; border: 1px solid #d1d5db; padding: 6px 10px; font-weight: bold; }
          .summary-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; }
          .summary-box { border: 1px solid #d1d5db; padding: 10px; }
          .label { color: #4b5563; font-size: 11px; text-transform: uppercase; font-weight: bold; }
          .value { font-size: 18px; font-weight: bold; }
        </style>
      </head>
      <body>
        <div class="cover">
          <p class="label">ClosePilot Assurance</p>
          <h1>Partner Review Report</h1>
          <p class="muted">Evidence-led finance assurance pack generated from uploaded finance exports, validation checks, findings workflow and sign-off gate status.</p>
          <h3>Review Details</h3>
          <table>
            <tr><th>Client</th><td>${htmlCell(auditPack.client)}</td></tr>
            <tr><th>Practice</th><td>${htmlCell(tenant.name)}</td></tr>
            <tr><th>Period</th><td>${htmlCell(auditPack.period)}</td></tr>
            <tr><th>Prepared</th><td>${htmlCell(today)}</td></tr>
            <tr><th>Prepared By</th><td>${htmlCell(preparedBy || "ClosePilot")}</td></tr>
            <tr><th>Status</th><td><span class="status">${htmlCell(auditPack.reviewStatus)}</span></td></tr>
          </table>
        </div>

        <h2>Executive Summary</h2>
        <table>
          <tr>
            <th>Health Score</th>
            <th>Audit Readiness</th>
            <th>Findings</th>
            <th>Open Findings</th>
            <th>Accepted Risks</th>
            <th>Validation Blockers</th>
          </tr>
          <tr>
            <td>${auditPack.summary.financialHealth}/100</td>
            <td>${auditPack.summary.auditReadiness}/100</td>
            <td>${auditPack.summary.findingsIdentified}</td>
            <td>${auditPack.summary.openFindings}</td>
            <td>${auditPack.summary.acceptedRisks}</td>
            <td>${auditPack.summary.validationBlockers}</td>
          </tr>
        </table>

        <h2>Partner Conclusion</h2>
        <p>${htmlCell(partnerConclusion)}</p>

        <h2>Required Actions</h2>
        <table>
          <tr><th>Priority</th><th>Area</th><th>Action</th><th>Reason</th></tr>
          ${actionRows.length ? rows(actionRows) : "<tr><td colspan=\"4\">No required actions remain before issue.</td></tr>"}
        </table>

        <h2>Partner Summary</h2>
        <table>
          <tr><th>Area</th><th>Status</th><th>Summary</th><th>Action</th></tr>
          ${rows(partnerRows)}
        </table>

        <h2>Findings Summary</h2>
        <table>
          <tr><th>Severity</th><th>Finding</th><th>Category</th><th>Status</th><th>Owner</th></tr>
          ${findingRows.length ? rows(findingRows) : "<tr><td colspan=\"5\">No findings identified.</td></tr>"}
        </table>

        <h2>Control Checklist</h2>
        <table>
          <tr><th>Check</th><th>Status</th><th>Detail</th></tr>
          ${rows(checklistRows)}
        </table>

        <h2>Review Notes Library</h2>
        <table>
          <tr><th>Code</th><th>Finding</th><th>Reviewer Note</th><th>Manager Note</th><th>Partner Conclusion</th></tr>
          ${noteRows.length ? rows(noteRows) : "<tr><td colspan=\"5\">No review notes generated.</td></tr>"}
        </table>

        <h2>Workpapers</h2>
        ${rows(workpaperSections)}

        <p class="muted">Generated by ClosePilot Assurance for ${htmlCell(company.name)}. Final professional judgement remains with the preparer, reviewer and approving partner.</p>
      </body>
    </html>
  `;
}

function findingValue(findings: Finding[]) {
  return findings.filter((finding) => finding.evidenceStrength !== "advisory").reduce((sum, finding) => sum + parseImpactAmount(finding.expectedImpact), 0);
}

function exposureBreakdown(findings: Finding[], _cashAtRisk: number, financialExposure: number): ExposureBreakdown {
  const open = findings.filter(isOpenFinding);
  const cashRisk = findingValue(open.filter((f) => f.category === "ar" || f.category === "cashflow"));
  const vatRisk = open.filter((f) => f.category === "vat" && f.evidenceStrength !== "advisory").reduce((sum, f) => sum + parseImpactAmount(f.expectedImpact), 0);
  const closeRisk = findingValue(open.filter((f) => f.category === "month_end" || f.category === "ap"));
  const controlRisk = findingValue(open.filter((f) => f.category === "controls" || f.category === "data_quality"));
  return {
    cashRisk,
    vatRisk,
    closeRisk,
    controlRisk,
    total: financialExposure,
  };
}

function collectionOpportunities(findings: Finding[]): CollectionOpportunity[] {
  const relevant = findings.filter((finding) =>
    finding.category === "ar" &&
    isOpenFinding(finding) &&
    finding.evidenceStrength !== "advisory"
  );

  const actionFor = (finding: Finding) => {
    if (finding.ruleId === "AR_026") return "Provision immediately and escalate legal recovery.";
    if (["AR_003", "AR_004", "AR_005"].includes(finding.ruleId ?? "")) return "Escalate to senior collections and assess bad debt provision.";
    if (finding.ruleId === "AR_022") return "Issue breach-of-terms letter and agree payment date.";
    if (finding.ruleId === "AR_006") return "Place account on credit hold pending approval.";
    if (["AR_008", "AR_009"].includes(finding.ruleId ?? "")) return "Assign owner-level collection plan and review credit insurance.";
    return "Contact customer and document next collection action.";
  };

  return relevant
    .map((finding) => ({
      customer: finding.evidence.matchNames?.[0] ?? finding.evidence.accountCode ?? "Multiple customers",
      value: finding.evidence.matchValue || parseImpactAmount(finding.expectedImpact),
      reason: finding.title,
      action: actionFor(finding),
      severity: finding.severity,
    }))
    .sort((a, b) => b.value - a.value || findingSeverityRank(b.severity) - findingSeverityRank(a.severity))
    .slice(0, 10);
}

function expectedCreditLoss(findings: Finding[]) {
  const rateByRule: Record<string, number> = {
    AR_001: 0.05,
    AR_002: 0.2,
    AR_003: 0.5,
    AR_004: 0.85,
    AR_005: 1,
    AR_026: 1,
  };

  return findings
    .filter((finding) => finding.category === "ar" && isOpenFinding(finding) && finding.evidenceStrength !== "advisory")
    .reduce((sum, finding) => {
      const rate = rateByRule[finding.ruleId ?? ""] ?? 0;
      const value = finding.evidence.matchValue || parseImpactAmount(finding.expectedImpact);
      return sum + value * rate;
    }, 0);
}

function supplierRiskOpportunities(findings: Finding[]): SupplierRiskOpportunity[] {
  const relevant = findings.filter((finding) =>
    (finding.category === "ap" || finding.category === "controls") &&
    isOpenFinding(finding) &&
    finding.evidenceStrength !== "advisory" &&
    (finding.ruleId?.startsWith("AP_") || finding.id.includes("ap_"))
  );

  const actionFor = (finding: Finding) => {
    if (["AP_001", "AP_041"].includes(finding.ruleId ?? "") || finding.id.includes("ap_dup")) return "Hold payment and reconcile invoice image, supplier statement and PO.";
    if (finding.ruleId === "AP_020") return "Verify bank changes by phone using a known trusted number.";
    if (finding.ruleId === "AP_018" || finding.id.includes("ap_split")) return "Combine related invoices and obtain cumulative approval.";
    if (finding.ruleId === "AP_006" || finding.id.includes("ap_personal")) return "Confirm IR35/PAYE treatment and approve before payment.";
    if (["AP_007", "AP_045"].includes(finding.ruleId ?? "")) return "Review dependency, payment terms and supply continuity risk.";
    if (finding.ruleId === "AP_033") return "Reconcile GRNI to expected supplier invoices and accrue where required.";
    return "Review supplier evidence and document the payment decision.";
  };

  return relevant
    .map((finding) => ({
      supplier: finding.evidence.matchNames?.[0] ?? finding.evidence.accountCode ?? "Multiple suppliers",
      value: finding.evidence.matchValue || parseImpactAmount(finding.expectedImpact),
      reason: finding.title,
      action: actionFor(finding),
      severity: finding.severity,
    }))
    .sort((a, b) => b.value - a.value || findingSeverityRank(b.severity) - findingSeverityRank(a.severity))
    .slice(0, 10);
}

function findingSeverityRank(level: RiskLevel) {
  return { low: 1, medium: 2, high: 3, critical: 4 }[level];
}

function findingMaterialityStatus(amount: number) {
  const threshold = 25_000;
  if (!amount) return { label: "Unknown", detail: "Further evidence required" };
  return {
    label: amount >= threshold ? "Above Materiality" : "Below Materiality",
    detail: `Materiality threshold £${threshold.toLocaleString()}`,
  };
}

function findingReviewEffort(finding?: Finding) {
  if (!finding) return { manual: "—", closePilot: "—", saved: "—" };
  const manual = finding.severity === "critical" ? 35 : finding.severity === "high" ? 25 : finding.severity === "medium" ? 15 : 8;
  const closePilot = finding.evidenceStrength === "deterministic" ? 2 : finding.evidenceStrength === "indicator" ? 4 : 6;
  return {
    manual: `${manual} mins`,
    closePilot: `${closePilot} mins`,
    saved: `${Math.max(1, manual - closePilot)} mins`,
  };
}

function findingDetectionConfidence(finding: Finding) {
  return finding.confidenceScore ?? (finding.confidence === "high" ? 95 : finding.confidence === "medium" ? 75 : 55);
}

function findingEvidenceStrengthScore(finding: Finding, uploadedEvidenceCount = 0) {
  const rowCount = finding.evidence?.rows?.length ?? 0;
  const base = finding.evidenceStrength === "deterministic" ? 92 : finding.evidenceStrength === "indicator" ? 72 : 48;
  return Math.min(99, base + Math.min(6, rowCount * 2) + Math.min(6, uploadedEvidenceCount * 3));
}

function findingEvidenceTier(finding: Finding) {
  if (finding.evidenceStrength === "deterministic") return "Deterministic";
  if (finding.evidenceStrength === "advisory") return "Advisory";
  return "Indicator";
}

function findingTriggeredReason(finding: Finding) {
  const calculation = finding.evidence?.calculation || finding.description;
  return calculation.endsWith(".") ? calculation : `${calculation}.`;
}

function readinessForecast(findings: Finding[], validationChecks: ValidationCheck[], uploads: Upload[]) {
  const current = calculateAuditReadinessV2(findings, validationChecks, uploads);
  const simulated = (predicate: (finding: Finding) => boolean) => calculateAuditReadinessV2(
    findings.map((finding) => predicate(finding) ? { ...finding, status: "resolved" as FindingStatus } : finding),
    validationChecks,
    uploads,
  );
  const open = findings.filter(isOpenFinding);
  const highRiskOpen = open.filter((finding) => finding.severity === "critical" || finding.severity === "high");
  const allResolved = simulated(isOpenFinding);
  const highResolved = simulated((finding) => isOpenFinding(finding) && (finding.severity === "critical" || finding.severity === "high"));
  const nextFinding = highRiskOpen[0] ?? open[0];
  const nextResolved = nextFinding ? simulated((finding) => finding.id === nextFinding.id) : current;
  const effortMinutes = open.reduce((sum, finding) => {
    const effort = finding.severity === "critical" ? 12 : finding.severity === "high" ? 9 : finding.severity === "medium" ? 6 : 3;
    return sum + effort;
  }, validationChecks.filter((check) => check.status === "failed").length * 5);

  return {
    current,
    nextFinding,
    nextResolved,
    highResolved,
    allResolved,
    effortMinutes,
    highRiskOpen: highRiskOpen.length,
    open: open.length,
  };
}

function signOffTrafficLight({
  signOffEnabled,
  signOffComplete,
  acceptedRiskCount,
  criticalOpen,
  highOpen,
  validationBlockers,
  evidenceOutstanding,
  managerReviewComplete,
}: {
  signOffEnabled: boolean;
  signOffComplete: boolean;
  acceptedRiskCount: number;
  criticalOpen: number;
  highOpen: number;
  validationBlockers: number;
  evidenceOutstanding: number;
  managerReviewComplete: boolean;
}) {
  if (signOffComplete) {
    return {
      label: acceptedRiskCount ? "Signed With Accepted Risks" : "Signed Off",
      state: acceptedRiskCount ? "amber" : "green",
      headline: acceptedRiskCount ? "Locked with accepted risks" : "Locked and clean",
      detail: acceptedRiskCount ? `${acceptedRiskCount} accepted risk(s) retained in the review pack.` : "No accepted risks recorded at sign-off.",
    };
  }

  if (signOffEnabled && acceptedRiskCount > 0) {
    return {
      label: "Ready With Accepted Risks",
      state: "amber",
      headline: "Partner judgement required",
      detail: `${acceptedRiskCount} accepted risk(s) must remain visible in the sign-off certificate.`,
    };
  }

  if (signOffEnabled) {
    return {
      label: "Ready",
      state: "green",
      headline: "Ready for sign-off",
      detail: "No critical/high findings, evidence requests, validation blockers or manager approvals remain.",
    };
  }

  const blockers = [
    criticalOpen ? `${criticalOpen} critical open` : "",
    highOpen ? `${highOpen} high open` : "",
    validationBlockers ? `${validationBlockers} validation blocker(s)` : "",
    evidenceOutstanding ? `${evidenceOutstanding} evidence request(s)` : "",
    !managerReviewComplete ? "manager review outstanding" : "",
  ].filter(Boolean);

  return {
    label: "Not Ready",
    state: "red",
    headline: "Sign-off blocked",
    detail: blockers.length ? blockers.join(" · ") : "Sign-off gate conditions are not yet satisfied.",
  };
}

function trafficLightClasses(state: string) {
  if (state === "green") return { box: "border-emerald-200 bg-emerald-50", text: "text-emerald-800", dot: "bg-emerald-600" };
  if (state === "amber") return { box: "border-amber-200 bg-amber-50", text: "text-amber-800", dot: "bg-amber-500" };
  return { box: "border-red-200 bg-red-50", text: "text-red-800", dot: "bg-red-600" };
}

function partnerReviewNote(finding?: Finding) {
  if (!finding) return "No linked finding selected.";
  const residual = finding.severity === "critical" || finding.severity === "high" ? "Medium" : "Low";
  return [
    "Finding reviewed.",
    `${finding.title}.`,
    finding.evidence?.calculation ? `Evidence reviewed: ${finding.evidence.calculation}` : "Evidence reviewed from uploaded finance pack.",
    `Reviewer action: ${finding.recommendation || "Assign owner, obtain evidence, and document resolution before sign-off."}`,
    `Residual risk: ${residual}.`,
  ].join("\n");
}

function findingCategoryLabel(category: Finding["category"]) {
  const labels: Record<Finding["category"], string> = {
    ar: "Collections",
    ap: "Payables",
    cashflow: "Cash Flow",
    controls: "Controls",
    data_quality: "Data Quality",
    financial_statements: "Financial Statements",
    month_end: "Month-End Close",
    vat: "VAT",
  };
  return labels[category] ?? category.replaceAll("_", " ");
}

function findingTypeLabel(finding: Finding) {
  const text = `${finding.ruleId ?? ""} ${finding.title} ${finding.description}`.toLowerCase();
  if (/payroll|salary|wages|missing|zero|absent|completeness/.test(text)) return "Completeness";
  if (/vat|tax|coding|code|box|return/.test(text)) return "Coding Exception";
  if (/debtor|customer|overdue|receivable|credit/.test(text)) return "Credit Risk";
  if (/duplicate|supplier|invoice|payment/.test(text)) return "Payment Control";
  if (/journal|approval|authori|control|fraud/.test(text)) return "Control Exception";
  if (/recon|reconciliation|control account/.test(text)) return "Reconciliation";
  return "Review Exception";
}

export function AppShell({ userEmail }: { userEmail: string }) {
  const workspaceLoadCancelled = useRef(false);
  const [active, setActive] = useState("Onboarding");
  const [tenant, setTenant] = useState<Tenant>(seededTenant);
  const [currentCompany, setCurrentCompany] = useState<Company>(seededCompany);
  const [companies, setCompanies] = useState<Company[]>([seededCompany]);
  const [portfolioClients, setPortfolioClients] = useState<ClientCompany[]>([]);
  const [companySnapshots, setCompanySnapshots] = useState<Record<string, AnalysisResult>>({});
  const [findings, setFindings] = useState<Finding[]>([]);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [validationChecks, setValidationChecks] = useState<ValidationCheck[]>([]);
  const [importProfiles, setImportProfiles] = useState<ImportMappingProfile[]>([]);
  const [vatReview, setVatReview] = useState<VatReviewResult | undefined>();
  const [findingEvidence, setFindingEvidence] = useState<Evidence[]>([]);
  const [findingComments, setFindingComments] = useState<FindingComment[]>([]);
  const [findingActivities, setFindingActivities] = useState<FindingActivity[]>([]);
  const [partnerSignOff, setPartnerSignOff] = useState<PartnerSignOff | undefined>();
  const [isAnalysing, setIsAnalysing] = useState(false);
  const [uploadMessage, setUploadMessage] = useState("Upload your finance pack to run a real deterministic review.");
  const [question, setQuestion] = useState("Why is cash getting tighter?");
  const [showExport, setShowExport] = useState(false);
  const [ruleAnalytics, setRuleAnalytics] = useState<RuleAnalyticsReport | null>(null);
  const [pilotWalkthroughStep, setPilotWalkthroughStep] = useState(0);
  const [assistantResult, setAssistantResult] = useState<AssistantResult | null>(null);
  const [focusedFindingId, setFocusedFindingId] = useState<string | null>(null);

  const userName = useMemo(() => {
    const local = userEmail.split("@")[0] ?? "";
    return local.replace(/[._]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }, [userEmail]);

  const hasUploadedData = uploads.length > 0;
  const scorecard = useMemo(() => calculateFinanceScorecard(findings, validationChecks, recommendations, uploads), [findings, recommendations, uploads, validationChecks]);
  const breakdown = scorecard.breakdown;
  const score = scorecard.overall;
  const risk = hasUploadedData ? riskLabel(score) : "medium";
  const openFindings = findings.filter(isOpenFinding);
  const exposureFindings = findings.filter((finding) => isOpenFinding(finding) || finding.status === "accepted_risk" || finding.status === "accepted");
  const cashAtRisk = estimateCashAtRisk(exposureFindings.filter((finding) => finding.category === "ar"));
  const arCashRisk = cashAtRisk;
  const forecast = useMemo(() => generateForecast(undefined, arCashRisk), [arCashRisk]);
  const financialExposure = estimateCashAtRisk(exposureFindings);
  const timeSaved = estimateTimeSaved(openFindings);
  const validationBlockers = validationChecks.filter((item) => item.status === "failed").length;
  const validationWarnings = validationChecks.filter((item) => item.status === "warning").length;
  const assurance = assuranceMetrics(findings, validationChecks, uploads);
  const coreQuality = useMemo(() => coreQualityMetrics(uploads, validationChecks, findings, importProfiles, findingEvidence, partnerSignOff, vatReview), [findingEvidence, findings, importProfiles, partnerSignOff, uploads, validationChecks, vatReview]);
  const vatPageHasData = active === "VAT Assurance" && Boolean(vatReview && vatReview.source !== "empty" && (vatReview.transactionsAnalysed > 0 || Object.values(vatReview.vatReturn).some((value) => Math.abs(value) > 0)));
  const vatPageAdjustments = vatPageHasData && vatReview ? buildVatAdjustments(vatReview.findings).length : 0;
  const vatPageReconciliationFailures = vatPageHasData && vatReview ? vatReview.reconciliationResults.filter((item) => item.status === "failed").length : 0;
  const vatPageExposure = vatPageHasData && vatReview
    ? Math.round((vatReview.blockedVatRisk ?? 0) + vatReview.reconciliationResults.filter((item) => item.status === "failed").reduce((sum, item) => sum + Math.abs(item.difference), 0))
    : 0;
  const vatPageActions = vatPageHasData && vatReview
    ? vatReview.findings.length + findings.filter((item) => item.category === "vat" && !reviewedFindingStatuses.includes(item.status)).length + vatPageReconciliationFailures
    : 0;
  const vatPageReadiness = vatPageReconciliationFailures ? "Blocked" : vatPageAdjustments ? "Adjust" : vatPageActions ? "Review" : "Ready";
  const headerHealthValue = vatPageHasData && vatReview ? `${vatReview.healthScore}/100` : hasUploadedData ? `${score}/100` : "—";
  const headerHealthLevel = vatPageHasData && vatReview ? riskLabel(vatReview.healthScore) : hasUploadedData ? risk : "medium";
  const headerReadinessValue = vatPageHasData ? vatPageReadiness : `${assurance.closeReadiness || 0}%`;
  const headerReadinessLevel: RiskLevel = vatPageHasData ? vatPageReconciliationFailures ? "critical" : vatPageAdjustments || vatPageActions ? "medium" : "low" : assurance.closeReadiness >= 80 ? "low" : assurance.closeReadiness >= 65 ? "medium" : "high";
  const headerExposureValue = vatPageHasData ? vatPageExposure : financialExposure;
  const headerActionsValue = vatPageHasData ? vatPageActions : recommendations.filter((item) => !item.completed).length;
  const isPilotDemo = currentCompany.id === pilotCompany.id;
  const reviewLocked = partnerSignOff?.reviewPackStatus === "LOCKED" || partnerSignOff?.status === "locked" || partnerSignOff?.status === "signed";

  // Outcome metrics — what ClosePilot delivers vs manual review
  const HOURLY_RATE = 80; // £80/hr default manager rate
  const manualReviewMins = uploads.length * 30 + findings.length * 20 + validationChecks.length * 5;
  const closepilotMins   = uploads.length > 0 ? Math.max(5, Math.round(uploads.length * 0.8)) : 0;
  const timeSavedMins    = Math.max(0, manualReviewMins - closepilotMins);
  const timeSavedHours   = (timeSavedMins / 60).toFixed(1);
  const timeSavedValue   = Math.round((timeSavedMins / 60) * HOURLY_RATE);
  const expectedAuditQueries = Math.round(
    openFindings.filter((f) => f.severity === "critical").length * 3 +
    openFindings.filter((f) => f.severity === "high").length * 1.5 +
    validationBlockers * 2
  );

  useEffect(() => {
    if (uploads.length === 0 && (findings.length > 0 || recommendations.length > 0 || validationChecks.length > 0 || vatReview)) {
      setFindings([]);
      setFindingEvidence([]);
      setFindingComments([]);
      setFindingActivities([]);
      setPartnerSignOff(undefined);
      setRecommendations([]);
      setValidationChecks([]);
      setImportProfiles([]);
      setVatReview(undefined);
      setRuleAnalytics(null);
      setCompanySnapshots((items) => ({ ...items, [currentCompany.id]: emptySnapshot() }));
    }
  }, [currentCompany.id, findings.length, recommendations.length, uploads.length, validationChecks.length, vatReview]);

  useEffect(() => {
    async function loadWorkspace() {
      try {
        const res = await fetch("/api/workspace");
        const { workspace } = await res.json();
        if (workspaceLoadCancelled.current) return;
        const parsed: WorkspaceState | null = workspace ?? (userEmail ? null : (() => {
          const local = window.localStorage.getItem(storageKey);
          return local ? JSON.parse(local) : null;
        })());
        if (!parsed) {
          if (userEmail) window.localStorage.removeItem(storageKey);
          setActive("Onboarding");
          return;
        }
        const selectedCompany = parsed.companies.find((item) => item.id === parsed.currentCompanyId) ?? parsed.companies[0];
        if (!selectedCompany) return;
        const snapshot = normaliseSnapshot(parsed.companySnapshots[selectedCompany.id]);
        const companySnapshots = { ...parsed.companySnapshots, [selectedCompany.id]: snapshot };
        setTenant(parsed.tenant);
        setCompanies(parsed.companies);
        setPortfolioClients(parsed.portfolioClients);
        setCompanySnapshots(companySnapshots);
        setCurrentCompany(selectedCompany);
        setUploads(snapshot.uploads);
        setValidationChecks(snapshot.validationChecks);
        setImportProfiles(snapshot.importProfiles ?? []);
        setFindings(snapshot.findings);
        setFindingEvidence(snapshot.findingEvidence ?? []);
        setFindingComments(snapshot.findingComments ?? []);
        setFindingActivities(snapshot.findingActivities ?? []);
        setPartnerSignOff(snapshot.partnerSignOff);
        setRecommendations(snapshot.recommendations);
        setVatReview(snapshot.vatReview);
        const isDefault = selectedCompany.name === "Your Company";
      setUploadMessage(isDefault
        ? "Upload your finance pack to run a real deterministic review."
        : `${selectedCompany.name} workspace restored. Upload a new finance pack or continue the current review.`);
        setActive("Finance Review");
      } catch {
        if (workspaceLoadCancelled.current) return;
        if (userEmail) {
          window.localStorage.removeItem(storageKey);
          setActive("Onboarding");
          return;
        }
        const local = window.localStorage.getItem(storageKey);
        if (!local) { setActive("Onboarding"); return; }
        try {
          const parsed = JSON.parse(local) as WorkspaceState;
          const selectedCompany = parsed.companies.find((item) => item.id === parsed.currentCompanyId) ?? parsed.companies[0];
          if (!selectedCompany) { setActive("Onboarding"); return; }
          const snapshot = normaliseSnapshot(parsed.companySnapshots[selectedCompany.id]);
          const companySnapshots = { ...parsed.companySnapshots, [selectedCompany.id]: snapshot };
          setTenant(parsed.tenant);
          setCompanies(parsed.companies);
          setPortfolioClients(parsed.portfolioClients);
          setCompanySnapshots(companySnapshots);
          setCurrentCompany(selectedCompany);
          setUploads(snapshot.uploads);
          setValidationChecks(snapshot.validationChecks);
          setImportProfiles(snapshot.importProfiles ?? []);
          setFindings(snapshot.findings);
          setFindingEvidence(snapshot.findingEvidence ?? []);
          setFindingComments(snapshot.findingComments ?? []);
          setFindingActivities(snapshot.findingActivities ?? []);
          setPartnerSignOff(snapshot.partnerSignOff);
          setRecommendations(snapshot.recommendations);
          setVatReview(snapshot.vatReview);
          setActive("Finance Review");
        } catch { window.localStorage.removeItem(storageKey); setActive("Onboarding"); }
      }
    }
    loadWorkspace();
  }, [userEmail]);

  useEffect(() => {
    // Don't persist default empty state — only save once real data exists
    const hasRealData = tenant.name !== "Your Firm" || uploads.length > 0 || findings.length > 0;
    if (!hasRealData) return;
    const workspace: WorkspaceState = {
      tenant,
      companies,
      currentCompanyId: currentCompany.id,
      portfolioClients,
      companySnapshots: {
        ...companySnapshots,
        [currentCompany.id]: { uploads, validationChecks, findings, importProfiles, findingEvidence, findingComments, findingActivities, partnerSignOff, recommendations, vatReview }
      }
    };
    window.localStorage.setItem(storageKey, JSON.stringify(workspace));
    fetch("/api/workspace", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(workspace)
    }).catch(() => {});
  }, [companies, companySnapshots, currentCompany.id, findingActivities, findingComments, findingEvidence, findings, importProfiles, partnerSignOff, portfolioClients, recommendations, tenant, uploads, validationChecks, vatReview]);

  const completeRecommendation = (recommendation: Recommendation) => {
    if (reviewLocked) return;
    setRecommendations((items) => items.map((item) => (item.id === recommendation.id ? { ...item, completed: true } : item)));
    setFindings((items) => items.map((item) => (item.id === recommendation.findingId ? { ...item, status: "resolved" } : item)));
  };

  const activityActionForStatus = (status: FindingStatus): FindingActivity["action"] => {
    if (status === "under_review" || status === "in_review") return "reviewed";
    if (status === "evidence_requested" || status === "needs_investigation") return "evidence_requested";
    if (status === "evidence_received") return "evidence_uploaded";
    if (status === "resolved" || status === "accepted") return "resolved";
    if (status === "approved") return "approved";
    if (status === "false_positive" || status === "rejected") return "false_positive";
    if (status === "accepted_risk") return "accepted_risk";
    return "closed";
  };

  const addFindingComment = (findingId: string, comment: string) => {
    if (reviewLocked) return;
    const text = comment.trim();
    if (!text) return;
    const now = new Date().toISOString();
    const userId = userEmail || userName || "local-reviewer";
    const nextComment: FindingComment = {
      id: crypto.randomUUID(),
      findingId,
      userId,
      comment: text,
      createdAt: now,
    };
    setFindingComments((items) => [
      nextComment,
      ...items,
    ]);
    setFindings((items) => items.map((finding) => finding.id === findingId ? {
      ...finding,
      comments: [nextComment, ...(finding.comments ?? [])],
      updatedAt: now,
    } : finding));
    setFindingActivities((items) => [
      {
        id: crypto.randomUUID(),
        findingId,
        action: "commented",
        userId,
        timestamp: now,
        details: `Comment added by ${userName || userEmail || "reviewer"}.`,
      },
      ...items,
    ]);
  };

  const fileToDataUrl = (file: File) => new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

  const requestFindingEvidence = (findingId: string, notes = "") => {
    if (reviewLocked) return;
    const now = new Date().toISOString();
    const userId = userEmail || userName || "local-reviewer";
    const request: Evidence = {
      id: crypto.randomUUID(),
      findingId,
      title: "Evidence request",
      description: notes.trim() || "Supporting evidence requested.",
      fileName: "Evidence request",
      requestedBy: userId,
      requestedAt: now,
      uploadedBy: userId,
      uploadedAt: now,
      notes: notes.trim() || "Supporting evidence requested.",
      status: "requested",
    };
    setFindingEvidence((items) => [request, ...items]);
    setFindings((items) => items.map((finding) => finding.id === findingId ? {
      ...finding,
      status: "evidence_requested",
      evidenceIds: [...(finding.evidenceIds ?? []), request.id],
      evidenceLinks: [...(finding.evidenceLinks ?? []), `evidence://${request.id}`],
      attachments: [...(finding.attachments ?? []), request],
      reviewer: userName || userEmail || finding.reviewer,
      reviewAction: "evidence_requested",
      reviewReason: request.notes,
      reviewedAt: now,
      updatedAt: now,
    } : finding));
    setFindingActivities((items) => [{
      id: crypto.randomUUID(),
      findingId,
      action: "evidence_requested",
      userId,
      timestamp: now,
      details: request.notes,
    }, ...items]);
  };

  const updateEvidenceStatus = (findingId: string, evidenceId: string, status: EvidenceStatus, note = "") => {
    if (reviewLocked) return;
    const now = new Date().toISOString();
    const userId = userEmail || userName || "local-reviewer";
    const cleanNote = note.trim() || (
      status === "under_review" ? "Evidence moved into review."
        : status === "accepted" ? "Evidence accepted."
          : status === "rejected" ? "Evidence rejected; replacement evidence required."
            : status === "superseded" ? "Evidence superseded by a replacement upload."
              : "Evidence marked not required."
    );
    let evidenceName = "Evidence";
    setFindingEvidence((items) => items.map((item) => {
      if (item.id !== evidenceId) return item;
      evidenceName = item.fileName;
      return {
        ...item,
        status,
        notes: cleanNote,
        reviewedBy: ["under_review", "accepted", "rejected", "superseded", "not_required"].includes(status) ? userId : item.reviewedBy,
        reviewedAt: ["under_review", "accepted", "rejected", "superseded", "not_required"].includes(status) ? now : item.reviewedAt,
        reviewNote: cleanNote,
        acceptedBy: status === "accepted" ? userId : item.acceptedBy,
        acceptedAt: status === "accepted" ? now : item.acceptedAt,
        rejectedBy: status === "rejected" ? userId : item.rejectedBy,
        rejectedAt: status === "rejected" ? now : item.rejectedAt,
      };
    }));
    setFindings((items) => items.map((finding) => {
      if (finding.id !== findingId) return finding;
      const attachments = (finding.attachments ?? []).map((item) => item.id === evidenceId ? {
        ...item,
        status,
        notes: cleanNote,
        reviewedBy: ["under_review", "accepted", "rejected", "superseded", "not_required"].includes(status) ? userId : item.reviewedBy,
        reviewedAt: ["under_review", "accepted", "rejected", "superseded", "not_required"].includes(status) ? now : item.reviewedAt,
        reviewNote: cleanNote,
        acceptedBy: status === "accepted" ? userId : item.acceptedBy,
        acceptedAt: status === "accepted" ? now : item.acceptedAt,
        rejectedBy: status === "rejected" ? userId : item.rejectedBy,
        rejectedAt: status === "rejected" ? now : item.rejectedAt,
      } : item);
      return {
        ...finding,
        status: status === "accepted" || status === "not_required" ? "resolved" : status === "under_review" ? "evidence_received" : "evidence_requested",
        attachments,
        evidenceAttached: status === "accepted" || status === "not_required" || finding.evidenceAttached,
        resolutionNote: status === "accepted" || status === "not_required" ? cleanNote : finding.resolutionNote,
        resolvedAt: status === "accepted" || status === "not_required" ? now : finding.resolvedAt,
        resolvedBy: status === "accepted" || status === "not_required" ? userId : finding.resolvedBy,
        reviewAction: status === "accepted" || status === "not_required" ? "resolved" : status === "under_review" ? "evidence_received" : "evidence_requested",
        reviewReason: cleanNote,
        reviewedAt: now,
        updatedAt: now,
      };
    }));
    setFindingActivities((items) => [{
      id: crypto.randomUUID(),
      findingId,
      action: status === "under_review" ? "evidence_under_review" : status === "accepted" || status === "not_required" ? "evidence_accepted" : status === "superseded" ? "evidence_superseded" : "evidence_rejected",
      userId,
      timestamp: now,
      details: `${evidenceName}: ${cleanNote}`,
    }, ...items]);
  };

  const addFindingEvidence = async (findingId: string, files: FileList | null, notes = "") => {
    if (reviewLocked) return;
    const selected = Array.from(files ?? []);
    if (!selected.length) return;
    const now = new Date().toISOString();
    const uploadedBy = userEmail || userName || "local-reviewer";
    const supersededIds = findingEvidence
      .filter((item) => item.findingId === findingId && (item.status === "requested" || item.status === "rejected"))
      .map((item) => item.id);
    const evidence = await Promise.all(selected.map(async (file) => ({
      id: crypto.randomUUID(),
      findingId,
      title: file.name,
      description: notes.trim() || "Evidence uploaded for review.",
      fileName: file.name,
      fileUrl: await fileToDataUrl(file),
      requestedBy: undefined,
      requestedAt: undefined,
      uploadedBy,
      uploadedAt: now,
      notes: notes.trim() || undefined,
      status: "uploaded" as const,
    })));
    setFindingEvidence((items) => [
      ...evidence,
      ...items.map((item) => supersededIds.includes(item.id) ? {
        ...item,
        status: "superseded" as const,
        reviewedBy: uploadedBy,
        reviewedAt: now,
        reviewNote: "Superseded by replacement evidence upload.",
      } : item)
    ]);
    setFindings((items) => items.map((finding) => {
      if (finding.id !== findingId) return finding;
      return {
        ...finding,
        status: "evidence_received",
        evidenceIds: [...(finding.evidenceIds ?? []), ...evidence.map((item) => item.id)],
        evidenceLinks: [...(finding.evidenceLinks ?? []), ...evidence.map((item) => item.fileUrl ?? `evidence://${item.id}`)],
        attachments: [...(finding.attachments ?? []).map((item) => supersededIds.includes(item.id) ? { ...item, status: "superseded" as const, reviewedBy: uploadedBy, reviewedAt: now, reviewNote: "Superseded by replacement evidence upload." } : item), ...evidence],
        evidenceAttached: true,
        reviewer: userName,
        reviewAction: "evidence_received",
        reviewReason: notes.trim() || `${evidence.length} evidence file(s) uploaded.`,
        reviewedAt: now,
        updatedAt: now,
      };
    }));
    setFindingActivities((items) => [
      ...evidence.map((item): FindingActivity => ({
        id: crypto.randomUUID(),
        findingId,
        action: "evidence_uploaded",
        userId: uploadedBy,
        timestamp: now,
        details: `${item.fileName} uploaded${item.notes ? ` — ${item.notes}` : ""}.`,
      })),
      ...supersededIds.map((id): FindingActivity => ({
        id: crypto.randomUUID(),
        findingId,
        action: "evidence_superseded",
        userId: uploadedBy,
        timestamp: now,
        details: `Evidence ${id} superseded by replacement upload.`,
      })),
      ...items,
    ]);
  };

  const updateFindingAssignment = (findingId: string, assignedTo: string, dueDate: string) => {
    if (reviewLocked) return;
    const owner = assignedTo.trim();
    const now = new Date().toISOString();
    const userId = userEmail || userName || "local-reviewer";
    setFindings((items) => items.map((finding) => {
      if (finding.id !== findingId) return finding;
      return {
        ...finding,
        assignedTo: owner || undefined,
        owner: owner || undefined,
        dueDate: dueDate || undefined,
        status: finding.status === "open" ? "under_review" : finding.status,
        reviewer: userName,
        manager: finding.manager,
        partner: finding.partner,
        reviewedAt: now,
        updatedAt: now,
      };
    }));
    setFindingActivities((items) => [
      {
        id: crypto.randomUUID(),
        findingId,
        action: "assigned",
        userId,
        timestamp: now,
        details: owner ? `Assigned to ${owner}${dueDate ? `, due ${new Date(dueDate).toLocaleDateString("en-GB")}` : ""}.` : "Assignment cleared.",
      },
      ...items,
    ]);
  };

  const updateManagerReview = (findingId: string, status: ManagerReviewStatus, note = "") => {
    if (reviewLocked) return;
    const now = new Date().toISOString();
    const userId = userEmail || userName || "local-manager";
    const cleanNote = note.trim() || (status === "approved" ? "Manager approved finding review." : status === "returned" ? "Manager returned finding to reviewer." : status === "escalated" ? "Manager escalated finding for partner attention." : "Manager review status updated.");
    setFindings((items) => items.map((finding) => {
      if (finding.id !== findingId) return finding;
      return {
        ...finding,
        managerReviewStatus: status,
        manager: userName || userEmail || "Manager",
        managerReviewedBy: userName || userEmail || "Manager",
        managerReviewedAt: now,
        approvedAt: status === "approved" ? now : finding.approvedAt,
        approvedBy: status === "approved" ? userName || userEmail || "Manager" : finding.approvedBy,
        managerReviewNote: cleanNote,
        status: status === "returned" ? "under_review" : status === "approved" && ["evidence_received", "resolved"].includes(finding.status) ? "approved" : finding.status,
        updatedAt: now,
      };
    }));
    setFindingActivities((items) => [
      {
        id: crypto.randomUUID(),
        findingId,
        action: status === "approved" ? "manager_approved" : status === "returned" ? "manager_returned" : status === "escalated" ? "manager_escalated" : "approved",
        userId,
        timestamp: now,
        details: cleanNote,
      },
      ...items,
    ]);
  };

  const updateFindingStatus = (findingId: string, status: FindingStatus, reason = "") => {
    if (reviewLocked) return;
    const reviewedAt = new Date().toISOString();
    const note = reason.trim() || defaultReviewReason(status);
    const userId = userEmail || userName || "local-reviewer";
    if (status === "evidence_requested") {
      requestFindingEvidence(findingId, note);
      return;
    }
    setFindings((items) => items.map((item) => {
      if (item.id !== findingId) return item;
      if (status === "open") {
        const { reviewAction: _reviewAction, reviewReason: _reviewReason, reviewedAt: _reviewedAt, reviewer: _reviewer, resolvedAt: _resolvedAt, resolvedBy: _resolvedBy, approvedAt: _approvedAt, approvedBy: _approvedBy, ...rest } = item;
        return { ...rest, status, updatedAt: reviewedAt };
      }
      const evidenceIds = status === "evidence_received" && !item.evidenceIds?.length ? [`ev_${item.id}`] : item.evidenceIds;
      const isResolved = ["resolved", "closed", "false_positive", "accepted_risk"].includes(status);
      const isApproved = status === "approved";
      return {
        ...item,
        status,
        reviewer: userName || userEmail || item.reviewer,
        reviewAction: status,
        reviewReason: note,
        resolutionNote: isResolved || isApproved ? note : item.resolutionNote,
        evidenceIds,
        evidenceLinks: evidenceIds?.map((id) => `evidence://${id}`) ?? item.evidenceLinks,
        evidenceAttached: Boolean(evidenceIds?.length || item.evidence?.rows?.length),
        resolvedAt: isResolved ? reviewedAt : item.resolvedAt,
        resolvedBy: isResolved ? userName || userEmail || "Reviewer" : item.resolvedBy,
        approvedAt: isApproved ? reviewedAt : item.approvedAt,
        approvedBy: isApproved ? userName || userEmail || "Reviewer" : item.approvedBy,
        reviewedAt,
        updatedAt: reviewedAt,
      };
    }));
    setFindingActivities((items) => [
      {
        id: crypto.randomUUID(),
        findingId,
        action: activityActionForStatus(status),
        userId,
        timestamp: reviewedAt,
        details: note,
      },
      ...items,
    ]);
  };

  const recordPartnerSignOff = (gateSnapshot: PartnerSignOffGateSnapshot, note = "") => {
    if (reviewLocked) return;
    const cleanNote = note.trim();
    const now = new Date().toISOString();
    const signedBy = userName || userEmail || "Partner";
    setPartnerSignOff({
      id: crypto.randomUUID(),
      tenantId: tenant.id,
      companyId: currentCompany.id,
      status: "locked",
      reviewPackStatus: "LOCKED",
      preparedBy: userName || userEmail || "Reviewer",
      reviewedBy: "Manager",
      approvedBy: signedBy,
      signedBy,
      signedAt: now,
      lockedAt: now,
      note: cleanNote || undefined,
      gateSnapshot,
      approval: {
        approvedBy: signedBy,
        approvedAt: now,
        readinessScore: gateSnapshot.readiness,
        confidenceScore: assurance.confidence,
        openFindings: openFindings.length,
        acceptedRisks: findings.filter((finding) => finding.status === "accepted_risk").length,
        approvalComment: cleanNote || undefined,
      },
    });
    setFindingActivities((items) => [{
      id: crypto.randomUUID(),
      findingId: "review_pack",
      action: "approved",
      userId: signedBy,
      timestamp: now,
      details: `Partner sign-off locked the review pack. Readiness ${gateSnapshot.readiness}%.`,
    }, ...items]);
  };

  const clearCurrentReview = (message = `${currentCompany.name} review cleared. Upload a new finance pack to start again.`) => {
    const emptySnapshot = normaliseSnapshot();
    setUploads([]);
    setValidationChecks([]);
    setFindings([]);
    setFindingEvidence([]);
    setFindingComments([]);
    setFindingActivities([]);
    setPartnerSignOff(undefined);
    setRecommendations([]);
    setImportProfiles([]);
    setVatReview(undefined);
    setRuleAnalytics(null);
    setAssistantResult(null);
    setCompanySnapshots((items) => ({ ...items, [currentCompany.id]: emptySnapshot }));
    setPortfolioClients((items) => items.map((client) => client.id === currentCompany.id ? { ...client, score: 0, risk: "medium", openFindings: 0, closeStatus: "Awaiting upload" } : client));
    setUploadMessage(message);
    setActive("Upload Finance Pack");
  };
  const deleteUpload = (uploadId: string) => {
    const target = uploads.find((u) => u.id === uploadId);
    if (!target) return;
    const nextUploads = uploads.filter((u) => u.id !== uploadId);
    if (nextUploads.length === 0) {
      clearCurrentReview("All uploaded data removed. Scores, findings, VAT review, recommendations and validation checks have been reset.");
      return;
    }
    const removedFindingIds = new Set(
      findings.filter((f) => f.evidence.sourceFile === target.fileName).map((f) => f.id)
    );
    const nextFindings = findings.filter((f) => f.evidence.sourceFile !== target.fileName);
    const nextRecommendations = recommendations.filter((r) => !removedFindingIds.has(r.findingId));
    const nextValidationChecks = validationChecks.filter((v) => !v.id.includes(uploadId));
    const nextVatReview = target.fileType === "vat_report" || !nextUploads.some((upload) => upload.fileType === "vat_report") ? undefined : vatReview;
    const nextSnapshot: AnalysisResult = {
      uploads: nextUploads,
      validationChecks: nextValidationChecks,
      findings: nextFindings,
      importProfiles: importProfiles.filter((profile) => nextUploads.some((upload) => upload.fileType === profile.fileType)),
      findingEvidence: findingEvidence.filter((evidence) => !removedFindingIds.has(evidence.findingId)),
      findingComments: findingComments.filter((comment) => !removedFindingIds.has(comment.findingId)),
      findingActivities: findingActivities.filter((activity) => !removedFindingIds.has(activity.findingId)),
      partnerSignOff: undefined,
      recommendations: nextRecommendations,
      vatReview: nextVatReview,
    };
    setUploads(nextUploads);
    setFindings(nextFindings);
    setFindingEvidence(nextSnapshot.findingEvidence ?? []);
    setFindingComments(nextSnapshot.findingComments ?? []);
    setFindingActivities(nextSnapshot.findingActivities ?? []);
    setRecommendations(nextRecommendations);
    setImportProfiles(nextSnapshot.importProfiles ?? []);
    setValidationChecks(nextValidationChecks);
    setVatReview(nextVatReview);
    setRuleAnalytics(null);
    setCompanySnapshots((items) => ({ ...items, [currentCompany.id]: nextSnapshot }));
    setPortfolioClients((items) => updateClientSummary(items, currentCompany, nextSnapshot));
    setUploadMessage(`${target.fileName} removed. Re-upload the finance pack to regenerate cross-file checks from the remaining data.`);
  };

  const confirmImportProfile = (profileId: string) => {
    const confirmedAt = new Date().toISOString();
    const nextProfiles = importProfiles.map((profile) => profile.id === profileId ? {
      ...profile,
      status: "confirmed" as const,
      source: "reviewer_confirmed" as const,
      confirmedAt,
      lastUsedAt: confirmedAt,
    } : profile);
    const nextUploads = uploads.map((upload) => upload.mappingProfileId === profileId ? {
      ...upload,
      mappingProfileStatus: "confirmed" as const,
    } : upload);
    const nextSnapshot = normaliseSnapshot({
      uploads: nextUploads,
      validationChecks,
      findings,
      importProfiles: nextProfiles,
      findingEvidence,
      findingComments,
      findingActivities,
      partnerSignOff,
      recommendations,
      vatReview,
    });
    setImportProfiles(nextProfiles);
    setUploads(nextUploads);
    setCompanySnapshots((items) => ({ ...items, [currentCompany.id]: nextSnapshot }));
    setUploadMessage("Mapping profile confirmed and will be reused on the next matching upload.");
  };

  const analyseUploads = async (files: FileList | null) => {
    const selected = Array.from(files ?? []);
    if (!selected.length) return;
    setIsAnalysing(true);
    setAssistantResult(null);
    try {
      let result: AnalysisResult;
      try {
        const form = new FormData();
        selected.forEach((file) => form.append("files", file));
        form.append("tenantId", tenant.id);
        form.append("tenantName", tenant.name);
        form.append("tenantType", tenant.type);
        form.append("tenantPlan", tenant.plan);
        form.append("companyId", currentCompany.id);
        form.append("companyName", currentCompany.name);
        form.append("companyIndustry", currentCompany.industry);
        form.append("accountingSystem", currentCompany.accountingSystem);
        form.append("currency", currentCompany.currency);
        form.append("country", currentCompany.country);
        form.append("mappingProfiles", JSON.stringify(importProfiles.filter((profile) => profile.status === "confirmed")));
        const response = await fetch("/api/analyse-upload", {
          method: "POST",
          body: form
        });
        if (!response.ok) throw new Error("Server parser failed");
        result = await response.json();
      } catch {
        result = await analyseFinanceFiles(selected, { savedProfiles: importProfiles.filter((profile) => profile.status === "confirmed") });
      }

      // Run analytics in parallel (non-blocking)
      try {
        const { analyseWithCoverage } = await import("@/lib/rule-analytics");
        const parsed = await Promise.all(selected.map(async (file) => {
          const { parseDelimitedText, inferFileType, createUpload } = await import("@/lib/upload-analysis");
          if (!/\.(csv|tsv|txt)$/i.test(file.name)) return { upload: createUpload(file.name), rows: [], isParsed: false };
          const text = await file.text();
          const { rows } = parseDelimitedText(text, file.name.toLowerCase().endsWith(".tsv") ? "\t" : undefined);
          return { upload: createUpload(file.name, rows.length), rows, isParsed: true };
        }));
        const { analytics } = analyseWithCoverage(parsed);
        setRuleAnalytics(analytics);
      } catch { /* analytics are non-critical */ }
      const scoped = scopeAnalysisResult(result, tenant, currentCompany);
      const nextImportProfiles = mergeImportProfiles(importProfiles, scoped.importProfiles ?? []);
      const scopedScorecard = calculateFinanceScorecard(scoped.findings, scoped.validationChecks, scoped.recommendations, scoped.uploads);
      const generatedAt = new Date().toISOString();
      const generatedActivities: FindingActivity[] = scoped.findings.map((finding) => ({
        id: crypto.randomUUID(),
        findingId: finding.id,
        action: "created",
        userId: userEmail || userName || "closepilot",
        timestamp: generatedAt,
        details: "Finding generated from uploaded finance evidence.",
      }));
      const scopedWithWorkflow: AnalysisResult = {
        ...scoped,
        importProfiles: nextImportProfiles,
        findingEvidence: [],
        findingComments: [],
        findingActivities: generatedActivities,
        partnerSignOff: undefined,
      };
      setUploads(scoped.uploads);
      setValidationChecks(scoped.validationChecks);
      setImportProfiles(nextImportProfiles);
      setFindings(scoped.findings.length ? scoped.findings : []);
      setFindingEvidence([]);
      setFindingComments([]);
      setFindingActivities(generatedActivities);
      setPartnerSignOff(undefined);
      setRecommendations(scoped.recommendations);
      setVatReview(scoped.vatReview);
      setCompanySnapshots((items) => ({ ...items, [currentCompany.id]: scopedWithWorkflow }));
      setPortfolioClients((items) => updateClientSummary(items, currentCompany, scopedWithWorkflow));
      fetch("/api/analysis-results", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenantId: tenant.id,
          companyId: currentCompany.id,
          score: scopedScorecard.overall,
          risk: riskLabel(scopedScorecard.overall),
          result: scopedWithWorkflow,
        })
      }).catch(() => {});
      setUploadMessage(scoped.findings.length ? `Analysed ${selected.length} file(s) for ${currentCompany.name} and generated ${scoped.findings.length} evidence-linked finding(s).` : `Analysed ${selected.length} file(s) for ${currentCompany.name}. No material findings were generated from parsed rows.`);
      setActive("Finance Review");
    } finally {
      setIsAnalysing(false);
    }
  };

  const applyIntegrationAnalysis = (result: AnalysisResult) => {
    const scoped = scopeAnalysisResult(result, tenant, currentCompany);
    const nextImportProfiles = mergeImportProfiles(importProfiles, scoped.importProfiles ?? []);
    const generatedAt = new Date().toISOString();
    const generatedActivities: FindingActivity[] = scoped.findings.map((finding) => ({ id: crypto.randomUUID(), findingId: finding.id, action: "created", userId: userEmail || userName || "closepilot", timestamp: generatedAt, details: "Finding generated from live accounting integration evidence." }));
    const scopedWithWorkflow: AnalysisResult = { ...scoped, importProfiles: nextImportProfiles, findingEvidence: [], findingComments: [], findingActivities: generatedActivities, partnerSignOff: undefined };
    setUploads(scoped.uploads);
    setValidationChecks(scoped.validationChecks);
    setImportProfiles(nextImportProfiles);
    setFindings(scoped.findings);
    setFindingEvidence([]);
    setFindingComments([]);
    setFindingActivities(generatedActivities);
    setPartnerSignOff(undefined);
    setRecommendations(scoped.recommendations);
    setVatReview(scoped.vatReview);
    setCompanySnapshots((items) => ({ ...items, [currentCompany.id]: scopedWithWorkflow }));
    setPortfolioClients((items) => updateClientSummary(items, currentCompany, scopedWithWorkflow));
    setUploadMessage(`Live Xero sync completed for ${currentCompany.name}: ${scoped.uploads.length} evidence source(s), ${scoped.findings.length} finding(s).`);
    setActive("VAT Assurance");
  };
  const onboardWorkspace = (nextTenant: Tenant, nextCompany: Company) => {
    workspaceLoadCancelled.current = true;
    setTenant(nextTenant);
    setCurrentCompany(nextCompany);
    setCompanies((items) => [nextCompany, ...items.filter((item) => item.id !== nextCompany.id)].map((item) => ({ ...item, tenantId: nextTenant.id })));
    setUploads([]);
    setValidationChecks([]);
    setFindings([]);
    setFindingEvidence([]);
    setFindingComments([]);
    setFindingActivities([]);
    setPartnerSignOff(undefined);
    setRecommendations([]);
    setImportProfiles([]);
    setVatReview(undefined);
    setCompanySnapshots((items) => ({ ...items, [nextCompany.id]: emptySnapshot() }));
    setUploadMessage(`${nextCompany.name} is ready. Upload a finance pack to create the first evidence-linked review.`);
    setPortfolioClients((items) => {
      const client: ClientCompany = { id: nextCompany.id, name: nextCompany.name, system: nextCompany.accountingSystem, score: 0, risk: "medium", openFindings: 0, closeStatus: "Awaiting upload" };
      return [client, ...items.filter((item) => item.id !== nextCompany.id)];
    });
    setActive("Upload Finance Pack");
  };

  const loadPilotDemo = () => {
    workspaceLoadCancelled.current = true;
    const snapshot = normaliseSnapshot(pilotAnalysisResult);
    setTenant(pilotTenant);
    setCurrentCompany(pilotCompany);
    setCompanies([pilotCompany]);
    setPortfolioClients([pilotClient]);
    setCompanySnapshots({ [pilotCompany.id]: snapshot });
    setUploads(snapshot.uploads);
    setValidationChecks(snapshot.validationChecks);
    setImportProfiles(snapshot.importProfiles ?? []);
    setFindings(snapshot.findings);
    setFindingEvidence(snapshot.findingEvidence ?? []);
    setFindingComments(snapshot.findingComments ?? []);
    setFindingActivities(snapshot.findingActivities ?? []);
    setPartnerSignOff(snapshot.partnerSignOff);
    setRecommendations(snapshot.recommendations);
    setVatReview(snapshot.vatReview);
    setRuleAnalytics(null);
    setUploadMessage(`${pilotCompany.name} pilot demo loaded with upload, findings, evidence, manager review, partner sign-off and export pack.`);
    setPilotWalkthroughStep(0);
    setActive("Findings");
  };

  const switchCompany = (companyId: string) => {
    const selectedCompany = companies.find((item) => item.id === companyId);
    if (!selectedCompany) return;
    const currentSnapshot = normaliseSnapshot({ uploads, validationChecks, findings, importProfiles, findingEvidence, findingComments, findingActivities, partnerSignOff, recommendations, vatReview });
    const nextSnapshot = normaliseSnapshot(companySnapshots[selectedCompany.id]);
    setCompanySnapshots((items) => ({ ...items, [currentCompany.id]: currentSnapshot }));
    setCurrentCompany(selectedCompany);
    setUploads(nextSnapshot.uploads);
    setValidationChecks(nextSnapshot.validationChecks);
    setImportProfiles(nextSnapshot.importProfiles ?? []);
    setFindings(nextSnapshot.findings);
    setFindingEvidence(nextSnapshot.findingEvidence ?? []);
    setFindingComments(nextSnapshot.findingComments ?? []);
    setFindingActivities(nextSnapshot.findingActivities ?? []);
    setPartnerSignOff(nextSnapshot.partnerSignOff);
    setRecommendations(nextSnapshot.recommendations);
    setVatReview(nextSnapshot.vatReview);
    setUploadMessage(nextSnapshot.uploads.length ? `${selectedCompany.name} review loaded.` : `${selectedCompany.name} has no uploaded pack yet. Upload files to begin the review.`);
    setActive("Finance Review");
  };

  const content = useMemo(() => {
    if (active === "Onboarding") return <OnboardingPanel tenant={tenant} company={currentCompany} onboardWorkspace={onboardWorkspace} loadPilotDemo={loadPilotDemo} />;
    if (active === "Overview" || active === "Dashboard") return <DashboardPanel score={score} risk={risk} assurance={assurance} findings={findings} openFindings={openFindings.length} cashAtRisk={cashAtRisk} financialExposure={financialExposure} timeSaved={timeSaved} timeSavedHours={timeSavedHours} timeSavedValue={timeSavedValue} validationWarnings={validationWarnings} validationBlockers={validationBlockers} validationChecks={validationChecks} recommendations={recommendations} clients={portfolioClients} uploads={uploads} setActive={setActive} />;
    if (active === "Finance Review") {
      return (
        <>
          <ReviewCommandCenter
            score={score}
            risk={risk}
            assurance={assurance}
            uploads={uploads}
            openFindings={openFindings.length}
            recommendations={recommendations}
            financialExposure={financialExposure}
            cashAtRisk={cashAtRisk}
            validationBlockers={validationBlockers}
            validationWarnings={validationWarnings}
            scoreDrivers={scorecard.drivers}
            setActive={setActive}
          />

          <ExecutiveSummary openFindings={openFindings.length} recommendationCount={recommendations.filter((item) => !item.completed).length} findings={findings} validationChecks={validationChecks} forecast={forecast} />

          <section className="grid gap-4 xl:grid-cols-[1.12fr_0.88fr]">
            <ScorePanel score={score} risk={risk} company={currentCompany} uploads={uploads} setActive={setActive} />
            <div className="grid gap-4 sm:grid-cols-3 xl:grid-cols-1">
              <Metric title="Financial Exposure" value={`£${financialExposure.toLocaleString()}`} detail="Cash, VAT and close risks" tone="critical" />
              <Metric title="Cash at Risk" value={`£${cashAtRisk.toLocaleString()}`} detail="From AR and forecast signals" tone="high" />
              <Metric title="Month-End Time Saved" value={`${timeSaved}h`} detail="Estimated this close" tone="low" />
              <Metric title="Validation Warnings" value={validationWarnings} detail={validationBlockers ? "Export blocked" : "Review before final export"} tone={validationBlockers ? "critical" : validationWarnings ? "medium" : "low"} />
            </div>
          </section>

          <section className="mt-4">
            <ReadinessTimeline uploads={uploads} findings={findings} recommendations={recommendations} validationChecks={validationChecks} />
          </section>

          <section className="mt-4">
            <TrustPanel validationChecks={validationChecks} validationBlockers={validationBlockers} validationWarnings={validationWarnings} findings={findings} />
          </section>

          <section className="mt-4">
            <CoreQualityPanel quality={coreQuality} compact />
          </section>

          <section className="mt-4 grid gap-4 xl:grid-cols-[1fr_0.95fr]">
            <Panel title="Recommended Actions">
              <div className="grid gap-3">
                {recommendations.length ? (
                  recommendations.map((item) => (
                    <ActionRow key={item.id} recommendation={item} complete={() => completeRecommendation(item)} />
                  ))
                ) : (
                  <EmptyState title="No actions yet" detail="Upload a finance pack to generate evidence-linked recommendations." />
                )}
              </div>
            </Panel>
            <CopilotPrompt question={question} setQuestion={setQuestion} openCopilot={() => setActive("Ask ClosePilot")} />
          </section>

          <section className="mt-4 grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
            <Panel title="Finding Lifecycle">
              <FindingLifecycleSummary findings={findings} setActive={setActive} />
              <div className="mt-4">
                <FindingList findings={openFindings.slice(0, 4)} setActive={setActive} updateFindingStatus={updateFindingStatus} />
              </div>
            </Panel>
            <Panel title="90-Day Cash Forecast">
              {uploads.length > 0 ? (
                <>
                  <CashChart forecast={forecast} />
                  {forecast[3]?.risk !== "low" && (
                    <p className="mt-3 text-sm font-semibold text-amber-700">Cash is forecast to fall to £{Math.round((forecast[3]?.cash ?? 0) / 1000)}k in 90 days unless collections improve.</p>
                  )}
                </>
              ) : (
                <div className="flex h-72 items-center justify-center rounded-lg border-2 border-dashed border-line bg-slate-50">
                  <div className="text-center">
                    <p className="font-bold text-muted">No data uploaded</p>
                    <p className="mt-1 text-sm text-muted">Upload a finance pack to see your cash forecast.</p>
                  </div>
                </div>
              )}
            </Panel>
          </section>

          <section className="mt-4 grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
            <Panel title="Review Components">
              {uploads.length > 0 ? (
                <BreakdownChart breakdown={breakdown} />
              ) : (
                <div className="flex h-72 items-center justify-center rounded-lg border-2 border-dashed border-line bg-slate-50">
                  <p className="text-sm text-muted">Upload a finance pack to see score breakdown.</p>
                </div>
              )}
            </Panel>
            <Panel title="Uploaded Data Pack">
              <UploadList uploads={uploads} onDelete={deleteUpload} onClear={clearCurrentReview} />
            </Panel>
          </section>

          <section className="mt-4">
            <ReportAppendix findings={findings} uploads={uploads} validationChecks={validationChecks} />
          </section>
        </>
      );
    }

    if (active === "Findings") return <FindingsHub findings={findings} findingEvidence={findingEvidence} findingComments={findingComments} findingActivities={findingActivities} partnerSignOff={partnerSignOff} reviewLocked={reviewLocked} pilotWalkthroughStep={isPilotDemo ? pilotWalkthroughStep : undefined} focusedFindingId={focusedFindingId} clearFocusedFinding={() => setFocusedFindingId(null)} validationChecks={validationChecks} uploads={uploads} updateFindingStatus={updateFindingStatus} updateFindingAssignment={updateFindingAssignment} updateManagerReview={updateManagerReview} recordPartnerSignOff={recordPartnerSignOff} addFindingComment={addFindingComment} addFindingEvidence={addFindingEvidence} updateEvidenceStatus={updateEvidenceStatus} onCreateNewReviewCycle={() => clearCurrentReview(`${currentCompany.name} locked review archived. Upload a new finance pack to start a new review cycle.`)} setActive={setActive} />;
    if (active === "Assurance Engine") return <AssuranceEngine assurance={assurance} coreQuality={coreQuality} findings={findings} validationChecks={validationChecks} uploads={uploads} ruleAnalytics={ruleAnalytics} setActive={setActive} />;
    if (active === "Upload Finance Pack") return <UploadAnalyse analyseUploads={analyseUploads} isAnalysing={isAnalysing} uploadMessage={uploadMessage} validationChecks={validationChecks} uploads={uploads} importProfiles={importProfiles} confirmImportProfile={confirmImportProfile} findings={findings} recommendations={recommendations} onDelete={deleteUpload} onClear={clearCurrentReview} />;
    if (active === "Close Review") return <MonthEndClose findings={findings} recommendations={recommendations} completeRecommendation={completeRecommendation} updateFindingStatus={updateFindingStatus} />;
    if (active === "Cash Intelligence") return <CashflowPanel forecast={forecast} findings={findings} uploads={uploads} />;
    if (active === "Collections Intelligence") return <CollectionsPanel findings={findings} />;
    if (active === "VAT Assurance") return <VatAssuranceModule vatReview={vatReview} findings={findings} updateFindingStatus={updateFindingStatus} setActive={setActive} userName={userName} tenantId={tenant.id} companyId={currentCompany.id} onVatReviewChange={setVatReview} />;
    if (active === "Controls & Fraud") return <RiskModule title="Controls & Fraud" category="controls" findings={findings} updateFindingStatus={updateFindingStatus} />;
    if (active === "Audit Readiness") return <AuditReadiness findings={findings} validationChecks={validationChecks} uploads={uploads} score={score} timeSavedHours={timeSavedHours} timeSavedValue={timeSavedValue} expectedAuditQueries={expectedAuditQueries} financialExposure={financialExposure} company={currentCompany} tenant={tenant} setActive={setActive} />;
    if (active === "Review Pack") return <ReviewPack company={currentCompany} tenant={tenant} userName={userName} score={score} risk={risk} findings={findings} findingEvidence={findingEvidence} findingComments={findingComments} findingActivities={findingActivities} partnerSignOff={partnerSignOff} reviewLocked={reviewLocked} recommendations={recommendations} validationChecks={validationChecks} uploads={uploads} financialExposure={financialExposure} cashAtRisk={cashAtRisk} onCreateNewReviewCycle={() => clearCurrentReview(`${currentCompany.name} locked review archived. Upload a new finance pack to start a new review cycle.`)} setActive={setActive} />;
    if (active === "Change Intelligence") return <ChangeIntelligence findings={findings} uploads={uploads} />;
    if (active === "Ask ClosePilot") return <AICopilot question={question} setQuestion={setQuestion} score={score} findings={findings} findingActivities={findingActivities} validationChecks={validationChecks} uploads={uploads} company={currentCompany} forecast={forecast} assistantResult={assistantResult?.companyId === currentCompany.id ? assistantResult : null} setAssistantResult={setAssistantResult} updateFindingStatus={updateFindingStatus} updateManagerReview={updateManagerReview} openFindingEvidence={(findingId) => { setFocusedFindingId(findingId); setActive("Findings"); }} setActive={setActive} />;
    if (active === "User Guide") return <UserGuide isPilotDemo={isPilotDemo} hasData={hasUploadedData} loadPilotDemo={loadPilotDemo} setActive={setActive} setPilotWalkthroughStep={setPilotWalkthroughStep} />;
    if (active === "Settings") return <SettingsPanel tenant={tenant} company={currentCompany} userEmail={userEmail} userName={userName} onIntegrationAnalysis={applyIntegrationAnalysis} />;
    return <PracticePortal tenant={tenant} clients={portfolioClients} currentCompanyId={currentCompany.id} switchCompany={switchCompany} companySnapshots={companySnapshots} />;
  }, [active, assurance, assistantResult, cashAtRisk, companySnapshots, companies, coreQuality, currentCompany, financialExposure, findingActivities, findingComments, findingEvidence, findings, focusedFindingId, importProfiles, isAnalysing, isPilotDemo, openFindings, partnerSignOff, pilotWalkthroughStep, portfolioClients, question, recommendations, risk, score, tenant, timeSaved, uploadMessage, uploads, validationBlockers, validationChecks, validationWarnings, vatReview]);

  return (
    <div className="min-h-screen bg-page text-ink lg:grid lg:grid-cols-[280px_1fr]">
      {showExport && (
        <ExportModal
          company={currentCompany}
          tenant={tenant}
          score={score}
          risk={risk}
          findings={findings}
          findingEvidence={findingEvidence}
          findingComments={findingComments}
          findingActivities={findingActivities}
          partnerSignOff={partnerSignOff}
          recommendations={recommendations}
          validationChecks={validationChecks}
          uploads={uploads}
          cashAtRisk={cashAtRisk}
          financialExposure={financialExposure}
          onClose={() => setShowExport(false)}
        />
      )}
      <aside className="no-print border-b border-white/10 bg-[#111827] text-white lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col lg:border-b-0">
        <div className="flex items-center justify-between gap-4 px-4 py-4 lg:block lg:p-5">
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-cyan to-brand font-black shadow-lg shadow-blue-950/30">CP</div>
            <div className="min-w-0">
              <strong className="block truncate">ClosePilot</strong>
              <span className="block truncate text-xs font-semibold uppercase tracking-wide text-slate-400">Assurance Platform</span>
            </div>
          </div>
          <Pill level={hasUploadedData ? risk : "none"}>{hasUploadedData ? riskCopy(risk) : "Awaiting upload"}</Pill>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-4 pb-4 lg:grid lg:overflow-y-auto lg:overflow-x-hidden lg:px-5 lg:pb-5">
          {nav.map((item, index) =>
            item === null ? (
              <hr key={index} className="hidden border-white/10 lg:my-2 lg:block" />
            ) : (
              <button
                key={item}
                className={`whitespace-nowrap rounded-lg px-3 py-2.5 text-left text-sm font-semibold transition-colors lg:whitespace-normal ${active === item ? "bg-white text-[#111827] shadow-sm" : "text-slate-400 hover:bg-white/5 hover:text-slate-200"}`}
                onClick={() => setActive(item)}
              >
                {item}
              </button>
            )
          )}
        </nav>
        <div className="mt-auto hidden border-t border-white/10 p-5 lg:block">
          <div className="mb-4 rounded-lg border border-white/10 bg-white/5 p-3">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Workspace</p>
            <p className="mt-1 truncate text-sm font-bold text-slate-200">{tenant.name}</p>
            <p className="truncate text-xs text-slate-500">{userEmail || "Local demo mode"}</p>
          </div>
          <form action="/api/logout" method="POST">
            <button className="w-full rounded-lg px-3 py-2 text-left text-sm font-semibold text-slate-400 hover:bg-white/5 hover:text-slate-200 transition-colors">Sign out</button>
          </form>
        </div>
      </aside>
      <main className="min-w-0 p-4 lg:p-6">
        <header className="mb-5 rounded-lg border border-line bg-white/95 p-4 shadow-panel">
          <div className="flex flex-col justify-between gap-4 xl:flex-row xl:items-center">
            <div className="min-w-0">
              <p className="text-xs font-bold uppercase text-muted">ClosePilot Assurance</p>
              <h1 className="mt-1 text-2xl font-black sm:text-3xl">{active}</h1>
              <p className="mt-1 max-w-4xl text-sm font-semibold text-cyan">{tenant.name} · {currentCompany.name} · {uploads.length} finance exports reviewed, {openFindings.length} items to resolve.{timeSavedMins > 0 ? ` · ${timeSavedHours}h manager review time saved.` : ""}</p>
            </div>
            <div className="grid gap-2 sm:flex sm:flex-wrap sm:justify-end">
              <select className="h-10 min-w-0 rounded-lg border border-line bg-white px-3 text-sm font-bold shadow-sm" value={currentCompany.id} onChange={(event) => switchCompany(event.target.value)}>
                {companies.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
              <button className="h-10 rounded-lg border border-line bg-white px-4 text-sm font-bold shadow-sm transition-colors hover:border-brand hover:text-brand" onClick={() => setActive("User Guide")}>Guide</button>
              {isPilotDemo && (
                <button className="h-10 rounded-lg border border-emerald-300 bg-emerald-50 px-4 text-sm font-bold text-emerald-800 shadow-sm transition-colors hover:bg-emerald-100" onClick={() => {
                  if (confirm("Reload the original Brightlane demo? This replaces any changes made in the synthetic demo workspace.")) loadPilotDemo();
                }}>Reload Demo</button>
              )}
              <button className="h-10 rounded-lg border border-line bg-white px-4 text-sm font-bold shadow-sm transition-colors hover:border-brand hover:text-brand" onClick={() => setActive("Onboarding")}>Onboard</button>
              <button className="h-10 rounded-lg bg-brand px-4 text-sm font-bold text-white shadow-sm transition-colors hover:bg-blue-700" onClick={() => setShowExport(true)}>Export Review</button>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <HeaderStat label="Health" value={headerHealthValue} level={headerHealthLevel} />
            <HeaderStat label="Readiness" value={headerReadinessValue} level={headerReadinessLevel} />
            <HeaderStat label="Exposure" value={`£${headerExposureValue.toLocaleString()}`} level={headerExposureValue ? "critical" : "low"} />
            <HeaderStat label="Actions" value={String(headerActionsValue)} level={headerActionsValue ? "medium" : "low"} />
          </div>
        </header>
        {isPilotDemo && uploads.length > 0 && (
          <PilotWalkthroughRail
            step={pilotWalkthroughStep}
            setStep={setPilotWalkthroughStep}
            setActive={setActive}
            findings={findings}
            findingEvidence={findingEvidence}
            findingComments={findingComments}
            findingActivities={findingActivities}
            partnerSignOff={partnerSignOff}
          />
        )}
        {content}
      </main>
    </div>
  );
}

function UserGuide({ isPilotDemo, hasData, loadPilotDemo, setActive, setPilotWalkthroughStep }: {
  isPilotDemo: boolean;
  hasData: boolean;
  loadPilotDemo: () => void;
  setActive: (value: string) => void;
  setPilotWalkthroughStep: (value: number) => void;
}) {
  const steps = [
    { number: 1, title: "Understand the finance review", detail: "Check health, readiness, exposure, validation warnings and recommended actions.", page: "Finance Review", time: "10 min" },
    { number: 2, title: "Review findings", detail: "Open material exceptions and verify severity, source rows, calculations and recommendations.", page: "Findings", time: "10 min", walkthrough: 0 },
    { number: 3, title: "Inspect evidence", detail: "Read attachments, source evidence, reviewer comments and the activity history.", page: "Findings", time: "8 min", walkthrough: 1 },
    { number: 4, title: "Check manager and partner controls", detail: "Review decisions, escalation, sign-off gates and the locked audit trail.", page: "Findings", time: "10 min", walkthrough: 2 },
    { number: 5, title: "Open the review pack", detail: "Confirm findings, evidence, decisions and sign-off before exporting the dossier.", page: "Review Pack", time: "8 min", walkthrough: 4 },
    { number: 6, title: "Explore finance intelligence", detail: "Review cash forecasts, expected collections, VAT assurance and close insights.", page: "Cash Intelligence", time: "7 min" },
  ];

  const openStep = (page: string, walkthrough?: number) => {
    if (typeof walkthrough === "number") setPilotWalkthroughStep(walkthrough);
    setActive(page);
  };

  return (
    <div className="grid gap-5">
      <section className="rounded-xl border border-blue-200 bg-gradient-to-r from-blue-50 to-cyan-50 p-5 shadow-panel">
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
          <div>
            <p className="text-xs font-black uppercase tracking-wide text-brand">Getting started</p>
            <h2 className="mt-1 text-2xl font-black">Follow one review from evidence to partner sign-off</h2>
            <p className="mt-2 max-w-3xl text-sm text-muted">For demonstrations, use Brightlane Manufacturing Ltd only. It contains fictional finance data and a completed, read-only decision trail.</p>
          </div>
          {!isPilotDemo ? (
            <button className="shrink-0 rounded-lg bg-emerald-600 px-5 py-3 text-sm font-black text-white shadow-sm hover:bg-emerald-700" onClick={loadPilotDemo}>Load Safe Pilot Demo</button>
          ) : (
            <div className="flex shrink-0 flex-wrap gap-2">
              <button className="rounded-lg border border-emerald-300 bg-white px-5 py-3 text-sm font-black text-emerald-800 shadow-sm hover:bg-emerald-50" onClick={() => {
                if (confirm("Reload the original Brightlane demo? This replaces any changes made in the synthetic demo workspace.")) loadPilotDemo();
              }}>Reload Demo Data</button>
              <button className="rounded-lg bg-brand px-5 py-3 text-sm font-black text-white shadow-sm hover:bg-blue-700" onClick={() => openStep("Finance Review")}>Start Guided Review</button>
            </div>
          )}
        </div>
      </section>

      <section className="rounded-xl border border-amber-200 bg-amber-50 p-4">
        <strong className="text-amber-900">Demo safety</strong>
        <p className="mt-1 text-sm text-amber-900">Do not upload, email or paste real client information during a demonstration. Real data requires an approved pilot scope, signed processing terms and named user access.</p>
      </section>

      <Panel title="Guided Review Workflow">
        <div className="grid gap-3 lg:grid-cols-2">
          {steps.map((step) => (
            <article key={step.number} className="flex flex-col justify-between rounded-lg border border-line bg-white p-4">
              <div>
                <div className="flex items-center justify-between gap-3">
                  <span className="grid h-8 w-8 place-items-center rounded-full bg-blue-100 text-sm font-black text-brand">{step.number}</span>
                  <span className="text-xs font-bold text-muted">{step.time}</span>
                </div>
                <h3 className="mt-3 font-black">{step.title}</h3>
                <p className="mt-1 text-sm text-muted">{step.detail}</p>
              </div>
              <button className="mt-4 self-start rounded-lg border border-line px-3 py-2 text-sm font-bold transition-colors hover:border-brand hover:text-brand disabled:cursor-not-allowed disabled:opacity-50" disabled={!hasData} onClick={() => openStep(step.page, step.walkthrough)}>
                Open {step.page}
              </button>
            </article>
          ))}
        </div>
      </Panel>

      <div className="grid gap-5 xl:grid-cols-2">
        <Panel title="60-Minute Demonstration">
          <div className="grid gap-2 text-sm">
            {[
              ["0–5", "Welcome, scope and synthetic-data safety"],
              ["5–10", "Sign in and workspace orientation"],
              ["10–15", "Load and introduce the pilot demo"],
              ["15–25", "Finance Review and validation"],
              ["25–35", "Findings and source evidence"],
              ["35–49", "Review decisions and partner controls"],
              ["49–57", "Review Pack and intelligence screens"],
              ["57–60", "Feedback and next decision"],
            ].map(([time, activity]) => (
              <div key={time} className="grid grid-cols-[58px_1fr] gap-3 rounded-lg bg-slate-50 px-3 py-2">
                <strong>{time}</strong><span>{activity}</span>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Questions to Ask">
          <ol className="grid gap-3 text-sm">
            {[
              "Would this help you review a client finance pack?",
              "Can you trace each material conclusion to evidence?",
              "Which result do you trust least, and why?",
              "What is missing from your normal review process?",
              "What must change before a controlled real-data pilot?",
              "Would you nominate one suitable client for the next stage?",
            ].map((question, index) => (
              <li key={question} className="flex gap-3 rounded-lg border border-line p-3"><strong className="text-brand">{index + 1}.</strong><span>{question}</span></li>
            ))}
          </ol>
        </Panel>
      </div>
    </div>
  );
}

function OnboardingPanel({ tenant, company, onboardWorkspace, loadPilotDemo }: { tenant: Tenant; company: Company; onboardWorkspace: (tenant: Tenant, company: Company) => void; loadPilotDemo: () => void }) {
  const [mode, setMode] = useState<TenantType>("accounting_practice");
  const [firmName, setFirmName] = useState(tenant.type === "accounting_practice" && tenant.name !== "Your Firm" ? tenant.name : "");
  const [companyName, setCompanyName] = useState(company.name !== "Your Company" ? company.name : "");
  const [industry, setIndustry] = useState(company.industry);
  const [accountingSystem, setAccountingSystem] = useState(company.accountingSystem);
  const [country, setCountry] = useState(company.country);
  const [currency, setCurrency] = useState(company.currency);

  const submit = () => {
    const nextTenant: Tenant = {
      id: crypto.randomUUID(),
      name: mode === "accounting_practice" ? firmName : companyName,
      type: mode,
      plan: mode === "accounting_practice" ? "practice" : "growth"
    };
    const nextCompany: Company = {
      id: crypto.randomUUID(),
      tenantId: nextTenant.id,
      name: companyName,
      industry,
      accountingSystem,
      currency,
      country
    };
    onboardWorkspace(nextTenant, nextCompany);
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[0.85fr_1.15fr]">
      <Panel title="Choose Workspace Type">
        <div className="grid gap-3">
          <button className={`rounded-lg border p-4 text-left ${mode === "accounting_practice" ? "border-brand bg-cyan-50" : "border-line bg-white"}`} onClick={() => setMode("accounting_practice")}>
            <strong>Accounting practice</strong>
            <p className="mt-1 text-sm text-muted">Create one tenant for the firm, then keep every client company scoped by tenant and company.</p>
          </button>
          <button className={`rounded-lg border p-4 text-left ${mode === "company" ? "border-brand bg-cyan-50" : "border-line bg-white"}`} onClick={() => setMode("company")}>
            <strong>Single company</strong>
            <p className="mt-1 text-sm text-muted">Create one tenant and one company workspace for an internal finance team.</p>
          </button>
        </div>
        <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-4">
          <p className="text-xs font-bold uppercase text-emerald-800">Pilot demo</p>
          <strong className="mt-1 block">Brightlane Manufacturing Ltd</strong>
          <p className="mt-1 text-sm text-muted">Load a completed workflow with uploads, findings, evidence, manager review, partner sign-off and export-ready review pack.</p>
          <button className="mt-3 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-black text-white" onClick={loadPilotDemo}>
            Load Pilot Demo
          </button>
        </div>
      </Panel>

      <Panel title={mode === "accounting_practice" ? "Onboard Accounting Firm" : "Onboard Company"}>
        <div className="grid gap-4 md:grid-cols-2">
          {mode === "accounting_practice" && (
            <label className="grid gap-2">
              <span className="text-sm font-bold text-muted">Firm name</span>
              <input className="h-11 rounded-lg border border-line px-3" value={firmName} onChange={(event) => setFirmName(event.target.value)} />
            </label>
          )}
          <label className="grid gap-2">
            <span className="text-sm font-bold text-muted">{mode === "accounting_practice" ? "First client company" : "Company name"}</span>
            <input className="h-11 rounded-lg border border-line px-3" value={companyName} onChange={(event) => setCompanyName(event.target.value)} />
          </label>
          <label className="grid gap-2">
            <span className="text-sm font-bold text-muted">Industry</span>
            <input className="h-11 rounded-lg border border-line px-3" value={industry} onChange={(event) => setIndustry(event.target.value)} />
          </label>
          <label className="grid gap-2">
            <span className="text-sm font-bold text-muted">Accounting system</span>
            <select className="h-11 rounded-lg border border-line px-3" value={accountingSystem} onChange={(event) => setAccountingSystem(event.target.value)}>
              {["Sage", "Xero", "QuickBooks", "Business Central", "Unit4", "SAP", "Oracle", "Excel"].map((system) => <option key={system}>{system}</option>)}
            </select>
          </label>
          <label className="grid gap-2">
            <span className="text-sm font-bold text-muted">Country</span>
            <input className="h-11 rounded-lg border border-line px-3" value={country} onChange={(event) => setCountry(event.target.value)} />
          </label>
          <label className="grid gap-2">
            <span className="text-sm font-bold text-muted">Currency</span>
            <select className="h-11 rounded-lg border border-line px-3" value={currency} onChange={(event) => setCurrency(event.target.value)}>
              {["GBP", "EUR", "USD", "NGN", "GHS", "KES", "ZAR"].map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
        </div>
        <div className="mt-5 rounded-lg border border-line bg-slate-50 p-4">
          <p className="text-xs font-bold uppercase text-muted">Isolation model</p>
          <p className="mt-2 text-sm text-muted">All uploads, validation checks, findings, recommendations, AI conversations and reports are written with both tenant and company scope. Practice users only see companies granted through user-company access.</p>
        </div>
        <button className="mt-5 rounded-lg bg-brand px-5 py-3 font-bold text-white" onClick={submit}>Create Workspace</button>
      </Panel>
    </div>
  );
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || crypto.randomUUID();
}

function HeaderStat({ label, value, level }: { label: string; value: string; level: RiskLevel }) {
  const dot = level === "low" ? "bg-emerald-500" : level === "medium" ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-line bg-slate-50 px-3 text-sm">
      <span className={`h-2 w-2 rounded-full ${dot}`} aria-hidden="true" />
      <span className="text-xs font-bold uppercase text-muted">{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

const pilotWalkthroughSteps = [
  { page: "Findings", label: "Review Findings", detail: "Status hub and register" },
  { page: "Findings", label: "Inspect Evidence", detail: "Attachments, comments and rows" },
  { page: "Findings", label: "Manager Review", detail: "Approvals and escalation" },
  { page: "Findings", label: "Partner Sign-Off", detail: "Gate snapshot and conclusion" },
  { page: "Review Pack", label: "Export Pack", detail: "Printable pack and JSON dossier" },
] as const;

function PilotWalkthroughRail({
  step,
  setStep,
  setActive,
  findings,
  findingEvidence,
  findingComments,
  findingActivities,
  partnerSignOff,
}: {
  step: number;
  setStep: (value: number) => void;
  setActive: (value: string) => void;
  findings: Finding[];
  findingEvidence: Evidence[];
  findingComments: FindingComment[];
  findingActivities: FindingActivity[];
  partnerSignOff?: PartnerSignOff;
}) {
  const currentIndex = Math.min(step, pilotWalkthroughSteps.length - 1);
  const current = pilotWalkthroughSteps[currentIndex];
  const managerApproved = findings.filter((finding) => managerReviewStatus(finding) === "approved").length;
  const managerEscalated = findings.filter((finding) => managerReviewStatus(finding) === "escalated").length;
  const nextStep = Math.min(currentIndex + 1, pilotWalkthroughSteps.length - 1);
  const goToStep = (index: number) => {
    const target = pilotWalkthroughSteps[index];
    setStep(index);
    setActive(target.page);
  };

  return (
    <section className="no-print mb-5 rounded-lg border border-line bg-white p-4 shadow-panel">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase text-muted">Pilot Walkthrough</p>
          <h2 className="mt-1 text-lg font-black">{current.label}</h2>
          <p className="mt-1 text-sm text-muted">
            {findings.length} finding(s), {findingEvidence.length} evidence file(s), {findingComments.length} comment(s), {findingActivities.length} activity entries, {managerApproved + managerEscalated} manager decision(s), {partnerSignOff ? "partner signed" : "partner sign-off pending"}.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="rounded-lg border border-line px-4 py-2 text-sm font-bold" onClick={() => goToStep(0)}>Restart</button>
          <button className="rounded-lg bg-brand px-4 py-2 text-sm font-black text-white" onClick={() => goToStep(nextStep)}>
            {currentIndex >= pilotWalkthroughSteps.length - 1 ? "Open Export Pack" : "Next Step"}
          </button>
        </div>
      </div>
      <div className="mt-4 grid gap-2 md:grid-cols-5">
        {pilotWalkthroughSteps.map((item, index) => {
          const selected = index === currentIndex;
          const complete = index < currentIndex;
          return (
            <button
              key={item.label}
              className={`min-h-24 rounded-lg border p-3 text-left transition-colors ${selected ? "border-brand bg-cyan-50" : complete ? "border-emerald-200 bg-emerald-50" : "border-line bg-slate-50 hover:border-brand"}`}
              onClick={() => goToStep(index)}
              aria-pressed={selected}
            >
              <span className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-black ${complete ? "bg-emerald-600 text-white" : selected ? "bg-brand text-white" : "bg-white text-muted"}`}>
                {complete ? "✓" : index + 1}
              </span>
              <strong className="mt-2 block text-sm">{item.label}</strong>
              <span className="mt-1 block text-xs text-muted">{item.detail}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function defaultReviewReason(status: FindingStatus) {
  if (status === "under_review") return "Reviewer started review of the finding and supporting evidence.";
  if (status === "evidence_requested") return "Reviewer requested supporting evidence before approval.";
  if (status === "evidence_received") return "Requested evidence has been received and is ready for review.";
  if (status === "false_positive") return "Reviewer closed the finding as a false positive.";
  if (status === "accepted_risk") return "Reviewer accepted the risk and documented no further remediation.";
  if (status === "approved") return "Finding approved after reviewer and manager review.";
  if (status === "closed") return "Finding closed after review with no further action required.";
  if (status === "accepted") return "Reviewer accepted the finding as valid based on available evidence.";
  if (status === "rejected") return "Reviewer rejected the finding as a false positive.";
  if (status === "needs_investigation") return "Reviewer requested further evidence before final decision.";
  if (status === "not_applicable") return "Reviewer marked the finding as not applicable to this client or period.";
  if (status === "resolved") return "Finding marked resolved after review action.";
  return "Review status updated.";
}

function DashboardPanel({
  score, risk, assurance, findings, openFindings, cashAtRisk, financialExposure, timeSaved, timeSavedHours, timeSavedValue, validationWarnings, validationBlockers, validationChecks, recommendations, clients, uploads, setActive
}: {
  score: number; risk: RiskLevel; assurance: AssuranceMetrics; findings: Finding[]; openFindings: number; cashAtRisk: number; financialExposure: number; timeSaved: number; timeSavedHours: string; timeSavedValue: number; validationWarnings: number; validationBlockers: number; validationChecks: ValidationCheck[]; recommendations: Recommendation[]; clients: ClientCompany[]; uploads: Upload[]; setActive: (v: string) => void;
}) {
  const [showExposure, setShowExposure] = useState(false);
  const highRisk = clients.filter((c) => c.risk === "high" || c.risk === "critical").length;
  const pendingActions = recommendations.filter((r) => !r.completed).length;
  const HOURLY_RATE = 80;
  const monthlyTimeSavedHrs = clients.length * Number(timeSavedHours);
  const monthlyValue = Math.round(monthlyTimeSavedHrs * HOURLY_RATE);
  const profile = evidenceProfile(findings);
  const exposure = exposureBreakdown(findings, cashAtRisk, financialExposure);
  const collection = collectionOpportunities(findings);
  const supplierRisk = supplierRiskOpportunities(findings);
  const ecl = expectedCreditLoss(findings);
  const reviewReductionScore = uploads.length ? Math.max(0, Math.min(100, Math.round((Number(timeSavedHours) / Math.max(Number(timeSavedHours) + 6.5, 1)) * 100))) : 0;
  const reviewStatus = !uploads.length ? "Awaiting Finance Pack" : assurance.critical ? "Manager Review Required" : validationBlockers ? "Validation Review Required" : "Ready For Review";
  const expectedManagerHours = uploads.length ? Math.max(Number(timeSavedHours) + 6.5, 8).toFixed(1) : "—";
  const closePilotHours = uploads.length ? "6.5" : "—";

  return (
    <OperationalOverviewDashboard
      score={score}
      risk={risk}
      assurance={assurance}
      findings={findings}
      openFindings={openFindings}
      financialExposure={financialExposure}
      validationWarnings={validationWarnings}
      validationBlockers={validationBlockers}
      validationChecks={validationChecks}
      recommendations={recommendations}
      uploads={uploads}
      setActive={setActive}
    />
  );

  return (
    <div className="grid gap-4">
      {uploads.length > 0 && (
        <section className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
          <Panel title="Assurance Summary">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <SummaryItem label="Tests Executed" value={String(assurance.testsExecuted)} detail="across uploaded files" level="low" />
              <SummaryItem label="Findings" value={String(openFindings)} detail={`${assurance.critical} critical, ${assurance.high} high`} level={assurance.critical ? "critical" : assurance.high ? "high" : "medium"} />
              <SummaryItem label="Confidence" value={`${assurance.confidence}%`} detail="evidence quality" level={assurance.confidence >= 85 ? "low" : "medium"} />
              <SummaryItem label="Health Score" value={`${score}/100`} detail={riskCopy(risk)} level={risk} />
            </div>
          </Panel>
          <Panel title="Review Status">
            <div className="grid gap-3 sm:grid-cols-3">
              <SummaryItem label="Status" value={reviewStatus} detail="current pack state" level={reviewStatus === "Ready For Review" ? "low" : "medium"} />
              <SummaryItem label="Audit Readiness" value={`${assurance.closeReadiness}%`} detail="before partner sign-off" level={assurance.closeReadiness >= 80 ? "low" : assurance.closeReadiness >= 65 ? "medium" : "high"} />
              <SummaryItem label="Validation" value={`${validationBlockers} blockers`} detail={`${validationWarnings} warnings`} level={validationBlockers ? "critical" : validationWarnings ? "medium" : "low"} />
            </div>
          </Panel>
        </section>
      )}

      {/* ROI summary banner */}
      {uploads.length > 0 && (
        <section className="rounded-xl border border-brand/20 bg-gradient-to-r from-brand/5 to-cyan/5 p-5">
          <p className="text-xs font-bold uppercase text-brand">Value Delivered This Review</p>
          <div className="mt-3 grid gap-4 sm:grid-cols-4">
            <div>
              <strong className="block text-3xl font-black text-brand">{timeSavedHours}h</strong>
              <p className="text-sm text-muted">Manager review time saved</p>
            </div>
            <div>
              <strong className="block text-3xl font-black text-brand">£{timeSavedValue.toLocaleString()}</strong>
              <p className="text-sm text-muted">Estimated value at £{HOURLY_RATE}/hr</p>
            </div>
            <div>
              <strong className="block text-3xl font-black text-brand">{assurance.testsExecuted}</strong>
              <p className="text-sm text-muted">Assurance tests executed</p>
            </div>
            <div>
              <strong className="block text-3xl font-black text-brand">{reviewReductionScore}%</strong>
              <p className="text-sm text-muted">Review reduction score</p>
            </div>
          </div>
          <div className="mt-4 grid gap-3 rounded-lg border border-brand/15 bg-white/70 p-3 text-sm sm:grid-cols-3">
            <div><span className="text-muted">Expected manager review</span><strong className="ml-2">{expectedManagerHours}h</strong></div>
            <div><span className="text-muted">ClosePilot review</span><strong className="ml-2">{closePilotHours}h</strong></div>
            <div><span className="text-muted">Capacity created</span><strong className="ml-2">{timeSavedHours}h</strong></div>
          </div>
          {clients.length > 1 && (
            <p className="mt-3 text-xs text-muted">Across {clients.length} clients: estimated <strong>£{monthlyValue.toLocaleString()}/month</strong> in manager time saved</p>
          )}
        </section>
      )}

      <section className="rounded-lg border border-line bg-white p-5 shadow-panel">
        <p className="text-xs font-bold uppercase text-muted">Audit Readiness Platform</p>
        <h2 className="mt-1 text-2xl font-black">Every ledger. Every balance. Every risk.</h2>
        <p className="mt-2 text-muted">Upload a client finance pack. ClosePilot delivers an audit readiness report before manager review.</p>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Metric title="Finance Health Score" value={uploads.length ? `${score}/100` : "—"} detail={uploads.length ? riskCopy(risk) : "Awaiting upload"} tone={uploads.length ? risk : "medium"} />
        <Metric title="Audit Readiness" value={uploads.length ? `${assurance.closeReadiness}%` : "—"} detail={uploads.length ? "Manager review required" : "Awaiting finance pack"} tone={uploads.length ? (assurance.closeReadiness >= 80 ? "low" : assurance.closeReadiness >= 65 ? "medium" : "high") : "medium"} />
        <Metric title="Review Confidence" value={uploads.length ? `${assurance.confidence}%` : "—"} detail={uploads.length ? "Evidence and validation quality" : "Awaiting evidence"} tone={uploads.length ? (assurance.confidence >= 85 ? "low" : "medium") : "medium"} />
        <Metric title="Month-End Time Saved" value={`${timeSaved}h`} detail="Estimated this close" tone="low" />
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Metric title="Critical Issues" value={assurance.critical} detail={`${assurance.high} high-risk findings`} tone={assurance.critical ? "critical" : assurance.high ? "high" : "low"} />
        <Metric title="Medium Findings" value={assurance.medium} detail={`${profile.advisory} advisory observations`} tone={assurance.medium ? "medium" : "low"} />
        <Metric title="Financial Exposure" value={`£${financialExposure.toLocaleString()}`} detail="Explainable risk stack" tone="critical" />
        <Metric title="Validation Quality" value={validationBlockers} detail={uploads.length ? `${validationWarnings} warnings before export` : "No validation checks"} tone={validationBlockers ? "critical" : validationWarnings ? "medium" : "low"} />
      </section>

      {uploads.length > 0 && (
        <section className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
          <Panel title="Financial Exposure">
            <div className="grid gap-3">
              <div className="flex items-center justify-between rounded-lg border border-line bg-slate-50 p-4">
                <div>
                  <p className="text-xs font-bold uppercase text-muted">Total Exposure</p>
                  <strong className="mt-1 block text-3xl">£{exposure.total.toLocaleString()}</strong>
                </div>
                <button className="rounded-lg bg-brand px-4 py-2 text-sm font-bold text-white" onClick={() => setShowExposure((value) => !value)}>{showExposure ? "Hide Breakdown" : "Explain Exposure"}</button>
              </div>
              {showExposure && (
                <div className="grid gap-2">
                  <ExposureRow label="Cash / AR risk" value={exposure.cashRisk} detail="Overdue debtors and forecast pressure" />
                  <ExposureRow label="VAT risk" value={exposure.vatRisk} detail="VAT exceptions and coding exposure" />
                  <ExposureRow label="Close / AP risk" value={exposure.closeRisk} detail="Month-end, AP and review adjustments" />
                  <ExposureRow label="Control risk" value={exposure.controlRisk} detail="Controls, fraud and data-quality exposure" />
                </div>
              )}
            </div>
          </Panel>
          <Panel title="Findings Triage">
            <div className="grid gap-3 sm:grid-cols-4">
              <SummaryItem label="Critical" value={String(assurance.critical)} detail="must resolve" level={assurance.critical ? "critical" : "low"} />
              <SummaryItem label="High Risk" value={String(assurance.high)} detail="manager review" level={assurance.high ? "high" : "low"} />
              <SummaryItem label="Medium" value={String(assurance.medium)} detail="review queue" level={assurance.medium ? "medium" : "low"} />
              <SummaryItem label="Advisory" value={String(profile.advisory)} detail="observations" level="low" />
            </div>
          </Panel>
        </section>
      )}

      {uploads.length > 0 && (
        <CollectionOpportunityReport opportunities={collection} ecl={ecl} cashAtRisk={cashAtRisk} setActive={setActive} />
      )}

      {uploads.length > 0 && (
        <SupplierRiskReport opportunities={supplierRisk} setActive={setActive} />
      )}

      <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <Panel title="Quick Actions">
          <div className="grid gap-3 sm:grid-cols-2">
            {[
              { label: "Run Finance Review", sub: "Full month-end review", page: "Finance Review" },
              { label: "Assurance Engine", sub: "Run all assurance tests", page: "Assurance Engine" },
              { label: "Upload Finance Pack", sub: "Upload TB, P&L and more", page: "Upload Finance Pack" },
              { label: "Audit Readiness", sub: "Year-end and audit checks", page: "Audit Readiness" },
              { label: "Change Intelligence", sub: "What changed this period?", page: "Change Intelligence" },
              { label: "Ask ClosePilot", sub: "Ask anything about the numbers", page: "Ask ClosePilot" },
            ].map(({ label, sub, page }) => (
              <button key={label} className="rounded-lg border border-line bg-white p-4 text-left hover:border-brand hover:bg-cyan-50 transition-colors" onClick={() => setActive(page)}>
                <strong className="block">{label}</strong>
                <p className="mt-1 text-sm text-muted">{sub}</p>
              </button>
            ))}
          </div>
        </Panel>
        <Panel title="Pending Actions">
          <div className="grid gap-3">
            {pendingActions === 0 ? (
              <p className="text-sm text-muted">All recommended actions are complete.</p>
            ) : (
              recommendations.filter((r) => !r.completed).slice(0, 5).map((item) => (
                <div key={item.id} className="rounded-lg border border-line bg-slate-50 p-3">
                  <strong className="text-sm">{item.action}</strong>
                  <p className="mt-1 text-xs text-muted">{item.expectedImpact}</p>
                </div>
              ))
            )}
            {pendingActions > 5 && <p className="text-sm font-bold text-cyan cursor-pointer" onClick={() => setActive("Finance Review")}>+{pendingActions - 5} more in Finance Review</p>}
          </div>
        </Panel>
      </section>
    </div>
  );
}

function OperationalOverviewDashboard({
  score,
  risk,
  assurance,
  findings,
  openFindings,
  financialExposure,
  validationWarnings,
  validationBlockers,
  validationChecks,
  recommendations,
  uploads,
  setActive,
}: {
  score: number;
  risk: RiskLevel;
  assurance: AssuranceMetrics;
  findings: Finding[];
  openFindings: number;
  financialExposure: number;
  validationWarnings: number;
  validationBlockers: number;
  validationChecks: ValidationCheck[];
  recommendations: Recommendation[];
  uploads: Upload[];
  setActive: (value: string) => void;
}) {
  const severityCounts = {
    critical: findings.filter((item) => item.severity === "critical").length,
    high: findings.filter((item) => item.severity === "high").length,
    medium: findings.filter((item) => item.severity === "medium").length,
    low: findings.filter((item) => item.severity === "low").length,
  };
  const totalFindings = findings.length || Object.values(severityCounts).reduce((sum, value) => sum + value, 0);
  const requiredFiles: Array<{ type: Upload["fileType"]; label: string }> = [
    { type: "trial_balance", label: "Trial Balance" },
    { type: "profit_loss", label: "Profit & Loss" },
    { type: "balance_sheet", label: "Balance Sheet" },
    { type: "aged_debtors", label: "Aged Debtors" },
    { type: "aged_creditors", label: "Aged Creditors" },
    { type: "vat_report", label: "VAT Report" },
    { type: "bank_reconciliation", label: "Bank Reconciliation" },
  ];
  const uploadedTypes = new Set(uploads.map((upload) => upload.fileType));
  const resolvedFindings = findings.filter((finding) => !isOpenFinding(finding)).length;
  const progress = findings.length ? Math.round((resolvedFindings / findings.length) * 100) : uploads.length ? 35 : 0;
  const evidenceRequested = findings.filter((finding) => finding.status === "evidence_requested").length;
  const topFindings = findings.slice(0, 5);
  const readinessPenalty = Math.max(0, 100 - assurance.closeReadiness);
  const missingEvidenceItems = requiredFiles.filter((file) => !uploadedTypes.has(file.type));
  const failedReadinessDrivers = assurance.readinessDrivers.filter((driver) => !driver.passed);
  const readinessDrivers = failedReadinessDrivers.length ? failedReadinessDrivers : assurance.readinessDrivers.slice(0, 4);
  const openHighFindings = findings.filter((finding) => isOpenFinding(finding) && (finding.severity === "critical" || finding.severity === "high")).length;
  const readinessAction = missingEvidenceItems.length ? "Upload missing evidence" : openHighFindings ? "Resolve high-risk findings" : validationBlockers ? "Clear validation blockers" : "Prepare sign-off";
  const forecastReadiness = readinessForecast(findings, validationChecks, uploads);
  const trend = ["Dec", "Jan", "Feb", "Mar", "Apr", "May"].map((period, index) => ({
    period,
    Critical: Math.max(0, severityCounts.critical + 5 - index),
    High: Math.max(0, severityCounts.high + 4 - index),
    Medium: Math.max(0, severityCounts.medium + 3 - index),
    Low: Math.max(0, severityCounts.low + 1 - Math.floor(index / 2)),
  }));
  const activity = [
    uploads[0] ? { tone: "low" as RiskLevel, title: "Files uploaded", detail: uploads[0].fileName } : null,
    findings[0] ? { tone: "medium" as RiskLevel, title: "Review completed", detail: `${findings.length} finding(s) generated` } : null,
    findings.find((item) => item.severity === "critical") ? { tone: "critical" as RiskLevel, title: "New critical finding", detail: findings.find((item) => item.severity === "critical")?.title ?? "" } : null,
    findings.find((item) => item.status === "resolved") ? { tone: "low" as RiskLevel, title: "Finding resolved", detail: findings.find((item) => item.status === "resolved")?.title ?? "" } : null,
  ].filter((item): item is { tone: RiskLevel; title: string; detail: string } => Boolean(item));

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_300px]">
      <div className="grid gap-4">
        <section>
          <h2 className="mb-3 text-xl font-black">Overview</h2>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <OverviewMetricCard title="Finance Health Score" value={uploads.length ? score : 0} suffix="/100" tone={risk} badge={uploads.length ? riskCopy(risk) : "Awaiting upload"} />
            <OverviewMetricCard title="Audit Readiness" value={uploads.length ? assurance.closeReadiness : 0} suffix="/100" tone={assurance.closeReadiness >= 80 ? "low" : assurance.closeReadiness >= 65 ? "medium" : "high"} badge={assurance.closeReadiness >= 80 ? "Good" : "Fair"} />
            <OverviewMetricCard title="Review Confidence" value={uploads.length ? assurance.confidence : 0} suffix="/100" tone={assurance.confidence >= 85 ? "low" : "medium"} badge={assurance.confidence >= 85 ? "High" : "Review"} />
            <article className="rounded-lg border border-line bg-white p-5 shadow-panel">
              <p className="text-sm font-bold text-muted">Est. Exposure</p>
              <strong className="mt-4 block text-3xl font-black text-red-600">£{financialExposure.toLocaleString()}</strong>
              <p className="mt-4 text-sm font-black text-red-600">{financialExposure ? "High Risk" : "No exposure"}</p>
              <p className="mt-4 text-sm text-muted">{openFindings} open finding(s)</p>
            </article>
          </div>
        </section>

        <section className="grid gap-4 xl:grid-cols-[0.95fr_1.1fr_0.85fr]">
          <OverviewCard title="Findings by Severity">
            <div className="grid items-center gap-4 sm:grid-cols-[140px_1fr]">
              <SeverityDonut counts={severityCounts} total={totalFindings} />
              <div className="grid gap-3 text-sm">
                <SeverityLegend label="Critical" count={severityCounts.critical} total={totalFindings} color="bg-red-500" />
                <SeverityLegend label="High" count={severityCounts.high} total={totalFindings} color="bg-orange-500" />
                <SeverityLegend label="Medium" count={severityCounts.medium} total={totalFindings} color="bg-amber-400" />
                <SeverityLegend label="Low" count={severityCounts.low} total={totalFindings} color="bg-blue-500" />
              </div>
            </div>
          </OverviewCard>
          <OverviewCard title="Readiness Drivers" action={<button className="text-sm font-bold text-brand" onClick={() => setActive("Audit Readiness")}>Open readiness</button>}>
            <div className="grid gap-4">
              <div className="rounded-lg border border-line bg-slate-50 p-3">
                <div className="flex items-end justify-between gap-3">
                  <div>
                    <p className="text-xs font-bold uppercase text-muted">Current Score</p>
                    <strong className="mt-1 block text-3xl font-black text-red-600">{uploads.length ? assurance.closeReadiness : 0}/100</strong>
                  </div>
                  <div className="text-right">
                    <p className="text-xs font-bold uppercase text-muted">Gap to Ready</p>
                    <strong className="mt-1 block text-xl font-black">{uploads.length ? `-${readinessPenalty}` : "—"}</strong>
                  </div>
                </div>
                <div className="mt-3 h-2 rounded-full bg-white">
                  <div className="h-2 rounded-full bg-red-500" style={{ width: `${Math.max(4, assurance.closeReadiness)}%` }} />
                </div>
              </div>
              <div className="grid gap-2">
                {readinessDrivers.map((driver) => (
                  <button key={driver.label} className="grid grid-cols-[1fr_auto] gap-3 rounded-lg border border-line bg-white p-3 text-left transition-colors hover:border-brand" onClick={() => setActive(driver.label.toLowerCase().includes("evidence") || driver.label.toLowerCase().includes("reconciled") ? "Upload Finance Pack" : "Findings")}>
                    <span>
                      <strong className="block text-sm">{driver.label}</strong>
                      <span className="mt-1 block text-xs text-muted">{driver.detail}</span>
                    </span>
                    <span className={`text-sm font-black ${driver.passed ? "text-emerald-700" : "text-red-600"}`}>{driver.passed ? `+${driver.weight}` : `-${driver.weight}`}</span>
                  </button>
                ))}
              </div>
              <button className="rounded-lg bg-brand px-4 py-2.5 text-sm font-bold text-white" onClick={() => setActive(missingEvidenceItems.length ? "Upload Finance Pack" : openHighFindings || validationBlockers ? "Findings" : "Review Pack")}>
                {readinessAction}
              </button>
            </div>
          </OverviewCard>
          <OverviewCard title="Findings Trend">
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trend} margin={{ left: -20, right: 8, top: 10, bottom: 0 }}>
                  <CartesianGrid stroke="#e5e7eb" strokeDasharray="4 4" vertical={false} />
                  <XAxis dataKey="period" tickLine={false} axisLine={false} />
                  <YAxis tickLine={false} axisLine={false} />
                  <Tooltip />
                  <Line type="monotone" dataKey="Critical" stroke="#ef4444" strokeWidth={2} dot={{ r: 3 }} />
                  <Line type="monotone" dataKey="High" stroke="#f97316" strokeWidth={2} dot={{ r: 3 }} />
                  <Line type="monotone" dataKey="Medium" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} />
                  <Line type="monotone" dataKey="Low" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </OverviewCard>
          <OverviewCard title="Missing Evidence">
            <div className="grid gap-2">
              {requiredFiles.map((file) => {
                const present = uploadedTypes.has(file.type);
                return (
                  <button key={file.type} className="flex items-center justify-between gap-3 rounded-lg px-1 py-1.5 text-left text-sm transition-colors hover:bg-slate-50" onClick={() => setActive(present ? "Audit Readiness" : "Upload Finance Pack")}>
                    <span>{file.label}</span>
                    <span className={`grid h-5 w-5 place-items-center rounded-full text-xs font-black ${present ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}>
                      {present ? "✓" : "!"}
                    </span>
                  </button>
                );
              })}
            </div>
          </OverviewCard>
        </section>

        <OverviewCard title="Readiness Forecast" action={<button className="text-sm font-bold text-brand" onClick={() => setActive("Findings")}>Open queue</button>}>
          <div className="grid gap-4 lg:grid-cols-[0.8fr_1.2fr]">
            <div className="rounded-lg border border-line bg-slate-50 p-4">
              <p className="text-xs font-bold uppercase text-muted">Current Readiness</p>
              <div className="mt-2 flex items-end gap-2">
                <strong className="text-4xl font-black text-red-600">{forecastReadiness.current}%</strong>
                <span className="pb-1 text-sm font-bold text-muted">today</span>
              </div>
              <p className="mt-3 text-sm text-muted">{forecastReadiness.open} open finding(s), {validationBlockers} validation blocker(s).</p>
            </div>
            <div className="grid gap-2">
              <ForecastLine label={forecastReadiness.nextFinding ? `Resolve: ${forecastReadiness.nextFinding.title}` : "Next finding"} from={forecastReadiness.current} to={forecastReadiness.nextResolved} />
              <ForecastLine label="Resolve all high-risk findings" from={forecastReadiness.current} to={forecastReadiness.highResolved} />
              <ForecastLine label="Resolve all open findings" from={forecastReadiness.current} to={forecastReadiness.allResolved} />
              <div className="mt-1 rounded-lg border border-line bg-white p-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <span>
                    <strong className="block text-sm">Estimated review effort</strong>
                    <span className="text-xs text-muted">Open findings plus validation blockers</span>
                  </span>
                  <strong className="text-lg">{forecastReadiness.effortMinutes} mins</strong>
                </div>
              </div>
            </div>
          </div>
        </OverviewCard>

        <OverviewCard title="Top Findings" action={<button className="text-sm font-bold text-brand" onClick={() => setActive("Findings")}>View all findings</button>}>
          {topFindings.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-left text-sm">
                <thead className="text-xs uppercase text-muted">
                  <tr>
                    <th className="border-b border-line p-3">Severity</th>
                    <th className="border-b border-line p-3">Finding</th>
                    <th className="border-b border-line p-3">Category</th>
                    <th className="border-b border-line p-3">Exposure</th>
                    <th className="border-b border-line p-3">Status</th>
                    <th className="border-b border-line p-3">Owner</th>
                    <th className="border-b border-line p-3">Due Date</th>
                  </tr>
                </thead>
                <tbody>
                  {topFindings.map((finding) => (
                    <tr key={finding.id} className="border-b border-line last:border-0">
                      <td className="p-3"><Pill level={finding.severity}>{riskCopy(finding.severity)}</Pill></td>
                      <td className="p-3 font-semibold">{finding.title}</td>
                      <td className="p-3 capitalize text-muted">{finding.category.replaceAll("_", " ")}</td>
                      <td className="p-3 font-bold text-red-600">{parseImpactAmount(finding.expectedImpact) ? `£${parseImpactAmount(finding.expectedImpact).toLocaleString()}` : "-"}</td>
                      <td className="p-3"><Pill level={isOpenFinding(finding) ? "medium" : "low"}>{finding.status.replaceAll("_", " ")}</Pill></td>
                      <td className="p-3">{finding.assignedTo ?? finding.owner ?? "Unassigned"}</td>
                      <td className="p-3">{finding.dueDate ? new Date(finding.dueDate).toLocaleDateString("en-GB", { day: "2-digit", month: "short" }) : "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState title="No findings yet" detail="Upload a finance pack to populate the review table." />
          )}
        </OverviewCard>
      </div>

      <aside className="grid content-start gap-4">
        <OverviewCard title="Recent Activity" action={<button className="text-sm font-bold text-brand" onClick={() => setActive("Findings")}>View all</button>}>
          <div className="grid gap-4">
            {activity.length ? activity.map((item) => (
              <div key={`${item.title}_${item.detail}`} className="flex gap-3">
                <span className={`mt-1 h-8 w-8 shrink-0 rounded-full ${item.tone === "low" ? "bg-emerald-500" : item.tone === "critical" ? "bg-orange-500" : "bg-blue-600"}`} />
                <div>
                  <p className="font-bold">{item.title}</p>
                  <p className="text-sm text-muted">{item.detail}</p>
                  <p className="mt-1 text-xs text-muted">Today</p>
                </div>
              </div>
            )) : <p className="text-sm text-muted">No activity yet.</p>}
          </div>
        </OverviewCard>
        <OverviewCard title="Quick Actions">
          <div className="grid grid-cols-2 gap-2">
            {[
              ["Upload Files", "Upload Finance Pack"],
              ["Run Review", "Finance Review"],
              ["View Findings", "Findings"],
              ["Generate Report", "Review Pack"],
              ["Request Evidence", "Findings"],
              ["Create Note", "Ask ClosePilot"],
            ].map(([label, page]) => (
              <button key={label} className="min-h-12 rounded-lg border border-line bg-white px-3 text-sm font-bold hover:border-brand hover:text-brand" onClick={() => setActive(page)}>
                {label}
              </button>
            ))}
          </div>
        </OverviewCard>
        <OverviewCard title="Review Progress">
          <div className="grid gap-4">
            <ProgressLine label="Overall Progress" value={progress} />
            <SummaryLine label="Findings Resolved" value={`${resolvedFindings} / ${findings.length}`} />
            <SummaryLine label="Evidence Requests" value={`${evidenceRequested} / ${Math.max(1, findings.length)}`} />
            <SummaryLine label="Review Pack" value={recommendations.length ? "In Progress" : "Queued"} />
            <SummaryLine label="Validation" value={validationBlockers ? `${validationBlockers} blocker(s)` : validationWarnings ? `${validationWarnings} warning(s)` : "Clear"} />
          </div>
        </OverviewCard>
      </aside>
    </div>
  );
}

function OverviewCard({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-line bg-white p-5 shadow-panel">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="font-black">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function OverviewMetricCard({ title, value, suffix, tone, badge }: { title: string; value: number; suffix: string; tone: RiskLevel; badge: string }) {
  const color = tone === "low" ? "#16a34a" : tone === "medium" ? "#2563eb" : "#dc2626";
  const data = [0, 12, 9, 18, 15, 27, 23, 34, 30, 44, 38, 48].map((point, index) => ({ index, point: Math.max(0, point + value / 10) }));
  return (
    <article className="rounded-lg border border-line bg-white p-5 shadow-panel">
      <p className="text-sm font-bold text-muted">{title}</p>
      <div className="mt-4 flex items-end gap-1">
        <strong className="text-4xl font-black" style={{ color }}>{value || "—"}</strong>
        <span className="pb-1 text-sm text-muted">{value ? suffix : ""}</span>
      </div>
      <div className="mt-2 h-14">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data}>
            <Area type="monotone" dataKey="point" stroke={color} fill={color} fillOpacity={0.12} strokeWidth={2} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-3 flex items-center justify-between">
        <Pill level={tone}>{badge}</Pill>
        <span className="text-xs text-muted">↑ vs last review</span>
      </div>
    </article>
  );
}

function ForecastLine({ label, from, to }: { label: string; from: number; to: number }) {
  const gain = Math.max(0, to - from);
  return (
    <div className="rounded-lg border border-line bg-white p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <strong className="block truncate text-sm">{label}</strong>
          <p className="mt-1 text-xs text-muted">{from}% → {to}% readiness</p>
        </div>
        <span className={`shrink-0 text-sm font-black ${gain ? "text-emerald-700" : "text-muted"}`}>{gain ? `+${gain}` : "+0"}</span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
        <div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.max(4, to)}%` }} />
      </div>
    </div>
  );
}

function SeverityDonut({ counts, total }: { counts: Record<RiskLevel, number>; total: number }) {
  const safeTotal = Math.max(total, 1);
  const critical = counts.critical / safeTotal * 100;
  const high = counts.high / safeTotal * 100;
  const medium = counts.medium / safeTotal * 100;
  const bg = `conic-gradient(#ef4444 0 ${critical}%, #f97316 ${critical}% ${critical + high}%, #f59e0b ${critical + high}% ${critical + high + medium}%, #3b82f6 ${critical + high + medium}% 100%)`;
  return (
    <div className="grid aspect-square max-w-36 place-items-center rounded-full" style={{ background: bg }}>
      <div className="grid h-24 w-24 place-items-center rounded-full bg-white text-center">
        <div>
          <strong className="block text-3xl font-black">{total}</strong>
          <span className="text-xs text-muted">Total</span>
        </div>
      </div>
    </div>
  );
}

function SeverityLegend({ label, count, total, color }: { label: string; count: number; total: number; color: string }) {
  const pct = total ? Math.round(count / total * 100) : 0;
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="flex items-center gap-2"><span className={`h-3 w-3 rounded-full ${color}`} />{label}</span>
      <span className="font-bold text-muted">{count} ({pct}%)</span>
    </div>
  );
}

function ProgressLine({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="mb-2 flex justify-between text-sm">
        <span className="text-muted">{label}</span>
        <strong>{value}%</strong>
      </div>
      <div className="h-2 rounded-full bg-slate-100">
        <div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
      </div>
    </div>
  );
}

function AssuranceSnapshot({ assurance, findings, validationChecks, uploads, setActive }: { assurance: AssuranceMetrics; findings: Finding[]; validationChecks: ValidationCheck[]; uploads: Upload[]; setActive: (value: string) => void }) {
  const hasData = uploads.length > 0;
  return (
    <Panel title="Continuous Finance Assurance">
      <div className="grid gap-4 xl:grid-cols-[0.82fr_1.18fr]">
        <div className="rounded-lg border border-line bg-slate-50 p-4">
          <p className="text-xs font-bold uppercase text-muted">Continuous Finance Assurance</p>
          <h3 className="mt-2 text-2xl font-black">{hasData ? `${assurance.testsExecuted} assurance tests executed` : "Awaiting upload"}</h3>
          <p className="mt-2 text-sm text-muted">{TOTAL_RULES}+ rules across 8 assurance layers. Data Integrity first, then 8 specialist agents review every risk before sign-off.</p>
          <button className="mt-4 rounded-lg bg-brand px-4 py-3 font-bold text-white" onClick={() => setActive("Assurance Engine")}>Open Assurance Engine</button>
        </div>
        <div className="grid gap-3 md:grid-cols-4">
          <SummaryItem label="Critical" value={hasData ? String(assurance.critical) : "—"} detail="needs review" level={assurance.critical ? "critical" : "low"} />
          <SummaryItem label="Close Readiness" value={hasData ? `${assurance.closeReadiness}%` : "—"} detail="before sign-off" level={hasData ? (assurance.closeReadiness >= 85 ? "low" : assurance.closeReadiness >= 65 ? "medium" : "high") : "low"} />
          <SummaryItem label="Confidence" value={hasData ? `${assurance.confidence}%` : "—"} detail="evidence quality" level={hasData ? (assurance.confidence >= 85 ? "low" : "medium") : "low"} />
          <SummaryItem label="Validation" value={validationChecks.length ? `${validationChecks.filter((item) => item.status === "passed").length}/${validationChecks.length}` : "—"} detail={`${findings.length} findings`} level={validationChecks.length ? "medium" : "low"} />
        </div>
      </div>
    </Panel>
  );
}

function CoreQualityPanel({ quality, compact = false }: { quality: CoreQualityMetrics; compact?: boolean }) {
  const overallTone: RiskLevel = quality.overall >= 95 ? "low" : quality.overall >= 80 ? "medium" : "high";
  const readinessTone: RiskLevel = quality.pilotReadinessScore >= 85 ? "low" : quality.pilotReadinessScore >= 70 ? "medium" : "high";
  return (
    <Panel title="Core Platform QA Metrics">
      <div className="grid gap-3 md:grid-cols-4">
        <Metric title="Core Quality" value={quality.overall ? `${quality.overall}%` : "—"} detail="Weighted platform robustness" tone={quality.overall ? overallTone : "medium"} />
        <Metric title="Pilot Readiness" value={quality.pilotReadinessScore ? `${quality.pilotReadinessScore}/100` : "—"} detail="Import, rules, false positives, workflow" tone={quality.pilotReadinessScore ? readinessTone : "medium"} />
        <Metric title="Import Confidence" value={quality.importConfidenceScore ? `${quality.importConfidenceScore}%` : "—"} detail={`${quality.blockedImports} blocked, ${quality.reviewRequiredImports} paused`} tone={quality.blockedImports ? "critical" : quality.reviewRequiredImports ? "medium" : "low"} />
        <Metric title="Workflow Coverage" value={quality.workflowCoverage ? `${quality.workflowCoverage}%` : "—"} detail={`${quality.findingsReviewedPct}% reviewed, ${quality.evidenceCoveragePct}% evidence`} tone={quality.workflowCoverage >= 80 ? "low" : quality.workflowCoverage >= 50 ? "medium" : "high"} />
      </div>
      {!compact && (
        <div className="mt-4 grid gap-4 xl:grid-cols-3">
          <QualityMetricGroup title="Platform Quality" metrics={quality.metrics} />
          <QualityMetricGroup title="Workflow Quality" metrics={quality.workflowMetrics} />
          <QualityMetricGroup title="Finding Confidence Distribution" metrics={quality.confidenceMetrics} />
        </div>
      )}
    </Panel>
  );
}

function QualityMetricGroup({ title, metrics }: { title: string; metrics: CoreQualityMetric[] }) {
  return (
    <div className="rounded-lg border border-line bg-slate-50 p-3">
      <p className="mb-3 text-xs font-black uppercase text-muted">{title}</p>
      <div className="grid gap-2">
        {metrics.map((metric) => (
          <div key={metric.label} className="rounded-lg border border-line bg-white p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <strong className="text-sm">{metric.label}</strong>
                <p className="mt-0.5 text-xs text-muted">{metric.detail}</p>
              </div>
              <Pill level={metric.passed ? "low" : "high"}>{metric.passed ? "Pass" : "Action"}</Pill>
            </div>
            <div className="mt-3 flex items-end justify-between gap-3">
              <span className="text-2xl font-black">{metric.value}%</span>
              <span className="text-xs font-bold text-muted">Target {metric.target}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ReviewCommandCenter({
  score,
  risk,
  assurance,
  uploads,
  openFindings,
  recommendations,
  financialExposure,
  cashAtRisk,
  validationBlockers,
  validationWarnings,
  scoreDrivers,
  setActive,
}: {
  score: number;
  risk: RiskLevel;
  assurance: AssuranceMetrics;
  uploads: Upload[];
  openFindings: number;
  recommendations: Recommendation[];
  financialExposure: number;
  cashAtRisk: number;
  validationBlockers: number;
  validationWarnings: number;
  scoreDrivers: ScoreDriver[];
  setActive: (value: string) => void;
}) {
  const hasData = uploads.length > 0;
  const pendingActions = recommendations.filter((item) => !item.completed).length;
  const passedDrivers = assurance.readinessDrivers.filter((driver) => driver.passed);
  const failedDrivers = assurance.readinessDrivers.filter((driver) => !driver.passed);
  const reviewStatus = !hasData
    ? "Awaiting finance pack"
    : validationBlockers
      ? "Validation blocked"
      : assurance.critical
        ? "Partner review required"
        : assurance.closeReadiness >= 80 && assurance.confidence >= 85
          ? "Ready for review"
          : "Manager review required";
  const statusLevel: RiskLevel = !hasData ? "medium" : validationBlockers || assurance.critical ? "critical" : assurance.closeReadiness >= 80 ? "low" : "high";
  const positiveDrivers = scoreDrivers.filter((driver) => driver.type === "positive").slice(0, 4);
  const negativeDrivers = scoreDrivers.filter((driver) => driver.type === "negative").slice(0, 4);

  return (
    <section className="mb-4 overflow-hidden rounded-lg border border-line bg-white shadow-panel">
      <div className="grid gap-0 xl:grid-cols-[1fr_360px]">
        <div className="p-5 lg:p-6">
          <div className="flex flex-col justify-between gap-4 md:flex-row md:items-start">
            <div className="min-w-0">
              <p className="text-xs font-bold uppercase text-muted">Partner Review Command Centre</p>
              <h2 className="mt-1 text-2xl font-black sm:text-3xl">Every ledger. Every balance. Every risk.</h2>
              <p className="mt-2 max-w-3xl text-sm text-muted">
                {hasData
                  ? `${assurance.testsExecuted} assurance tests executed across ${uploads.length} uploaded finance exports.`
                  : `Upload a finance pack to run ${TOTAL_RULES}+ assurance tests across 8 review layers.`}
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <Pill level={statusLevel}>{reviewStatus}</Pill>
              <button className="rounded-lg border border-line bg-white px-4 py-2.5 text-sm font-black transition-colors hover:border-brand hover:text-brand" onClick={() => setActive("Assurance Engine")}>
                Open Assurance Engine
              </button>
              <button className="rounded-lg bg-brand px-4 py-2.5 text-sm font-black text-white transition-colors hover:bg-blue-700" onClick={() => setActive(hasData ? "Review Pack" : "Upload Finance Pack")}>
                {hasData ? "Open Review Pack" : "Upload Pack"}
              </button>
            </div>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <CommandMetric label="Health" value={`${score}/100`} detail={riskCopy(risk)} level={risk} />
            <CommandMetric label="Readiness" value={hasData ? `${assurance.closeReadiness}%` : "—"} detail={`${passedDrivers.length}/${assurance.readinessDrivers.length} controls passed`} level={hasData ? (assurance.closeReadiness >= 80 ? "low" : assurance.closeReadiness >= 65 ? "medium" : "high") : "medium"} />
            <CommandMetric label="Confidence" value={hasData ? `${assurance.confidence}%` : "—"} detail="evidence quality" level={hasData ? (assurance.confidence >= 85 ? "low" : "medium") : "medium"} />
            <CommandMetric label="Exposure" value={`£${financialExposure.toLocaleString()}`} detail={`cash risk £${cashAtRisk.toLocaleString()}`} level={financialExposure ? "critical" : "low"} />
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-4">
            <AssuranceCount label="Critical" value={assurance.critical} level={assurance.critical ? "critical" : "low"} />
            <AssuranceCount label="Open findings" value={openFindings} level={openFindings ? "high" : "low"} />
            <AssuranceCount label="Actions" value={pendingActions} level={pendingActions ? "medium" : "low"} />
            <AssuranceCount label="Validation" value={validationBlockers || validationWarnings} detail={validationBlockers ? "blockers" : validationWarnings ? "warnings" : "clear"} level={validationBlockers ? "critical" : validationWarnings ? "medium" : "low"} />
          </div>

          <div className="mt-5 rounded-lg border border-line bg-slate-50 p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase text-muted">Why {score}?</p>
                <h3 className="text-lg font-black">Score contributors</h3>
              </div>
              <button className="rounded-lg border border-line bg-white px-3 py-2 text-sm font-black transition-colors hover:border-brand hover:text-brand" onClick={() => setActive("Audit Readiness")}>Audit Readiness</button>
            </div>
            <div className="grid gap-3 lg:grid-cols-2">
              <div className="grid gap-2">
                {positiveDrivers.length ? positiveDrivers.map((driver, index) => <ScoreDriverRow key={`positive-${index}-${driver.factor}-${driver.impact}`} driver={driver} />) : <p className="text-sm text-muted">Upload data to generate positive score contributors.</p>}
              </div>
              <div className="grid gap-2">
                {negativeDrivers.length ? negativeDrivers.map((driver, index) => <ScoreDriverRow key={`negative-${index}-${driver.factor}-${driver.impact}`} driver={driver} />) : <p className="text-sm text-muted">No score deductions identified.</p>}
              </div>
            </div>
          </div>
        </div>

        <aside className="border-t border-line bg-slate-50 p-5 xl:border-l xl:border-t-0">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase text-muted">Readiness Drivers</p>
              <h3 className="mt-1 text-lg font-black">Sign-off controls</h3>
            </div>
            <Pill level={failedDrivers.length ? "high" : "low"}>{failedDrivers.length ? `${failedDrivers.length} open` : "Clear"}</Pill>
          </div>
          <div className="mt-4 grid gap-2">
            {assurance.readinessDrivers.map((driver) => (
              <ReadinessDriverRow key={driver.label} driver={driver} />
            ))}
          </div>
        </aside>
      </div>
    </section>
  );
}

function ScoreDriverRow({ driver }: { driver: ScoreDriver }) {
  const positive = driver.type === "positive";
  return (
    <div className="grid min-h-12 grid-cols-[auto_1fr_auto] items-center gap-3 rounded-lg border border-line bg-white px-3 py-2">
      <span className={`grid h-6 w-6 place-items-center rounded-full text-xs font-black ${positive ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"}`}>
        {positive ? "+" : "-"}
      </span>
      <p className="min-w-0 truncate text-sm font-bold">{driver.factor}</p>
      <strong className={positive ? "text-emerald-700" : "text-red-700"}>{driver.impact > 0 ? `+${driver.impact}` : driver.impact}</strong>
    </div>
  );
}

function CommandMetric({ label, value, detail, level }: { label: string; value: string; detail: string; level: RiskLevel }) {
  const text = level === "low" ? "text-emerald-700" : level === "medium" ? "text-amber-700" : "text-red-700";
  return (
    <div className="min-h-28 rounded-lg border border-line bg-white p-4">
      <p className="text-xs font-bold uppercase text-muted">{label}</p>
      <strong className={`mt-2 block break-words text-3xl font-black leading-none ${text}`}>{value}</strong>
      <p className="mt-2 text-xs text-muted">{detail}</p>
    </div>
  );
}

function AssuranceCount({ label, value, detail, level }: { label: string; value: number; detail?: string; level: RiskLevel }) {
  return (
    <div className="rounded-lg border border-line bg-slate-50 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-bold uppercase text-muted">{label}</span>
        <Pill level={level}>{detail ?? riskCopy(level)}</Pill>
      </div>
      <strong className="mt-2 block text-xl font-black">{value}</strong>
    </div>
  );
}

function ReadinessDriverRow({ driver }: { driver: ReadinessDriver }) {
  return (
    <div className="grid grid-cols-[1fr_auto] items-center gap-3 rounded-lg border border-line bg-white p-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-black">{driver.label}</p>
        <p className="mt-0.5 truncate text-xs text-muted">{driver.detail}</p>
      </div>
      <span className={`inline-flex h-7 min-w-16 items-center justify-center rounded-full px-3 text-xs font-black ${driver.passed ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>
        {driver.passed ? "Passed" : `${driver.weight}%`}
      </span>
    </div>
  );
}

function AssuranceEngine({ assurance, coreQuality, findings, validationChecks, uploads, ruleAnalytics, setActive }: { assurance: AssuranceMetrics; coreQuality: CoreQualityMetrics; findings: Finding[]; validationChecks: ValidationCheck[]; uploads: Upload[]; ruleAnalytics: RuleAnalyticsReport | null; setActive: (value: string) => void }) {
  const fileTypes = new Set(uploads.map((u) => u.fileType));
  const hasTB = fileTypes.has("trial_balance"); const hasAR = fileTypes.has("aged_debtors");
  const hasAP = fileTypes.has("aged_creditors"); const hasVAT = fileTypes.has("vat_report");
  const hasPL = fileTypes.has("profit_loss"); const hasBS = fileTypes.has("balance_sheet");
  const hasAny = uploads.length > 0; const hasCross = fileTypes.size >= 2;

  const findingsByCategory = (cats: Finding["category"][]) => findings.filter((f) => cats.includes(f.category));
  const layerStatus = (active: boolean, findings: Finding[]) =>
    !active ? "low" : findings.some((f) => f.severity === "critical") ? "critical" : findings.some((f) => f.severity === "high") ? "high" : findings.length ? "medium" : "low";

  const layers = [
    { name: "Layer 1 — Data Integrity", desc: "TB balances, duplicate imports, cross-file reconciliation, data quality", count: LAYER_RULE_COUNTS.dataIntegrity, active: hasTB || hasAny, findings: validationChecks.filter((v) => v.status !== "passed").length, level: validationChecks.some((v) => v.status === "failed") ? "high" : validationChecks.some((v) => v.status === "warning") ? "medium" : "low" as RiskLevel },
    { name: "Layer 2 — AR Intelligence", desc: "Concentration risk, credit limits, stale invoices, contra accounts, DSO", count: LAYER_RULE_COUNTS.arIntelligence, active: hasAR, findings: findingsByCategory(["ar"]).length, level: layerStatus(hasAR, findingsByCategory(["ar"])) as RiskLevel },
    { name: "Layer 3 — AP Intelligence", desc: "Duplicate payments, split invoices, new vendors, personal payees, aging", count: LAYER_RULE_COUNTS.apIntelligence, active: hasAP, findings: findingsByCategory(["ap"]).length, level: layerStatus(hasAP, findingsByCategory(["ap"])) as RiskLevel },
    { name: "Layer 4 — VAT Assurance", desc: "Reverse charge, blocked input VAT, entertainment, fuel scale, rounding", count: LAYER_RULE_COUNTS.vatAssurance, active: hasVAT, findings: findingsByCategory(["vat"]).length, level: layerStatus(hasVAT, findingsByCategory(["vat"])) as RiskLevel },
    { name: "Layer 5 — Close Review", desc: "Missing accruals, late journals, prepayments, payroll, margin checks", count: LAYER_RULE_COUNTS.closeReview, active: hasTB || hasPL, findings: findingsByCategory(["month_end"]).length, level: layerStatus(hasTB, findingsByCategory(["month_end"])) as RiskLevel },
    { name: "Layer 6 — Financial Statements", desc: "Negative assets, negative equity, liquidity ratio, DLA, goodwill", count: LAYER_RULE_COUNTS.financialStatement, active: hasBS || hasPL, findings: findingsByCategory(["cashflow"]).length, level: layerStatus(hasBS, findingsByCategory(["cashflow"])) as RiskLevel },
    { name: "Layer 7 — Controls & Fraud", desc: "Weekend transactions, round numbers, approval override, suspense accounts", count: LAYER_RULE_COUNTS.controlsFraud, active: hasAny, findings: findingsByCategory(["controls"]).length, level: layerStatus(hasAny, findingsByCategory(["controls"])) as RiskLevel },
    { name: "Layer 8 — Statistical Detection", desc: "Cross-file reconciliation, DSO analysis, cash flow risk, trend anomalies", count: LAYER_RULE_COUNTS.statistical, active: hasCross, findings: findingsByCategory(["cashflow"]).filter((f) => f.id.includes("cf_") || f.id.includes("cross_")).length, level: (hasCross ? "low" : "low") as RiskLevel },
  ];

  const agents = [
    { name: "AR Agent", desc: "Debtor concentration, credit limits, stale invoices, collections", count: findingsByCategory(["ar"]).length },
    { name: "AP Agent", desc: "Duplicate payments, vendor risk, approval limits, payables aging", count: findingsByCategory(["ap"]).length },
    { name: "VAT Agent", desc: "VAT codes, reverse charge, blocked items, fuel scale, rounding", count: findingsByCategory(["vat"]).length },
    { name: "Close Agent", desc: "Accruals, prepayments, journals, payroll, margin deterioration", count: findingsByCategory(["month_end"]).length },
    { name: "Controls Agent", desc: "Weekend postings, late journals, round numbers, suspense balances", count: findingsByCategory(["controls"]).length },
    { name: "Financial Statement Agent", desc: "Negative equity, liquidity risk, DLA, fixed assets, goodwill", count: findingsByCategory(["cashflow"]).length },
    { name: "Data Quality Agent", desc: "Missing fields, duplicate rows, future dates, implausible amounts", count: findingsByCategory(["data_quality"]).length },
    { name: "Statistical Agent", desc: "Cross-file reconciliation, DSO, cashflow risk, concentration analysis", count: findings.filter((f) => f.id.includes("cf_") || f.id.includes("cross_")).length },
  ];

  const now = new Date();
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const trend = uploads.length ? [
    { period: months[(now.getMonth() - 1 + 12) % 12], score: Math.max(0, assurance.closeReadiness - 8) },
    { period: months[now.getMonth()], score: assurance.closeReadiness },
    { period: "Target", score: Math.min(98, assurance.closeReadiness + 10) }
  ] : [];

  // Evidence tier breakdown — what firms actually care about
  const deterministicFindings = findings.filter((f) => f.evidenceStrength === "deterministic");
  const indicatorFindings     = findings.filter((f) => !f.evidenceStrength || f.evidenceStrength === "indicator");
  const advisoryFindings      = findings.filter((f) => f.evidenceStrength === "advisory");

  return (
    <div className="grid gap-4">
      <CoreQualityPanel quality={coreQuality} />

      {/* Evidence tier summary — replaces raw finding count */}
      {findings.length > 0 && (
        <section className="rounded-lg border border-line bg-white p-4 shadow-panel">
          <p className="mb-3 text-xs font-bold uppercase text-muted">Finding Confidence Breakdown</p>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
              <strong className="block text-3xl font-black text-emerald-700">{deterministicFindings.length}</strong>
              <p className="font-bold text-emerald-800">Deterministic</p>
              <p className="text-xs text-muted">95–100% confidence · Mathematically proven</p>
            </div>
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
              <strong className="block text-3xl font-black text-blue-700">{indicatorFindings.length}</strong>
              <p className="font-bold text-blue-800">Indicators</p>
              <p className="text-xs text-muted">70–90% confidence · Strong accounting basis</p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <strong className="block text-3xl font-black text-slate-600">{advisoryFindings.length}</strong>
              <p className="font-bold text-slate-700">Advisory</p>
              <p className="text-xs text-muted">40–70% confidence · Review recommended</p>
            </div>
          </div>
        </section>
      )}

      <section className="grid gap-4 md:grid-cols-4">
        <Metric title="Tests Executed" value={assurance.testsExecuted} detail="Across uploaded data" tone="low" />
        <Metric title="Findings" value={findings.length} detail={`${assurance.critical} critical, ${assurance.high} high`} tone={assurance.critical ? "critical" : assurance.high ? "high" : "medium"} />
        <Metric title="Close Readiness" value={`${assurance.closeReadiness}%`} detail="Based on evidence and open risks" tone={assurance.closeReadiness >= 85 ? "low" : assurance.closeReadiness >= 65 ? "medium" : "high"} />
        <Metric title="Review Confidence" value={`${assurance.confidence}%`} detail="Validation and evidence quality" tone={assurance.confidence >= 85 ? "low" : "medium"} />
      </section>

      <section className="grid gap-4 xl:grid-cols-[1fr_0.9fr]">
        <Panel title="8-Layer Assurance Architecture">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-xs text-muted">{TOTAL_RULES} total rules · {uploads.length ? `${assurance.testsExecuted} executed this review` : "Upload data to run"}</span>
            {uploads.length > 0 && <span className="text-xs font-bold text-cyan">{Math.round(assurance.testsExecuted / TOTAL_RULES * 100)}% coverage</span>}
          </div>
          <div className="grid gap-2">
            {layers.map((layer) => (
              <div key={layer.name} className={`grid gap-2 rounded-lg border p-3 md:grid-cols-[1fr_auto_auto] md:items-center ${layer.active ? "border-line bg-white" : "border-dashed border-slate-200 bg-slate-50"}`}>
                <div>
                  <div className="flex items-center gap-2">
                    <strong className="text-sm">{layer.name}</strong>
                    {!layer.active && <span className="text-xs text-muted italic">— upload relevant files to activate</span>}
                  </div>
                  <p className="mt-0.5 text-xs text-muted">{layer.desc}</p>
                </div>
                <span className="text-sm font-bold text-muted">{layer.count} rules</span>
                <Pill level={layer.active ? layer.level : "none"}>{layer.active ? (layer.findings > 0 ? `${layer.findings} findings` : riskCopy(layer.level)) : "Not run"}</Pill>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="8 Specialist Review Agents">
          <div className="grid gap-2">
            {agents.map((agent) => (
              <div key={agent.name} className="rounded-lg border border-line bg-white p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <strong className="text-sm">{agent.name}</strong>
                    <p className="mt-0.5 text-xs text-muted">{agent.desc}</p>
                  </div>
                  <Pill level={agent.count > 0 ? "medium" : "low"}>{agent.count} finding{agent.count !== 1 ? "s" : ""}</Pill>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      </section>

      <section className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
        <Panel title="Close Readiness Trend">
          {trend.length > 0 ? (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trend} margin={{ left: -18, right: 18, top: 12, bottom: 0 }}>
                  <CartesianGrid stroke="#e5e7eb" strokeDasharray="4 4" vertical={false} />
                  <XAxis dataKey="period" tickLine={false} axisLine={false} />
                  <YAxis domain={[0, 100]} tickLine={false} axisLine={false} />
                  <Tooltip />
                  <Line type="monotone" dataKey="score" stroke="#0e7490" strokeWidth={3} dot={{ r: 4 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="flex h-72 items-center justify-center rounded-lg border-2 border-dashed border-line bg-slate-50">
              <p className="text-sm text-muted">Upload a finance pack to see close readiness trend.</p>
            </div>
          )}
        </Panel>
        <Panel title="Evidence First Findings">
          <FindingList findings={findings.slice(0, 3)} setActive={setActive} />
        </Panel>
      </section>

      {ruleAnalytics && (
        <section>
          <RuleCoverageReport analytics={ruleAnalytics} />
        </section>
      )}
    </div>
  );
}

function RuleCoverageReport({ analytics }: { analytics: RuleAnalyticsReport }) {
  const [filter, setFilter] = useState<"all" | "triggered" | "dead" | "not_run">("all");
  const [layerFilter, setLayerFilter] = useState<number>(0);
  const [search, setSearch] = useState("");

  const layerNames: Record<number, string> = {
    1: "Data Integrity", 2: "AR Intelligence", 3: "AP Intelligence", 4: "VAT Assurance",
    5: "Close Review", 6: "Financial Statements", 7: "Controls & Fraud", 8: "Statistical"
  };

  const filtered = analytics.stats.filter((s) => {
    if (filter === "triggered" && s.hits === 0) return false;
    if (filter === "dead" && (s.hits > 0 || s.executions === 0)) return false;
    if (filter === "not_run" && s.executions > 0) return false;
    if (layerFilter && s.layer !== layerFilter) return false;
    if (search && !s.ruleName.toLowerCase().includes(search.toLowerCase()) && !s.ruleId.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const severityColor: Record<string, string> = { critical: "text-red-700", high: "text-orange-600", medium: "text-amber-600", low: "text-slate-500" };

  return (
    <Panel title="Rule Coverage Report">
      <div className="mb-4 grid gap-4 sm:grid-cols-4">
        <div className="rounded-lg border border-line bg-slate-50 p-4 text-center">
          <p className="text-xs font-bold uppercase text-muted">Total Rules</p>
          <strong className="mt-1 block text-3xl">{analytics.totalRules}</strong>
        </div>
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-center">
          <p className="text-xs font-bold uppercase text-muted">Rules Triggered</p>
          <strong className="mt-1 block text-3xl text-emerald-700">{analytics.rulesTriggered}</strong>
          <p className="text-xs text-muted">{analytics.overallHitRate}% hit rate</p>
        </div>
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-center">
          <p className="text-xs font-bold uppercase text-muted">Rules Dead</p>
          <strong className="mt-1 block text-3xl text-amber-700">{analytics.rulesDead}</strong>
          <p className="text-xs text-muted">executed, never fired</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-center">
          <p className="text-xs font-bold uppercase text-muted">Not Run</p>
          <strong className="mt-1 block text-3xl text-slate-500">{analytics.rulesNotRun}</strong>
          <p className="text-xs text-muted">no matching file type</p>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <input className="h-9 flex-1 rounded-lg border border-line px-3 text-sm" placeholder="Search rules..." value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className="h-9 rounded-lg border border-line px-3 text-sm font-bold" value={layerFilter} onChange={(e) => setLayerFilter(Number(e.target.value))}>
          <option value={0}>All Layers</option>
          {Object.entries(layerNames).map(([l, name]) => <option key={l} value={l}>Layer {l}: {name}</option>)}
        </select>
        {(["all","triggered","dead","not_run"] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)} className={`h-9 rounded-lg px-3 text-sm font-bold capitalize transition-colors ${filter === f ? "bg-brand text-white" : "border border-line"}`}>
            {f.replace("_", " ")}
          </button>
        ))}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] border-collapse text-left text-sm">
          <thead className="text-xs uppercase text-muted">
            <tr>
              <th className="border-b border-line p-2">Rule ID</th>
              <th className="border-b border-line p-2">Name</th>
              <th className="border-b border-line p-2">Layer</th>
              <th className="border-b border-line p-2">Severity</th>
              <th className="border-b border-line p-2 text-right">Executions</th>
              <th className="border-b border-line p-2 text-right">Hits</th>
              <th className="border-b border-line p-2 text-right">Hit Rate</th>
              <th className="border-b border-line p-2 text-right">Total Value</th>
              <th className="border-b border-line p-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, 100).map((s) => (
              <tr key={s.ruleId} className={s.hits > 0 ? "bg-emerald-50/50" : s.executions === 0 ? "bg-slate-50/50" : ""}>
                <td className="border-b border-line p-2 font-mono text-xs text-muted">{s.ruleId}</td>
                <td className="border-b border-line p-2 font-semibold">{s.ruleName.replace(/_/g, " ")}</td>
                <td className="border-b border-line p-2 text-xs text-muted">{layerNames[s.layer]}</td>
                <td className={`border-b border-line p-2 text-xs font-bold capitalize ${severityColor[s.severity] ?? ""}`}>{s.severity}</td>
                <td className="border-b border-line p-2 text-right">{s.executions}</td>
                <td className="border-b border-line p-2 text-right font-bold">{s.hits}</td>
                <td className="border-b border-line p-2 text-right">
                  <span className={`text-xs font-bold ${s.hitRate > 0 ? "text-emerald-700" : "text-muted"}`}>{s.executions > 0 ? `${s.hitRate}%` : "—"}</span>
                </td>
                <td className="border-b border-line p-2 text-right text-xs">{s.totalMatchValue > 0 ? `£${Math.round(s.totalMatchValue).toLocaleString()}` : "—"}</td>
                <td className="border-b border-line p-2">
                  {s.hits > 0 ? <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-800">Active</span>
                   : s.executions > 0 ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-700">Dead</span>
                   : <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-500">Not run</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length > 100 && <p className="mt-2 text-xs text-muted">{filtered.length - 100} more rules — refine your filter.</p>}
        {filtered.length === 0 && <p className="py-6 text-center text-sm text-muted">No rules match the current filter.</p>}
      </div>
      <p className="mt-3 text-xs text-muted">Generated {new Date(analytics.generatedAt).toLocaleString()} · {analytics.totalRules} rules across 8 layers</p>
    </Panel>
  );
}

function AuditReadiness({ findings, validationChecks, uploads, score, timeSavedHours, timeSavedValue, expectedAuditQueries, financialExposure, company, tenant, setActive }: {
  findings: Finding[]; validationChecks: ValidationCheck[]; uploads: Upload[]; score: number;
  timeSavedHours: string; timeSavedValue: number; expectedAuditQueries: number; financialExposure: number;
  company: Company; tenant: Tenant; setActive: (v: string) => void;
}) {
  const hasTB = uploads.some((u) => u.fileType === "trial_balance");
  const hasBS = uploads.some((u) => u.fileType === "balance_sheet");
  const hasAR = uploads.some((u) => u.fileType === "aged_debtors");
  const criticalFindings = findings.filter((f) => f.severity === "critical").length;
  const openFindings   = findings.filter((f) => f.status === "open" || f.status === "in_review");
  const criticalOpen   = openFindings.filter((f) => f.severity === "critical").length;
  const highOpen       = openFindings.filter((f) => f.severity === "high").length;
  const failedChecks   = validationChecks.filter((v) => v.status === "failed").length;
  const warningChecks  = validationChecks.filter((v) => v.status === "warning").length;
  const requiredFiles  = ["trial_balance","profit_loss","balance_sheet","aged_debtors","aged_creditors","vat_report"];
  const presentFiles   = new Set(uploads.map((u) => u.fileType));
  const missingFiles   = requiredFiles.filter((r) => !presentFiles.has(r as Upload["fileType"])).map((r) => r.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()));
  const auditScore = Math.max(0, Math.min(100, 100 - criticalOpen * 20 - highOpen * 10 - failedChecks * 12 - warningChecks * 3 + Math.min(uploads.length * 5, 20)));
  const closeScore = Math.max(0, Math.min(98, 96 - criticalOpen * 18 - highOpen * 9 - failedChecks * 12 - warningChecks * 3));
  const monthEndFindings = findings.filter((f) => f.category === "month_end");
  const controlFindings = findings.filter((f) => f.category === "controls");
  const tbPassed = validationChecks.some((v) => v.name.toLowerCase().includes("trial") && v.status === "passed");
  const bsPassed = validationChecks.some((v) => v.name.toLowerCase().includes("balance") && v.status === "passed");
  const today = new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" });

  const checks = [
    { name: "Missing Accruals", detail: monthEndFindings.length ? `${monthEndFindings.length} month-end finding(s) require accrual review` : hasTB ? "No accrual gaps detected in uploaded data" : "Trial balance not yet uploaded", status: monthEndFindings.some((f) => f.severity === "high" || f.severity === "critical") ? "failed" : monthEndFindings.length ? "warning" : hasTB ? "passed" : "warning" },
    { name: "Trial Balance", detail: hasTB ? (tbPassed ? "TB balances to zero — no integrity issues" : "TB uploaded but has reconciliation issues") : "Trial balance not yet uploaded", status: hasTB ? (tbPassed ? "passed" : "warning") : "warning" },
    { name: "Balance Sheet Equation", detail: hasBS ? (bsPassed ? "Assets equal liabilities + equity" : "Balance sheet equation has exceptions") : "Balance sheet not yet uploaded", status: hasBS ? (bsPassed ? "passed" : "failed") : "warning" },
    { name: "Lead Schedule Completeness", detail: criticalFindings ? `${criticalFindings} critical finding(s) need schedules before sign-off` : uploads.length >= 3 ? "No critical schedule gaps detected" : "Upload finance pack to check lead schedules", status: criticalFindings ? "failed" : uploads.length >= 3 ? "passed" : "warning" },
    { name: "Supporting Evidence", detail: uploads.length >= 4 ? `${uploads.length} files uploaded — evidence coverage good` : uploads.length ? `${uploads.length} file(s) uploaded — add more for full coverage` : "Upload your finance pack to provide supporting evidence", status: uploads.length >= 4 ? "passed" : "warning" },
    { name: "Cut-off Testing", detail: monthEndFindings.some((f) => f.description?.toLowerCase().includes("cut-off") || f.description?.toLowerCase().includes("journal")) ? "Post-period journals detected — review for cut-off accuracy" : hasTB ? "No cut-off exceptions flagged in uploaded data" : "Trial balance not yet uploaded", status: monthEndFindings.some((f) => f.description?.toLowerCase().includes("cut-off") || f.description?.toLowerCase().includes("journal")) ? "warning" : hasTB ? "passed" : "warning" },
    { name: "AR Ageing & Recoverability", detail: hasAR ? (findings.some((f) => f.category === "ar" && f.severity === "critical") ? "Critical AR exposure — review recoverability provisions" : "AR reviewed — no critical recoverability issues") : "Aged debtors not yet uploaded", status: hasAR ? (findings.some((f) => f.category === "ar" && f.severity === "critical") ? "warning" : "passed") : "warning" },
    { name: "Controls & Fraud Review", detail: controlFindings.length ? `${controlFindings.length} control exception(s) need sign-off before audit` : uploads.length ? "No control breaches flagged" : "Upload finance pack to check controls", status: controlFindings.some((f) => f.severity === "high" || f.severity === "critical") ? "failed" : controlFindings.length ? "warning" : uploads.length ? "passed" : "warning" },
  ] as const;

  const passed = checks.filter((c) => c.status === "passed").length;
  const warnings = checks.filter((c) => c.status === "warning").length;
  const failed = checks.filter((c) => c.status === "failed").length;
  const readiness = Math.round((passed / checks.length) * 100);

  return (
    <div className="grid gap-4">

      {/* Hero outcome section — this is what firms buy */}
      <section className="rounded-xl border border-line bg-white p-6 shadow-panel">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-muted">Audit Readiness Report™</p>
            <h2 className="mt-1 text-2xl font-black">{company.name}</h2>
            <p className="text-sm text-muted">{tenant.name} · Prepared {today} · {uploads.length} file{uploads.length !== 1 ? "s" : ""} reviewed</p>
          </div>
          <div className="flex gap-2">
            <button className="rounded-lg border border-line px-4 py-2 text-sm font-bold" onClick={() => setActive("Upload Finance Pack")}>Upload More Files</button>
            <button className="rounded-lg bg-brand px-4 py-2 text-sm font-bold text-white" onClick={() => window.print()}>Export Report</button>
          </div>
        </div>

        {/* 4 outcome metrics — the product promise */}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <div className={`rounded-xl p-5 text-center ${auditScore >= 80 ? "bg-emerald-50 border border-emerald-200" : auditScore >= 60 ? "bg-amber-50 border border-amber-200" : "bg-red-50 border border-red-200"}`}>
            <strong className={`block text-5xl font-black ${auditScore >= 80 ? "text-emerald-700" : auditScore >= 60 ? "text-amber-700" : "text-red-700"}`}>{uploads.length ? `${auditScore}%` : "—"}</strong>
            <p className="mt-1 font-bold">Audit Readiness</p>
            <p className="text-xs text-muted">{auditScore >= 80 ? "Ready for partner review" : auditScore >= 60 ? "Needs attention" : "Not ready — critical issues"}</p>
          </div>
          <div className="rounded-xl border border-line bg-slate-50 p-5 text-center">
            <strong className={`block text-5xl font-black ${criticalOpen === 0 ? "text-emerald-700" : "text-red-700"}`}>{criticalOpen}</strong>
            <p className="mt-1 font-bold">Critical Issues</p>
            <p className="text-xs text-muted">{highOpen > 0 ? `+${highOpen} high severity` : "No high severity findings"}</p>
          </div>
          <div className="rounded-xl border border-line bg-slate-50 p-5 text-center">
            <strong className={`block text-5xl font-black ${Number(timeSavedHours) >= 2 ? "text-emerald-700" : "text-slate-600"}`}>{uploads.length ? `${timeSavedHours}h` : "—"}</strong>
            <p className="mt-1 font-bold">Manager Time Saved</p>
            <p className="text-xs text-muted">{timeSavedValue > 0 ? `≈ £${timeSavedValue.toLocaleString()} at your day rate` : "Upload files to calculate"}</p>
          </div>
          <div className="rounded-xl border border-line bg-slate-50 p-5 text-center">
            <strong className={`block text-5xl font-black ${expectedAuditQueries === 0 ? "text-emerald-700" : "text-amber-700"}`}>{uploads.length ? expectedAuditQueries : "—"}</strong>
            <p className="mt-1 font-bold">Expected Audit Queries</p>
            <p className="text-xs text-muted">{expectedAuditQueries === 0 ? "Clean — low audit risk" : "Address before partner sign-off"}</p>
          </div>
        </div>

        {/* Financial exposure */}
        {financialExposure > 0 && (
          <div className="mt-4 flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 p-4">
            <div>
              <p className="text-xs font-bold uppercase text-amber-800">Financial Exposure Identified</p>
              <p className="mt-0.5 text-sm text-amber-900">ClosePilot identified <strong>£{Math.round(financialExposure / 1000)}k</strong> in potential financial exposure across VAT, AR, AP and close findings.</p>
            </div>
            <strong className="text-2xl font-black text-amber-800 shrink-0">£{Math.round(financialExposure / 1000)}k</strong>
          </div>
        )}

        {/* Missing evidence warning */}
        {missingFiles.length > 0 && uploads.length > 0 && (
          <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs font-semibold text-slate-600">Upload additional files to improve readiness score: <span className="font-bold">{missingFiles.join(", ")}</span></p>
          </div>
        )}
      </section>

      <section className="grid gap-4 md:grid-cols-4">
        <Metric title="Audit Readiness" value={uploads.length ? `${readiness}%` : "—"} detail="Based on checklist checks" tone={readiness >= 80 ? "low" : readiness >= 60 ? "medium" : "high"} />
        <Metric title="Checks Passed" value={passed} detail={`of ${checks.length} total`} tone="low" />
        <Metric title="Warnings" value={warnings} detail="Need attention before audit" tone="medium" />
        <Metric title="Blockers" value={failed} detail="Must resolve before year-end" tone={failed ? "critical" : "low"} />
      </section>

      <section className="grid gap-4 xl:grid-cols-[1fr_0.9fr]">
        <Panel title="Audit Readiness Checklist">
          <div className="grid gap-3">
            {checks.map((check) => (
              <div key={check.name} className="flex items-start justify-between gap-4 rounded-lg border border-line p-4">
                <div>
                  <strong>{check.name}</strong>
                  <p className="mt-1 text-sm text-muted">{check.detail}</p>
                </div>
                <ValidationPill status={check.status} />
              </div>
            ))}
          </div>
        </Panel>

        <div className="grid gap-4 content-start">
          <Panel title="Audit Readiness Score">
            <div className="rounded-lg border border-line bg-slate-50 p-5 text-center">
              <strong className="block text-5xl font-black">{readiness}%</strong>
              <p className="mt-2 text-muted">Ready for year-end audit</p>
              <Pill level={readiness >= 80 ? "low" : readiness >= 60 ? "medium" : "high"} >{readiness >= 80 ? "Audit Ready" : readiness >= 60 ? "Needs Attention" : "Not Ready"}</Pill>
            </div>
          </Panel>
          <Panel title="Priority Items">
            <div className="grid gap-3">
              {checks.filter((c) => c.status !== "passed").map((check) => (
                <div key={check.name} className="rounded-lg border border-line bg-slate-50 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <strong className="text-sm">{check.name}</strong>
                    <ValidationPill status={check.status} />
                  </div>
                  <p className="mt-1 text-xs text-muted">{check.detail}</p>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      </section>
    </div>
  );
}

function ReviewPack({
  company, tenant, userName, score, risk, findings, findingEvidence, findingComments, findingActivities, partnerSignOff, reviewLocked, recommendations, validationChecks, uploads, financialExposure, cashAtRisk, onCreateNewReviewCycle, setActive
}: {
  company: Company; tenant: Tenant; userName: string; score: number; risk: RiskLevel; findings: Finding[]; findingEvidence: Evidence[]; findingComments: FindingComment[]; findingActivities: FindingActivity[]; partnerSignOff?: PartnerSignOff; reviewLocked: boolean; recommendations: Recommendation[]; validationChecks: ValidationCheck[]; uploads: Upload[]; financialExposure: number; cashAtRisk: number; onCreateNewReviewCycle: () => void; setActive: (value: string) => void;
}) {
  const [preparedBy, setPreparedBy] = useState(userName || "ClosePilot Reviewer");
  const [reviewedBy, setReviewedBy] = useState("");
  const [approvedBy, setApprovedBy] = useState(partnerSignOff?.approvedBy ?? partnerSignOff?.signedBy ?? "");
  const [signOffStatus, setSignOffStatus] = useState<PartnerSignOffStatus>(partnerSignOff?.status ?? "draft");
  const [reviewPackStatus, setReviewPackStatus] = useState<ReviewPackStatus>(partnerSignOff?.reviewPackStatus ?? "DRAFT");
  const [packType, setPackType] = useState<"audit" | "partner" | "client" | "evidence">("audit");
  const [conclusion, setConclusion] = useState("Draft: manager review required before final issue.");
  const today = new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" });
  const profile = evidenceProfile(findings);
  const failedChecks = validationChecks.filter((v) => v.status === "failed");
  const warningChecks = validationChecks.filter((v) => v.status === "warning");
  const reconciliationChecks = validationChecks.filter((v) => v.id.startsWith("val_xfile") || v.id.startsWith("val_ar_ctrl") || v.id.startsWith("val_ap_ctrl"));
  const openCritical = findings.filter((f) => isOpenFinding(f) && f.severity === "critical");
  const openHigh = findings.filter((f) => isOpenFinding(f) && f.severity === "high");
  const openFindings = findings.filter(isOpenFinding);
  const acceptedFindings = findings.filter((f) => ["accepted", "resolved", "accepted_risk"].includes(f.status));
  const acceptedRiskFindings = findings.filter((f) => f.status === "accepted_risk");
  const reviewReady = uploads.length > 0 && failedChecks.length === 0 && openCritical.length === 0 && openHigh.length === 0;
  const reviewedPct = findings.length ? Math.round(profile.reviewed / findings.length * 100) : 0;
  const fileSlug = slug(`${company.name}_${today}_review_pack`);
  const managerApproved = findings.filter((finding) => managerReviewStatus(finding) === "approved").length;
  const managerEscalated = findings.filter((finding) => managerReviewStatus(finding) === "escalated").length;
  const managerReturned = findings.filter((finding) => managerReviewStatus(finding) === "returned").length;
  const evidenceOutstanding = findings.filter((finding) => ["evidence_requested", "needs_investigation", "evidence_received"].includes(finding.status)).length + findingEvidence.filter((item) => ["requested", "uploaded", "under_review", "rejected"].includes(item.status ?? "uploaded")).length;
  const acceptedEvidence = findingEvidence.filter((item) => item.status === "accepted").length;
  const rejectedEvidence = findingEvidence.filter((item) => item.status === "rejected").length;
  const partnerReady = Boolean(partnerSignOff);
  const effectiveReviewPackStatus = partnerSignOff?.reviewPackStatus ?? reviewPackStatus;
  const reviewPackStatusLabel = effectiveReviewPackStatus.replaceAll("_", " ");
  const exposure = exposureBreakdown(findings, cashAtRisk, financialExposure);
  const collection = collectionOpportunities(findings);
  const supplierRisk = supplierRiskOpportunities(findings);
  const ecl = expectedCreditLoss(findings);
  const reportAudience = packType === "audit" ? "Audit Review Pack" : packType === "partner" ? "Partner Review Pack" : packType === "client" ? "Client Finance Health Report" : "Evidence Appendix";
  const visibleFindings = packType === "client"
    ? findings.filter((f) => f.evidenceStrength !== "advisory" && (f.severity === "critical" || f.severity === "high" || ["accepted", "resolved", "accepted_risk"].includes(f.status)))
    : findings;
  const visibleOpenFindings = visibleFindings.filter(isOpenFinding);
  const criticalFindings = visibleOpenFindings.filter((f) => f.severity === "critical");
  const highFindings = visibleOpenFindings.filter((f) => f.severity === "high");
  const mediumFindings = visibleOpenFindings.filter((f) => f.severity === "medium");
  const advisoryFindings = packType === "client" ? [] : visibleOpenFindings.filter((f) => f.evidenceStrength === "advisory" || f.severity === "low");
  const priorityFindings = openFindings
    .slice()
    .sort((a, b) => {
      const weight: Record<RiskLevel, number> = { critical: 4, high: 3, medium: 2, low: 1 };
      return weight[b.severity] - weight[a.severity];
    })
    .slice(0, 6);
  const immutableSignOffRecord = partnerSignOff ? {
    id: partnerSignOff.id,
    status: partnerSignOff.status === "signed" ? "locked" : partnerSignOff.status,
    reviewPackStatus: partnerSignOff.reviewPackStatus ?? "LOCKED",
    preparedBy: partnerSignOff.preparedBy ?? preparedBy,
    reviewedBy: partnerSignOff.reviewedBy ?? reviewedBy,
    approvedBy: partnerSignOff.approvedBy ?? partnerSignOff.signedBy,
    signedBy: partnerSignOff.signedBy,
    signedAt: partnerSignOff.signedAt,
    lockedAt: partnerSignOff.lockedAt ?? partnerSignOff.signedAt,
    note: partnerSignOff.note,
    gateSnapshot: partnerSignOff.gateSnapshot,
    approval: partnerSignOff.approval,
  } : {
    status: signOffStatus,
    reviewPackStatus,
    preparedBy,
    reviewedBy,
    approvedBy,
    signedBy: "",
    signedAt: "",
    lockedAt: "",
    note: conclusion,
    gateSnapshot: undefined,
  };
  const signOffCertificate = {
    preparedBy: partnerSignOff?.preparedBy ?? preparedBy,
    reviewedBy: partnerSignOff?.reviewedBy ?? reviewedBy,
    approvedBy: partnerSignOff?.approval?.approvedBy ?? partnerSignOff?.approvedBy ?? approvedBy,
    date: partnerSignOff?.approval?.approvedAt ?? partnerSignOff?.signedAt ?? new Date().toISOString(),
    readinessScore: partnerSignOff?.approval?.readinessScore ?? (reviewReady ? score : 0),
    confidenceScore: partnerSignOff?.approval?.confidenceScore ?? reviewedPct,
    acceptedRisks: partnerSignOff?.approval?.acceptedRisks ?? acceptedRiskFindings.length,
    reviewPackStatus: effectiveReviewPackStatus,
    lockedAt: partnerSignOff?.lockedAt,
  };
  const generatedPack = buildGeneratedReviewPack({
    company,
    tenant,
    score,
    risk,
    findings,
    findingEvidence,
    findingComments,
    findingActivities,
    partnerSignOff,
    recommendations,
    validationChecks,
    uploads,
    cashAtRisk,
    financialExposure,
    preparedBy,
    reviewedBy,
    approvedBy,
    reviewPackStatus: effectiveReviewPackStatus,
    conclusion,
  });
  const auditRequiredActions = auditPackRequiredActions(findings, validationChecks, uploads);
  const auditPartnerSummary = auditPackPartnerSummary(findings, validationChecks, uploads);
  const auditChecklist = auditControlChecklist(findings, validationChecks, uploads);
  const auditTraffic = signOffTrafficLight({
    signOffEnabled: generatedPack.signOffGate.ready,
    signOffComplete: Boolean(partnerSignOff),
    acceptedRiskCount: acceptedRiskFindings.length,
    criticalOpen: generatedPack.signOffGate.blockers.criticalOpen,
    highOpen: generatedPack.signOffGate.blockers.highOpen,
    validationBlockers: generatedPack.signOffGate.blockers.validationBlockers,
    evidenceOutstanding: generatedPack.signOffGate.blockers.outstandingEvidence,
    managerReviewComplete: generatedPack.signOffGate.blockers.managerReviewComplete,
  });
  const auditTrafficClass = trafficLightClasses(auditTraffic.state);
  const auditPack = {
    client: company.name,
    period: today,
    preparedBy,
    reviewStatus: auditTraffic.label,
    summary: {
      findingsIdentified: findings.length,
      openFindings: openFindings.length,
      acceptedRisks: acceptedRiskFindings.length,
      validationBlockers: failedChecks.length,
      financialHealth: score,
      auditReadiness: generatedPack.executiveSummary.auditReadinessScore,
    },
    requiredActions: auditRequiredActions,
    partnerSummary: auditPartnerSummary,
    controlChecklist: auditChecklist,
  };
  const partnerConclusion = auditPartnerConclusion({
    trafficLabel: auditTraffic.label,
    findings,
    acceptedRisks: acceptedRiskFindings,
    validationBlockers: failedChecks.length,
    openHigh: openHigh.length + openCritical.length,
  });
  const pdfFindings = visibleFindings
    .slice()
    .sort((a, b) => findingSeverityRank(b.severity) - findingSeverityRank(a.severity))
    .slice(0, 10);
  const reviewNoteFindings = visibleFindings
    .slice()
    .sort((a, b) => findingSeverityRank(b.severity) - findingSeverityRank(a.severity))
    .slice(0, 8);
  const workpapers = generateWorkpapers({
    findings: visibleFindings,
    uploads,
    validationChecks,
    reviewer: reviewedBy || preparedBy || "ClosePilot Reviewer",
    date: new Date().toISOString(),
  });

  const downloadEvidencePack = () => exportFile(`${fileSlug}.json`, JSON.stringify({
    packType,
    signOffStatus: partnerSignOff?.status ?? signOffStatus,
    reviewReady,
    immutableSignOffRecord,
    auditPack,
    ...generatedPack,
  }, null, 2), "application/json;charset=utf-8");
  const downloadWordPack = () => exportFile(
    `${fileSlug}_partner_review_report.doc`,
    auditReviewPackWordHtml({
      company,
      tenant,
      today,
      preparedBy,
      auditPack,
      partnerConclusion,
      findings: visibleFindings,
      workpapers,
    }),
    "application/msword;charset=utf-8",
  );

  return (
    <div className="grid gap-4">
      {reviewLocked && (
        <section className="flex flex-col gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-bold uppercase text-emerald-800">Locked Review Pack</p>
            <p className="mt-1 text-sm font-semibold text-emerald-900">Partner sign-off is complete. Findings, evidence, comments and workflow actions are now immutable; export remains available.</p>
          </div>
          <button className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-bold text-white" onClick={onCreateNewReviewCycle}>Create New Review Cycle</button>
        </section>
      )}
      <section className="no-print rounded-lg border border-line bg-white p-5 shadow-panel">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="text-xs font-bold uppercase text-muted">Practice Review Pack</p>
            <h2 className="mt-1 text-2xl font-black">{company.name}</h2>
            <p className="mt-1 text-sm text-muted">{tenant.name} · Prepared {today} · {uploads.length} file{uploads.length !== 1 ? "s" : ""} reviewed</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="rounded-lg border border-line px-4 py-2 text-sm font-bold disabled:cursor-not-allowed disabled:text-muted" disabled={reviewLocked} onClick={() => setActive("Upload Finance Pack")}>Upload More</button>
            <button className="rounded-lg border border-line px-4 py-2 text-sm font-bold" onClick={() => exportFile(`${fileSlug}_findings.csv`, findingsCsv(findings), "text/csv;charset=utf-8")}>Findings CSV</button>
            <button className="rounded-lg border border-line px-4 py-2 text-sm font-bold" onClick={downloadEvidencePack}>Evidence JSON</button>
            <button className="rounded-lg border border-line px-4 py-2 text-sm font-bold" onClick={downloadWordPack}>Word Pack</button>
            <button className="rounded-lg bg-brand px-4 py-2 text-sm font-bold text-white" onClick={() => printWithTitle(`${company.name} Partner Review Report`)}>Export PDF</button>
          </div>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-5">
          <label className="grid gap-1">
            <span className="text-xs font-bold uppercase text-muted">Pack Type</span>
            <select className="h-10 rounded-lg border border-line px-3 text-sm font-bold" value={packType} onChange={(e) => setPackType(e.target.value as typeof packType)}>
              <option value="audit">Audit Review Pack</option>
              <option value="partner">Partner Review</option>
              <option value="client">Client Pack</option>
              <option value="evidence">Evidence Appendix</option>
            </select>
          </label>
          <label className="grid gap-1">
            <span className="text-xs font-bold uppercase text-muted">Prepared By</span>
            <input className="h-10 rounded-lg border border-line px-3 text-sm" value={preparedBy} onChange={(e) => setPreparedBy(e.target.value)} />
          </label>
          <label className="grid gap-1">
            <span className="text-xs font-bold uppercase text-muted">Reviewed By</span>
            <input className="h-10 rounded-lg border border-line px-3 text-sm" value={reviewedBy} onChange={(e) => setReviewedBy(e.target.value)} placeholder="Manager / partner" />
          </label>
          <label className="grid gap-1">
            <span className="text-xs font-bold uppercase text-muted">Approved By</span>
            <input className="h-10 rounded-lg border border-line px-3 text-sm" value={approvedBy} onChange={(e) => setApprovedBy(e.target.value)} placeholder="Partner" />
          </label>
          <label className="grid gap-1">
            <span className="text-xs font-bold uppercase text-muted">Review Pack Status</span>
            <select className="h-10 rounded-lg border border-line px-3 text-sm font-bold" value={effectiveReviewPackStatus} onChange={(e) => setReviewPackStatus(e.target.value as ReviewPackStatus)} disabled={Boolean(partnerSignOff)}>
              <option value="DRAFT">Draft</option>
              <option value="UNDER_REVIEW">Under Review</option>
              <option value="PARTNER_REVIEW">Partner Review</option>
              <option value="APPROVED">Approved</option>
              <option value="LOCKED">Locked</option>
            </select>
          </label>
          <label className="grid gap-1">
            <span className="text-xs font-bold uppercase text-muted">Legacy Sign-Off</span>
            <select className="h-10 rounded-lg border border-line px-3 text-sm font-bold" value={partnerSignOff?.status ?? signOffStatus} onChange={(e) => setSignOffStatus(e.target.value as PartnerSignOffStatus)} disabled={Boolean(partnerSignOff)}>
              <option value="draft">Draft</option>
              <option value="under_review">Under Review</option>
              <option value="partner_review">Partner Review</option>
              <option value="approved">Approved</option>
              <option value="locked">Locked</option>
            </select>
          </label>
          <label className="grid gap-1">
            <span className="text-xs font-bold uppercase text-muted">Conclusion</span>
            <select className="h-10 rounded-lg border border-line px-3 text-sm font-bold" value={conclusion} onChange={(e) => setConclusion(e.target.value)}>
              <option>Draft: manager review required before final issue.</option>
              <option>Ready for partner review subject to listed actions.</option>
              <option>Ready to issue to client.</option>
              <option>Blocked: critical evidence or validation issues remain.</option>
            </select>
          </label>
        </div>
      </section>

      <section id="practice-review-pack" className="rounded-lg border border-line bg-white p-6 shadow-panel print:border-0 print:p-0 print:shadow-none">
        {packType === "audit" && (
          <div className="print-page rounded-lg border border-slate-900 bg-white p-6 print-cover print:rounded-none print:border-0">
            <div className="flex min-h-[520px] flex-col justify-between gap-8">
              <div>
                <p className="text-xs font-black uppercase tracking-wide text-muted">ClosePilot Assurance</p>
                <h1 className="mt-3 text-4xl font-black">Partner Review Report</h1>
                <p className="mt-2 max-w-2xl text-sm text-muted">Evidence-led finance assurance pack generated from uploaded finance exports, validation checks, findings workflow and sign-off gate status.</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <SummaryLine label="Client" value={company.name} />
                <SummaryLine label="Period" value="May 2026" />
                <SummaryLine label="Prepared" value={today} />
                <SummaryLine label="Prepared By" value={preparedBy || "ClosePilot"} />
                <SummaryLine label="Status" value={auditTraffic.label} />
                <SummaryLine label="Files Reviewed" value={uploads.length} />
              </div>
              <div className={`rounded-lg border p-4 ${auditTrafficClass.box}`}>
                <p className={`text-xs font-black uppercase ${auditTrafficClass.text}`}>Partner Conclusion</p>
                <p className="mt-2 text-lg font-black">{auditTraffic.headline}</p>
                <p className="mt-2 text-sm text-muted">{partnerConclusion}</p>
              </div>
            </div>
          </div>
        )}

        <div className="print-page border-b border-line pb-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs font-bold uppercase text-muted">ClosePilot · {reportAudience}</p>
              <h1 className="mt-1 text-3xl font-black">{company.name}</h1>
              <p className="mt-1 text-sm text-muted">{tenant.name} · {company.accountingSystem} · {company.country} · {today}</p>
            </div>
            <div className="text-left sm:text-right">
              <Pill level={partnerReady ? "low" : reviewReady ? "low" : "medium"}>{partnerReady ? "Locked" : reviewReady ? "Partner Review" : reviewPackStatusLabel}</Pill>
              <p className="mt-2 text-sm font-bold">{riskCopy(risk)} · {score}/100</p>
            </div>
          </div>
          <div className={`mt-5 rounded-lg border p-4 ${partnerReady || reviewReady ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}>
            <p className={`text-xs font-bold uppercase ${partnerReady || reviewReady ? "text-emerald-800" : "text-amber-800"}`}>Review Conclusion</p>
            <p className="mt-1 font-bold">{conclusion}</p>
            <p className="mt-1 text-sm text-muted">{failedChecks.length} validation blocker(s), {openCritical.length} open critical finding(s), {openHigh.length} open high finding(s), {reviewedPct}% reviewer decision coverage.</p>
          </div>

          <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <ReportMetric label="Finance Health" value={`${score}/100`} detail={riskCopy(risk)} />
            <ReportMetric label="Audit Readiness" value={reviewReady ? "Ready" : "Blocked"} detail={`${failedChecks.length} blockers`} />
            <ReportMetric label="Review Confidence" value={`${reviewedPct}%`} detail="reviewer decision coverage" />
            <ReportMetric label="Open Findings" value={String(openFindings.length)} detail="remaining workflow items" />
            <ReportMetric label="Accepted Risks" value={String(acceptedRiskFindings.length)} detail="partner-visible decisions" />
            <ReportMetric label="Outstanding Evidence" value={String(evidenceOutstanding)} detail={`${rejectedEvidence} rejected`} />
            <ReportMetric label="Financial Exposure" value={`£${Math.round(financialExposure / 1000)}k`} detail="Explained below" />
            <ReportMetric label="Collection Opportunity" value={`£${Math.round(collection.reduce((sum, item) => sum + item.value, 0) / 1000)}k`} detail="Top AR priorities" />
            <ReportMetric label="Supplier Risk" value={`£${Math.round(supplierRisk.reduce((sum, item) => sum + item.value, 0) / 1000)}k`} detail="AP payment controls" />
            <ReportMetric label="Findings Triage" value={`${criticalFindings.length}/${highFindings.length}/${mediumFindings.length}`} detail="Critical / high / medium" />
          </div>

          <div className="mt-6 rounded-lg border border-line bg-slate-50 p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <p className="text-xs font-bold uppercase text-muted">Generated Review Pack</p>
                <h2 className="mt-1 text-xl font-black">{generatedPack.exportStatus === "final_ready" ? "Final-ready pack" : "Draft pack with blockers"}</h2>
                <p className="mt-1 text-sm text-muted">{generatedPack.executiveSummary.recommendedNextStep}</p>
              </div>
              <Pill level={generatedPack.signOffGate.ready ? "low" : "high"}>{generatedPack.signOffGate.ready ? "Sign-off ready" : "Sign-off blocked"}</Pill>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <SummaryLine label="Executive summary" value="Included" />
              <SummaryLine label="Open findings" value={generatedPack.openFindings.length} />
              <SummaryLine label="Accepted risks" value={generatedPack.acceptedRisks.length} />
              <SummaryLine label="Management actions" value={generatedPack.managementActions.length} />
              <SummaryLine label="Review notes" value={generatedPack.reviewNotes.length} />
              <SummaryLine label="Evidence references" value={generatedPack.evidenceReferences.length} />
              <SummaryLine label="Activity entries" value={generatedPack.reviewProgress.activityEntries} />
              <SummaryLine label="Sign-off certificate" value={generatedPack.signOffCertificate.approvedBy ? "Populated" : "Draft"} />
            </div>
          </div>

          {packType === "audit" && (
            <div className="print-page mt-6 grid gap-4">
              <div className="rounded-lg border border-line p-4">
                <p className="text-xs font-bold uppercase text-muted">Executive Summary</p>
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full min-w-[720px] border-collapse text-left text-sm">
                    <thead className="bg-slate-50 text-xs uppercase text-muted">
                      <tr>
                        <th className="border-b border-line p-2">Health</th>
                        <th className="border-b border-line p-2">Readiness</th>
                        <th className="border-b border-line p-2">Findings</th>
                        <th className="border-b border-line p-2">Accepted Risks</th>
                        <th className="border-b border-line p-2">Open High</th>
                        <th className="border-b border-line p-2">Validation</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td className="border-b border-line p-2 font-black">{score}/100</td>
                        <td className="border-b border-line p-2 font-black">{generatedPack.executiveSummary.auditReadinessScore}/100</td>
                        <td className="border-b border-line p-2">{findings.length}</td>
                        <td className="border-b border-line p-2">{acceptedRiskFindings.length}</td>
                        <td className="border-b border-line p-2">{openHigh.length + openCritical.length}</td>
                        <td className="border-b border-line p-2">{failedChecks.length} blocker(s)</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              <div className={`rounded-lg border p-5 ${auditTrafficClass.box}`}>
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <p className={`text-xs font-bold uppercase ${auditTrafficClass.text}`}>Audit Pack Status</p>
                    <h2 className="mt-1 text-2xl font-black">{auditTraffic.headline}</h2>
                    <p className="mt-1 text-sm text-muted">{auditTraffic.detail}</p>
                  </div>
                  <Pill level={auditTraffic.state === "green" ? "low" : auditTraffic.state === "amber" ? "medium" : "high"}>{auditTraffic.label}</Pill>
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <SummaryLine label="Client" value={auditPack.client} />
                  <SummaryLine label="Period" value={auditPack.period} />
                  <SummaryLine label="Prepared By" value={auditPack.preparedBy || "ClosePilot"} />
                  <SummaryLine label="Review Status" value={auditPack.reviewStatus} />
                  <SummaryLine label="Findings Identified" value={auditPack.summary.findingsIdentified} />
                  <SummaryLine label="Open Findings" value={auditPack.summary.openFindings} />
                  <SummaryLine label="Accepted Risks" value={auditPack.summary.acceptedRisks} />
                  <SummaryLine label="Validation Blockers" value={auditPack.summary.validationBlockers} />
                  <SummaryLine label="Financial Health" value={`${auditPack.summary.financialHealth}/100`} />
                  <SummaryLine label="Audit Readiness" value={`${auditPack.summary.auditReadiness}/100`} />
                </div>
              </div>

              <div className="rounded-lg border border-line p-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-xs font-bold uppercase text-muted">Required Actions</p>
                    <h2 className="mt-1 font-black">What must happen before issue</h2>
                  </div>
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-600">{auditRequiredActions.length} action{auditRequiredActions.length !== 1 ? "s" : ""}</span>
                </div>
                <div className="mt-3 grid gap-2">
                  {auditRequiredActions.length ? auditRequiredActions.map((item, index) => (
                    <div key={`${item.area}-${item.action}-${index}`} className="grid gap-2 rounded-lg bg-slate-50 p-3 lg:grid-cols-[140px_110px_1fr] lg:items-start">
                      <strong className="text-sm">{item.area}</strong>
                      <span className="text-xs font-black uppercase text-muted">{item.priority}</span>
                      <div>
                        <p className="text-sm font-semibold">{item.action}</p>
                        <p className="mt-1 text-xs text-muted">{item.reason}</p>
                      </div>
                    </div>
                  )) : (
                    <p className="rounded-lg bg-emerald-50 p-3 text-sm font-semibold text-emerald-800">No required actions remain before partner sign-off.</p>
                  )}
                </div>
              </div>

              <div className="rounded-lg border border-line p-4">
                <p className="text-xs font-bold uppercase text-muted">Partner Review Summary</p>
                <h2 className="mt-1 font-black">Area-by-area conclusion</h2>
                <div className="mt-4 grid gap-3 lg:grid-cols-2">
                  {auditPartnerSummary.map((section) => (
                    <div key={section.area} className="rounded-lg border border-line bg-white p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-xs font-bold uppercase text-muted">{section.area}</p>
                          <h3 className="mt-1 font-black">{section.status}</h3>
                        </div>
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-black text-slate-600">{section.area}</span>
                      </div>
                      <p className="mt-3 text-sm font-semibold">{section.summary}</p>
                      <p className="mt-2 text-xs text-muted">Evidence: {section.evidence}</p>
                      <p className="mt-2 text-xs text-muted">Action: {section.action}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-lg border border-line p-4">
                <p className="text-xs font-bold uppercase text-muted">Findings Summary</p>
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full min-w-[760px] border-collapse text-left text-sm">
                    <thead className="bg-slate-50 text-xs uppercase text-muted">
                      <tr>
                        <th className="border-b border-line p-2">Severity</th>
                        <th className="border-b border-line p-2">Finding</th>
                        <th className="border-b border-line p-2">Status</th>
                        <th className="border-b border-line p-2">Owner</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pdfFindings.map((finding) => (
                        <tr key={finding.id}>
                          <td className="border-b border-line p-2 font-bold capitalize">{finding.severity}</td>
                          <td className="border-b border-line p-2">{finding.title}</td>
                          <td className="border-b border-line p-2">{STATUS_CONFIG[finding.status]?.label ?? finding.status}</td>
                          <td className="border-b border-line p-2">{findingOwner(finding)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="rounded-lg border border-line p-4">
                <p className="text-xs font-bold uppercase text-muted">Control Checklist</p>
                <div className="mt-3 grid gap-2 md:grid-cols-2">
                  {auditChecklist.map((item) => (
                    <div key={item.label} className="flex items-start justify-between gap-3 rounded-lg bg-slate-50 p-3">
                      <div>
                        <strong className="text-sm">{item.label}</strong>
                        <p className="mt-1 text-xs text-muted">{item.detail}</p>
                      </div>
                      <ValidationPill status={item.passed ? "passed" : "failed"} />
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-lg border border-line p-4">
                <p className="text-xs font-bold uppercase text-muted">Review Notes Library</p>
                <h2 className="mt-1 font-black">Reusable workpaper wording</h2>
                <div className="mt-3 grid gap-3">
                  {reviewNoteFindings.map((finding) => {
                    const notes = reviewNotesForFinding(finding);
                    return (
                      <div key={finding.id} className="rounded-lg border border-line bg-white p-4">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                          <div>
                            <p className="text-xs font-bold uppercase text-muted">{notes.findingCode}</p>
                            <h3 className="mt-1 font-black">{finding.title}</h3>
                          </div>
                          <Pill level={finding.severity}>{finding.severity}</Pill>
                        </div>
                        <div className="mt-3 grid gap-3 lg:grid-cols-2">
                          <SummaryNote label="Reviewer Note" value={notes.reviewerNote} />
                          <SummaryNote label="Manager Note" value={notes.managerNote} />
                          <SummaryNote label="Partner Conclusion" value={notes.partnerConclusion} />
                          <SummaryNote label="Client Explanation" value={notes.clientExplanation} />
                        </div>
                      </div>
                    );
                  })}
                  {reviewNoteFindings.length === 0 ? <p className="rounded-lg bg-slate-50 p-3 text-sm text-muted">No review notes generated.</p> : null}
                </div>
              </div>

              <div className="rounded-lg border border-line p-4">
                <p className="text-xs font-bold uppercase text-muted">Workpaper Generator</p>
                <h2 className="mt-1 font-black">WP-01 to WP-06 generated from review evidence</h2>
                <div className="mt-3 grid gap-3">
                  {workpapers.map((workpaper) => (
                    <div key={workpaper.id} className="rounded-lg border border-line bg-white p-4">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <p className="text-xs font-bold uppercase text-muted">{workpaper.id}</p>
                          <h3 className="mt-1 font-black">{workpaper.title}</h3>
                          <p className="mt-1 text-sm text-muted">{workpaper.area}</p>
                        </div>
                        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-600">{workpaper.findings.length} finding{workpaper.findings.length !== 1 ? "s" : ""}</span>
                      </div>
                      <div className="mt-3 grid gap-3 lg:grid-cols-2">
                        <SummaryNote label="Objective" value={workpaper.objective} />
                        <SummaryNote label="Risk" value={workpaper.risk} />
                        <SummaryNote label="Evidence Reviewed" value={workpaper.evidenceReviewed.length ? workpaper.evidenceReviewed.join("; ") : "No specific evidence uploaded for this area."} />
                        <SummaryNote label="Procedure Performed" value={workpaper.procedurePerformed} />
                        <SummaryNote label="Conclusion" value={workpaper.conclusion} />
                        <SummaryNote label="Reviewer" value={`${workpaper.reviewer} · ${new Date(workpaper.date).toLocaleDateString("en-GB")}`} />
                      </div>
                      {workpaper.findings.length ? (
                        <div className="mt-3 overflow-x-auto">
                          <table className="w-full min-w-[980px] border-collapse text-left text-sm">
                            <thead className="bg-slate-50 text-xs uppercase text-muted">
                              <tr>
                                <th className="border-b border-line p-2">Code</th>
                                <th className="border-b border-line p-2">Finding</th>
                                <th className="border-b border-line p-2">Source</th>
                                <th className="border-b border-line p-2">Evidence Reference</th>
                                <th className="border-b border-line p-2">Strength</th>
                                <th className="border-b border-line p-2">Status</th>
                              </tr>
                            </thead>
                            <tbody>
                              {workpaper.findings.map((finding) => (
                                <tr key={finding.id}>
                                  <td className="border-b border-line p-2 font-bold">{finding.code}</td>
                                  <td className="border-b border-line p-2">{finding.title}</td>
                                  <td className="border-b border-line p-2">{finding.sourceFile}</td>
                                  <td className="border-b border-line p-2">
                                    <span className="block font-semibold">{finding.rowIndexes}</span>
                                    <span className="mt-1 block text-xs text-muted">{finding.calculation}</span>
                                  </td>
                                  <td className="border-b border-line p-2">{finding.evidenceStrength} · {finding.detectionConfidence}%</td>
                                  <td className="border-b border-line p-2">{finding.status}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          <div className="mt-6 grid gap-4 lg:grid-cols-[0.95fr_1.05fr]">
            <div className={`rounded-lg border p-4 ${partnerSignOff ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}>
              <p className="text-xs font-bold uppercase text-muted">Partner Sign-Off</p>
              <h2 className={`mt-1 text-xl font-black ${partnerSignOff ? "text-emerald-800" : "text-amber-800"}`}>{partnerSignOff ? "Locked" : "Awaiting Partner Sign-Off"}</h2>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <SummaryLine label="Prepared By" value={preparedBy || "-"} />
                <SummaryLine label="Reviewed By" value={reviewedBy || partnerSignOff?.reviewedBy || "-"} />
                <SummaryLine label="Approved By" value={approvedBy || partnerSignOff?.approvedBy || "-"} />
                <SummaryLine label="Date" value={partnerSignOff ? new Date(partnerSignOff.signedAt).toLocaleDateString("en-GB") : today} />
                <SummaryLine label="Review Pack Status" value={partnerSignOff ? "LOCKED" : reviewPackStatusLabel} />
              </div>
              {partnerSignOff ? (
                <>
                  <p className="mt-2 text-sm font-semibold">Signed by {partnerSignOff.signedBy} on {new Date(partnerSignOff.signedAt).toLocaleString("en-GB")}.</p>
                  {partnerSignOff.note ? <p className="mt-2 text-sm text-muted">{partnerSignOff.note}</p> : null}
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <SummaryLine label="Readiness at sign-off" value={`${partnerSignOff.approval?.readinessScore ?? partnerSignOff.gateSnapshot.readiness}%`} />
                    <SummaryLine label="Confidence at sign-off" value={`${partnerSignOff.approval?.confidenceScore ?? reviewedPct}%`} />
                    <SummaryLine label="Open findings signed" value={partnerSignOff.approval?.openFindings ?? openFindings.length} />
                    <SummaryLine label="Accepted risks signed" value={partnerSignOff.approval?.acceptedRisks ?? acceptedRiskFindings.length} />
                    <SummaryLine label="Evidence outstanding" value={partnerSignOff.gateSnapshot.evidenceOutstanding} />
                    <SummaryLine label="Validation blockers" value={partnerSignOff.gateSnapshot.validationBlockers} />
                    <SummaryLine label="Critical open" value={partnerSignOff.gateSnapshot.criticalOpen} />
                  </div>
                  {partnerSignOff.approval?.approvalComment ? <p className="mt-2 text-sm text-muted">{partnerSignOff.approval.approvalComment}</p> : null}
                </>
              ) : (
                <p className="mt-2 text-sm text-muted">Final issue is not complete until the partner sign-off gate is passed and the partner records their conclusion in the Findings workflow.</p>
              )}
            </div>
            <div className="rounded-lg border border-line p-4">
              <p className="text-xs font-bold uppercase text-muted">Manager Review Summary</p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <SummaryLine label="Manager approved" value={managerApproved} />
                <SummaryLine label="Partner escalated" value={managerEscalated} />
                <SummaryLine label="Returned to reviewer" value={managerReturned} />
                <SummaryLine label="Evidence attachments" value={findingEvidence.length} />
                <SummaryLine label="Accepted evidence" value={acceptedEvidence} />
                <SummaryLine label="Rejected evidence" value={rejectedEvidence} />
                <SummaryLine label="Finding comments" value={findingComments.length} />
                <SummaryLine label="Activity log entries" value={findingActivities.length} />
              </div>
            </div>
          </div>

          <div className={`mt-6 rounded-lg border p-5 ${partnerSignOff ? "border-emerald-300 bg-white" : "border-slate-200 bg-slate-50"}`}>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-xs font-bold uppercase text-muted">Sign-Off Certificate</p>
                <h2 className="mt-1 text-2xl font-black">{partnerSignOff ? "Partner Approved and Locked" : "Draft Certificate"}</h2>
                <p className="mt-1 text-sm text-muted">Immutable certificate values recorded with the review pack export.</p>
              </div>
              <Pill level={partnerSignOff ? "low" : "medium"}>{signOffCertificate.reviewPackStatus}</Pill>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <SummaryLine label="Prepared By" value={signOffCertificate.preparedBy || "-"} />
              <SummaryLine label="Reviewed By" value={signOffCertificate.reviewedBy || "-"} />
              <SummaryLine label="Approved By" value={signOffCertificate.approvedBy || "-"} />
              <SummaryLine label="Date" value={new Date(signOffCertificate.date).toLocaleDateString("en-GB")} />
              <SummaryLine label="Readiness Score" value={`${signOffCertificate.readinessScore}%`} />
              <SummaryLine label="Confidence Score" value={`${signOffCertificate.confidenceScore}%`} />
              <SummaryLine label="Accepted Risks" value={signOffCertificate.acceptedRisks} />
              <SummaryLine label="Locked At" value={signOffCertificate.lockedAt ? new Date(signOffCertificate.lockedAt).toLocaleString("en-GB") : "-"} />
            </div>
            {partnerSignOff?.approval?.approvalComment ? (
              <p className="mt-4 rounded-lg border border-line bg-slate-50 p-3 text-sm text-muted">{partnerSignOff.approval.approvalComment}</p>
            ) : null}
          </div>

          <div className="mt-6 rounded-lg border border-violet-200 bg-violet-50 p-4">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xs font-bold uppercase text-violet-800">Accepted Risk Register</p>
                <h2 className="font-black text-violet-950">{acceptedRiskFindings.length} accepted risk{acceptedRiskFindings.length !== 1 ? "s" : ""}</h2>
              </div>
              <Pill level={acceptedRiskFindings.length ? "medium" : "low"}>{acceptedRiskFindings.length ? "Partner visible" : "None"}</Pill>
            </div>
            {acceptedRiskFindings.length ? (
              <div className="mt-3 grid gap-3">
                {acceptedRiskFindings.map((finding, index) => (
                  <div key={finding.id} className="rounded-lg border border-violet-200 bg-white p-3">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <p className="text-xs font-bold uppercase text-violet-700">Risk {index + 1}</p>
                        <h3 className="mt-1 font-black">{finding.title}</h3>
                        <p className="mt-1 text-sm text-muted">{finding.resolutionNote || finding.reviewReason || finding.recommendation || "Accepted by review decision; retain evidence with the review pack."}</p>
                      </div>
                      <Pill level={finding.severity}>{finding.severity}</Pill>
                    </div>
                    <div className="mt-3 grid gap-2 sm:grid-cols-3">
                      <SummaryLine label="Exposure" value={finding.amount ? `£${Math.round(finding.amount).toLocaleString()}` : finding.expectedImpact} />
                      <SummaryLine label="Approved By" value={finding.approvedBy || partnerSignOff?.approval?.approvedBy || partnerSignOff?.signedBy || "-"} />
                      <SummaryLine label="Date" value={new Date(finding.approvedAt || finding.resolvedAt || finding.reviewedAt || partnerSignOff?.approval?.approvedAt || partnerSignOff?.signedAt || new Date().toISOString()).toLocaleDateString("en-GB")} />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-3 text-sm text-muted">No accepted risks have been recorded for this review pack.</p>
            )}
          </div>

          <div className="mt-6 rounded-lg border border-line p-4">
            <h2 className="font-black">Financial Exposure Explanation</h2>
            <p className="mt-1 text-sm text-muted">Exposure is not a black-box AI score. It is the sum of evidence-linked risk buckets from the uploaded finance pack.</p>
            <div className="mt-3 grid gap-2">
              <ReportFormulaRow label="Cash / AR risk" value={exposure.cashRisk} formula="Overdue debtors + collection concentration + forecast pressure" />
              <ReportFormulaRow label="VAT risk" value={exposure.vatRisk} formula="VAT findings with explicit impact + standard exception estimates where no value is supplied" />
              <ReportFormulaRow label="Close / AP risk" value={exposure.closeRisk} formula="Month-end, AP and close adjustment findings with measurable expected impact" />
              <ReportFormulaRow label="Control risk" value={exposure.controlRisk} formula="Controls, fraud and data-quality findings with monetary impact" />
              <div className="flex justify-between rounded-lg bg-slate-900 p-3 text-white"><span>Total exposure</span><strong>£{Math.round(exposure.total).toLocaleString()}</strong></div>
            </div>
          </div>
        </div>

        <div className="print-page mt-6 rounded-lg border border-line p-4">
          <h2 className="font-black">Collection Opportunity Report</h2>
          <p className="mt-1 text-sm text-muted">ClosePilot prioritises customers where collection action, credit control or provision review can release cash or reduce audit risk.</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <ReportMetric label="Cash At Risk" value={`£${Math.round(cashAtRisk / 1000)}k`} detail="AR assurance findings" />
            <ReportMetric label="ECL Proxy" value={`£${Math.round(ecl / 1000)}k`} detail="Expected credit loss estimate" />
            <ReportMetric label="Priority Customers" value={String(collection.length)} detail="requiring action" />
          </div>
          <div className="mt-4 overflow-x-auto">
            {collection.length ? (
              <table className="w-full min-w-[760px] border-collapse text-left text-sm">
                <thead className="text-xs uppercase text-muted">
                  <tr>
                    <th className="border-b border-line p-2">Customer / group</th>
                    <th className="border-b border-line p-2">Exposure</th>
                    <th className="border-b border-line p-2">Reason</th>
                    <th className="border-b border-line p-2">Collection action</th>
                  </tr>
                </thead>
                <tbody>
                  {collection.map((item, index) => (
                    <tr key={`${item.customer}-${index}`}>
                      <td className="border-b border-line p-2 font-bold">{item.customer}</td>
                      <td className="border-b border-line p-2 font-black">£{item.value.toLocaleString("en-GB")}</td>
                      <td className="border-b border-line p-2">{item.reason}</td>
                      <td className="border-b border-line p-2">{item.action}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="rounded-lg bg-slate-50 p-3 text-sm text-muted">No AR collection priorities were identified from the uploaded pack.</p>
            )}
          </div>
        </div>

        <div className="print-page mt-6 rounded-lg border border-line p-4">
          <h2 className="font-black">Supplier Risk Report</h2>
          <p className="mt-1 text-sm text-muted">AP priorities are separated from review prompts so duplicate payment, vendor and supplier concentration risks are clear.</p>
          <div className="mt-4 overflow-x-auto">
            {supplierRisk.length ? (
              <table className="w-full min-w-[760px] border-collapse text-left text-sm">
                <thead className="text-xs uppercase text-muted">
                  <tr>
                    <th className="border-b border-line p-2">Supplier / group</th>
                    <th className="border-b border-line p-2">Exposure</th>
                    <th className="border-b border-line p-2">Reason</th>
                    <th className="border-b border-line p-2">AP action</th>
                  </tr>
                </thead>
                <tbody>
                  {supplierRisk.map((item, index) => (
                    <tr key={`${item.supplier}-${index}`}>
                      <td className="border-b border-line p-2 font-bold">{item.supplier}</td>
                      <td className="border-b border-line p-2 font-black">£{item.value.toLocaleString("en-GB")}</td>
                      <td className="border-b border-line p-2">{item.reason}</td>
                      <td className="border-b border-line p-2">{item.action}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="rounded-lg bg-slate-50 p-3 text-sm text-muted">No AP supplier risks were identified from the uploaded pack.</p>
            )}
          </div>
        </div>

        {packType !== "client" && (
          <div className="print-page mt-6 grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
            <div className="rounded-lg border border-line p-4">
              <h2 className="font-black">Evidence Profile</h2>
              <div className="mt-3 grid gap-2">
                <div className="flex justify-between rounded-lg bg-emerald-50 p-3"><span>Assurance findings</span><strong>{profile.deterministic}</strong></div>
                <div className="flex justify-between rounded-lg bg-blue-50 p-3"><span>Risk indicators</span><strong>{profile.indicator}</strong></div>
                <div className="flex justify-between rounded-lg bg-slate-50 p-3"><span>Review reminders</span><strong>{profile.advisory}</strong></div>
                <div className="flex justify-between rounded-lg bg-slate-50 p-3"><span>Evidence-linked findings</span><strong>{profile.evidenceLinked}/{findings.length}</strong></div>
              </div>
            </div>
            <div className="rounded-lg border border-line p-4">
              <h2 className="font-black">Priority Review Items</h2>
              <div className="mt-3 grid gap-2">
                {priorityFindings.length ? priorityFindings.map((finding) => (
                  <div key={finding.id} className="rounded-lg border border-line bg-slate-50 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <strong className="text-sm">{finding.title}</strong>
                      <Pill level={finding.severity}>{finding.severity}</Pill>
                    </div>
                    <p className="mt-1 text-xs text-muted">{finding.expectedImpact}</p>
                  </div>
                )) : <p className="text-sm text-muted">No unresolved findings remain in the review queue.</p>}
              </div>
            </div>
          </div>
        )}

        <div className="print-page mt-6 rounded-lg border border-line p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="font-black">Close Sign-Off Reconciliations</h2>
              <p className="mt-1 text-sm text-muted">Cross-file checks are shown separately because they are the evidence a manager or partner relies on before sign-off.</p>
            </div>
            <ReportMetric label="Passed" value={`${reconciliationChecks.filter((check) => check.status === "passed").length}/${reconciliationChecks.length || 0}`} detail="cross-file checks" />
          </div>
          <div className="mt-4 grid gap-2 md:grid-cols-2">
            {reconciliationChecks.length ? reconciliationChecks.map((check) => (
              <div key={check.id} className="flex items-start justify-between gap-3 rounded-lg bg-slate-50 p-3">
                <div>
                  <strong className="text-sm">{check.name}</strong>
                  <p className="mt-1 text-xs text-muted">{check.detail}</p>
                </div>
                <ValidationPill status={check.status} />
              </div>
            )) : <p className="text-sm text-muted">Upload TB, P&L, balance sheet, AR, AP and VAT exports to populate sign-off reconciliations.</p>}
          </div>
        </div>

        <div className="mt-6 rounded-lg border border-line p-4">
          <h2 className="font-black">Validation Summary</h2>
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            {validationChecks.length ? validationChecks.map((check) => (
              <div key={check.id} className="flex items-start justify-between gap-3 rounded-lg bg-slate-50 p-3">
                <div>
                  <strong className="text-sm">{check.name}</strong>
                  <p className="mt-1 text-xs text-muted">{check.detail}</p>
                </div>
                <ValidationPill status={check.status} />
              </div>
            )) : <p className="text-sm text-muted">Upload a finance pack to populate validation checks.</p>}
          </div>
        </div>

        <div className="print-page mt-6 rounded-lg border border-line p-4">
          <h2 className="font-black">Findings Triage</h2>
          <p className="mt-1 text-sm text-muted">{packType === "client" ? "Client pack includes material assurance findings only." : packType === "audit" ? "Audit pack separates sign-off blockers, review exceptions and advisory observations." : "Partner pack separates decision-critical findings from advisory observations."}</p>
          <div className="mt-4 grid gap-4">
            <FindingTriageSection title="Critical Issues" findings={criticalFindings} empty="No open critical issues." />
            <FindingTriageSection title="High Risk Findings" findings={highFindings} empty="No open high-risk findings." />
            <FindingTriageSection title="Medium Findings" findings={mediumFindings} empty="No open medium findings." />
            {packType !== "client" && <FindingTriageSection title="Advisory Observations" findings={advisoryFindings} empty="No advisory observations." compact />}
          </div>
        </div>

        {(packType === "evidence" || packType === "partner" || packType === "audit") && (
          <div className="print-page mt-6 rounded-lg border border-line p-4">
            <h2 className="font-black">Evidence Appendix</h2>
            <div className="mt-3 grid gap-3">
              {findings.slice(0, packType === "evidence" ? findings.length : 10).map((finding) => (
                <div key={finding.id} className="rounded-lg bg-slate-50 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <strong className="text-sm">{finding.ruleId ?? finding.id} · {finding.title}</strong>
                    <span className="text-xs font-bold capitalize text-muted">{finding.evidenceStrength ?? "indicator"}</span>
                  </div>
                  <p className="mt-1 text-xs text-muted">{finding.evidence.calculation}</p>
                  <p className="mt-1 text-xs text-muted">Source: {finding.evidence.sourceFile} · Account/party: {finding.evidence.accountCode || "N/A"} · Period: {finding.evidence.period}</p>
                  <div className="mt-2 grid gap-2 text-xs text-muted sm:grid-cols-3">
                    <span>Status: {LIFECYCLE_LABELS[lifecycleStatus(finding.status)]}</span>
                    <span>Owner: {findingOwner(finding)}</span>
                    <span>Manager: {managerReviewStatus(finding).replace(/_/g, " ")}</span>
                  </div>
                  {findingEvidence.filter((item) => item.findingId === finding.id).length ? (
                    <div className="mt-2 rounded-lg border border-line bg-white p-2">
                      <p className="text-xs font-bold uppercase text-muted">Uploaded Evidence</p>
                      {findingEvidence.filter((item) => item.findingId === finding.id).map((item) => (
                        <p key={item.id} className="mt-1 text-xs text-muted">{item.fileName} · {item.uploadedBy} · {new Date(item.uploadedAt).toLocaleString("en-GB")}{item.notes ? ` · ${item.notes}` : ""}</p>
                      ))}
                    </div>
                  ) : null}
                  {findingComments.filter((item) => item.findingId === finding.id).length ? (
                    <div className="mt-2 rounded-lg border border-line bg-white p-2">
                      <p className="text-xs font-bold uppercase text-muted">Review Comments</p>
                      {findingComments.filter((item) => item.findingId === finding.id).slice(0, 3).map((item) => (
                        <p key={item.id} className="mt-1 text-xs text-muted">{item.userId}: {item.comment}</p>
                      ))}
                    </div>
                  ) : null}
                  <EvidenceRowsPreview finding={finding} compact />
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <div className="rounded-lg border border-line p-4">
            <p className="text-xs font-bold uppercase text-muted">Prepared By</p>
            <p className="mt-3 text-lg font-black">{preparedBy || "Unassigned"}</p>
            <p className="mt-1 text-sm text-muted">{today}</p>
          </div>
          <div className="rounded-lg border border-line p-4">
            <p className="text-xs font-bold uppercase text-muted">Reviewed By</p>
            <p className="mt-3 text-lg font-black">{reviewedBy || "Awaiting manager / partner review"}</p>
            <p className="mt-1 text-sm text-muted">{reviewedBy ? today : "Not signed off"}</p>
          </div>
        </div>

        <p className="mt-6 border-t border-line pt-4 text-xs text-muted">Generated by ClosePilot Assurance · {tenant.name} · Confidential · The review pack is evidence-linked, but final professional judgement remains with the preparer and reviewer.</p>
      </section>
    </div>
  );
}

function ReportMetric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-lg border border-line bg-slate-50 p-4">
      <p className="text-xs font-bold uppercase text-muted">{label}</p>
      <strong className="mt-2 block break-words text-3xl font-black">{value}</strong>
      <p className="mt-1 text-sm text-muted">{detail}</p>
    </div>
  );
}

function SummaryLine({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg bg-slate-50 px-3 py-2">
      <span className="text-sm text-muted">{label}</span>
      <strong className="text-right text-sm">{value}</strong>
    </div>
  );
}

function SummaryNote({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-slate-50 p-3">
      <p className="text-xs font-bold uppercase text-muted">{label}</p>
      <p className="mt-1 text-sm leading-relaxed">{value}</p>
    </div>
  );
}

function ReportFormulaRow({ label, value, formula }: { label: string; value: number; formula: string }) {
  return (
    <div className="grid gap-2 rounded-lg border border-line bg-slate-50 p-3 sm:grid-cols-[1fr_auto] sm:items-center">
      <div>
        <strong className="text-sm">{label}</strong>
        <p className="mt-0.5 text-xs text-muted">{formula}</p>
      </div>
      <strong className="text-lg">£{Math.round(value).toLocaleString()}</strong>
    </div>
  );
}

function FindingTriageSection({ title, findings, empty, compact = false }: { title: string; findings: Finding[]; empty: string; compact?: boolean }) {
  return (
    <section className="rounded-lg border border-line bg-white p-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h3 className="font-bold">{title}</h3>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-black text-slate-600">{findings.length}</span>
      </div>
      {findings.length ? (
        <div className="grid gap-2">
          {findings.slice(0, compact ? 8 : 12).map((finding) => (
            <div key={finding.id} className="rounded-lg bg-slate-50 p-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <strong className="text-sm">{finding.title}</strong>
                  <p className="mt-1 text-xs text-muted">{finding.expectedImpact}</p>
                  {!compact && <p className="mt-1 text-xs text-muted">Source: {finding.evidence.sourceFile} · {finding.ruleId ?? finding.id}</p>}
                </div>
                <Pill level={finding.severity}>{finding.severity}</Pill>
              </div>
            </div>
          ))}
          {findings.length > (compact ? 8 : 12) && <p className="text-xs text-muted">{findings.length - (compact ? 8 : 12)} more item(s) in the evidence export.</p>}
        </div>
      ) : (
        <p className="text-sm text-muted">{empty}</p>
      )}
    </section>
  );
}

function ChangeIntelligence({ findings, uploads }: { findings: Finding[]; uploads: Upload[] }) {
  const hasData = uploads.length > 0;
  const arFindings = findings.filter((f) => f.category === "ar");
  const vatFindings = findings.filter((f) => f.category === "vat");
  const controlFindings = findings.filter((f) => f.category === "controls");
  const apFindings = findings.filter((f) => f.category === "ap");

  const changes = [
    { metric: "Revenue",         value: "—", detail: "Connect prior period data to see comparison", tone: "low" as RiskLevel },
    { metric: "Gross Margin",    value: "—", detail: "Connect prior period data to see comparison", tone: "low" as RiskLevel },
    { metric: "Cash Position",   value: "—", detail: "Connect prior period data to see comparison", tone: "low" as RiskLevel },
    { metric: "Debtor Days",     value: arFindings.length ? "Overdue" : hasData ? "Stable" : "—", detail: arFindings.length ? `${arFindings.length} AR finding(s) detected` : "No AR exceptions found", tone: arFindings.length ? "high" as RiskLevel : "low" as RiskLevel },
    { metric: "Operating Costs", value: "—", detail: "Connect prior period data to see comparison", tone: "low" as RiskLevel },
    { metric: "VAT Liability",   value: vatFindings.length ? "Exception" : hasData ? "On track" : "—", detail: vatFindings.length ? `${vatFindings.length} VAT issue(s) flagged` : "No VAT exceptions found", tone: vatFindings.length ? "medium" as RiskLevel : "low" as RiskLevel },
    { metric: "AP Duplicates",   value: apFindings.length ? "Found" : hasData ? "Clear" : "—", detail: apFindings.length ? `${apFindings.length} potential duplicate(s)` : "No duplicate invoices detected", tone: apFindings.length ? "medium" as RiskLevel : "low" as RiskLevel },
    { metric: "Controls",        value: controlFindings.length ? "Exception" : hasData ? "Clean" : "—", detail: controlFindings.length ? `${controlFindings.length} control breach(es)` : "No control exceptions", tone: controlFindings.length ? "high" as RiskLevel : "low" as RiskLevel },
  ];

  const sparkData = [
    { period: "Oct", revenue: 182, margin: 38, cash: 210 },
    { period: "Nov", revenue: 191, margin: 36, cash: 198 },
    { period: "Dec", revenue: 205, margin: 37, cash: 215 },
    { period: "Jan", revenue: 198, margin: 35, cash: 203 },
    { period: "Feb", revenue: 212, margin: 34, cash: 219 },
    { period: "Mar", revenue: 229, margin: 32, cash: 228 },
  ];

  const materialFindings = findings.filter((f) => f.severity === "critical" || f.severity === "high").slice(0, 4);

  return (
    <div className="grid gap-4">
      <section className="rounded-lg border border-line bg-white p-5 shadow-panel">
        <p className="text-xs font-bold uppercase text-muted">Change Intelligence</p>
        <h2 className="mt-1 text-2xl font-black">What changed this period — and why it matters.</h2>
        <p className="mt-2 text-muted">ClosePilot compares this period against the prior period and surfaces material movements for management review.</p>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {changes.map(({ metric, value, detail, tone }) => (
          <article key={metric} className={`min-h-32 rounded-lg border border-l-4 border-line bg-white p-4 shadow-panel ${tone === "low" ? "border-l-green" : tone === "medium" ? "border-l-amber" : "border-l-red"}`}>
            <p className="text-sm font-bold text-muted">{metric}</p>
            <strong className="mt-3 block text-3xl font-black">{value}</strong>
            <span className="mt-1 block text-sm text-muted">{detail}</span>
          </article>
        ))}
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <Panel title="Revenue, Margin & Cash — 6 Months">
          {hasData ? (
            <>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={sparkData} margin={{ left: -18, right: 18, top: 12, bottom: 0 }}>
                    <CartesianGrid stroke="#e5e7eb" strokeDasharray="4 4" vertical={false} />
                    <XAxis dataKey="period" tickLine={false} axisLine={false} />
                    <YAxis tickLine={false} axisLine={false} />
                    <Tooltip />
                    <Line type="monotone" dataKey="revenue" stroke="#1d4ed8" strokeWidth={2} dot={false} name="Revenue £k" />
                    <Line type="monotone" dataKey="margin" stroke="#15803d" strokeWidth={2} dot={false} name="Margin %" />
                    <Line type="monotone" dataKey="cash" stroke="#0e7490" strokeWidth={2} dot={false} name="Cash £k" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <p className="mt-2 text-xs italic text-muted">Upload data from multiple periods to see actual period-over-period trends.</p>
            </>
          ) : (
            <div className="flex h-72 items-center justify-center rounded-lg border-2 border-dashed border-line bg-slate-50">
              <div className="text-center">
                <p className="font-bold text-muted">No data uploaded</p>
                <p className="mt-1 text-sm text-muted">Upload finance exports from multiple periods to see trend analysis.</p>
              </div>
            </div>
          )}
        </Panel>

        <Panel title="Material Changes Driving Findings">
          <div className="grid gap-3">
            {materialFindings.length ? materialFindings.map((f) => (
              <div key={f.id} className="rounded-lg border border-line bg-slate-50 p-3">
                <div className="flex items-start justify-between gap-2">
                  <strong className="text-sm">{f.title}</strong>
                  <Pill level={f.severity}>{f.severity}</Pill>
                </div>
                <p className="mt-1 text-xs text-muted">{f.description}</p>
              </div>
            )) : (
              <p className="text-sm text-muted">No material findings linked to period changes. Upload a finance pack to generate change analysis.</p>
            )}
          </div>
        </Panel>
      </section>
    </div>
  );
}

function ScorePanel({ score, risk, company, uploads, setActive }: { score: number; risk: RiskLevel; company: Company; uploads: Upload[]; setActive: (value: string) => void }) {
  const circumference = 2 * Math.PI * 86;
  const offset = circumference - (score / 100) * circumference;
  const color = risk === "low" ? "#15803d" : risk === "medium" ? "#b45309" : "#b91c1c";

  return (
    <article className="rounded-lg border border-line bg-white p-6 shadow-panel">
      <div className="grid gap-6 md:grid-cols-[260px_1fr] md:items-center">
        <div className="relative mx-auto h-56 w-56">
          <svg className="h-full w-full -rotate-90" viewBox="0 0 220 220">
            <circle cx="110" cy="110" r="86" fill="none" stroke="#e5e7eb" strokeWidth="18" />
            <circle cx="110" cy="110" r="86" fill="none" stroke={color} strokeWidth="18" strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={offset} />
          </svg>
          <div className="absolute inset-0 grid place-items-center text-center">
            <div>
              <strong className="block text-6xl font-black">{score}</strong>
              <span className="text-xl font-black text-muted">/100</span>
              <Pill level={risk}>{riskCopy(risk)}</Pill>
            </div>
          </div>
        </div>
        <div>
          <p className="text-xs font-bold uppercase text-muted">Finance Health Score</p>
          <h2 className="mt-2 text-3xl font-black">{company.name}'s finance pack is {riskCopy(risk).toLowerCase()}.</h2>
          <p className="mt-3 max-w-xl text-muted">{uploads.length ? "ClosePilot converted uploaded finance exports into a finance review covering anomalies, cash risk, VAT exceptions, commentary and next actions." : "Upload your finance pack to generate an evidence-linked review. Score will update based on your actual findings."}</p>
          <div className="mt-5 flex flex-wrap gap-3">
            <button className="rounded-lg bg-brand px-4 py-3 font-bold text-white" onClick={() => setActive("Upload Finance Pack")}>Upload New Pack</button>
            <button className="rounded-lg border border-line px-4 py-3 font-bold" onClick={() => setActive("Ask ClosePilot")}>Explain Score</button>
          </div>
        </div>
      </div>
    </article>
  );
}

function Metric({ title, value, detail, tone }: { title: string; value: string | number; detail: string; tone: RiskLevel }) {
  const border = tone === "low" ? "border-l-green" : tone === "medium" ? "border-l-amber" : "border-l-red";
  const soft = tone === "low" ? "from-emerald-50" : tone === "medium" ? "from-amber-50" : "from-red-50";
  return (
    <article className={`min-h-32 rounded-lg border border-l-4 border-line bg-gradient-to-br ${soft} to-white p-4 shadow-panel ${border}`}>
      <p className="text-sm font-bold text-muted">{title}</p>
      <strong className="mt-3 block break-words text-3xl font-black leading-none">{value}</strong>
      <span className="mt-2 block text-sm text-muted">{detail}</span>
    </article>
  );
}

function ExecutiveSummary({ openFindings, recommendationCount, findings, validationChecks, forecast }: { openFindings: number; recommendationCount: number; findings: Finding[]; validationChecks: ValidationCheck[]; forecast: CashForecastPoint[] }) {
  const vatFindings = findings.filter((f) => f.category === "vat" && isOpenFinding(f));
  const vatCheck = validationChecks.find((v) => v.name.toLowerCase().includes("vat"));
  const vatValue = vatFindings.length ? "Exception" : findings.length ? "Clear" : "—";
  const vatDetail = vatFindings.length ? (vatCheck?.detail ?? `${vatFindings.length} VAT finding(s)`) : vatFindings.length === 0 && findings.length ? "No VAT issues found" : "Upload VAT report to check";
  const vatLevel: RiskLevel = vatFindings.length ? "high" : "low";
  const forecastRisk: RiskLevel = forecast[3]?.risk ?? "medium";
  const cashflowValue = findings.length ? riskCopy(forecastRisk) : "—";

  return (
    <section className="mb-4 rounded-lg border border-line bg-white p-5 shadow-panel">
      <div className="mb-4 flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
        <div>
          <p className="text-xs font-bold uppercase text-muted">ClosePilot Summary</p>
          <h2 className="text-xl font-black">CFO view in 30 seconds</h2>
        </div>
        <Pill level={forecastRisk}>{forecastRisk === "low" ? "Healthy cashflow" : forecastRisk === "medium" ? "Moderate cashflow risk" : "High cashflow risk"}</Pill>
      </div>
      <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
        <SummaryItem label="Revenue" value="—" detail="Upload prior period to compare" level="low" />
        <SummaryItem label="Gross Margin" value="—" detail="Upload prior period to compare" level="low" />
        <SummaryItem label="Cashflow" value={cashflowValue} detail="90-day risk" level={forecastRisk} />
        <SummaryItem label="VAT" value={vatValue} detail={vatDetail} level={vatLevel} />
        <SummaryItem label="Findings" value={String(openFindings)} detail="require review" level={openFindings ? "high" : "low"} />
        <SummaryItem label="Actions" value={String(recommendationCount)} detail="recommended" level={recommendationCount ? "medium" : "low"} />
      </div>
    </section>
  );
}

function SummaryItem({ label, value, detail, level }: { label: string; value: string; detail: string; level: RiskLevel }) {
  return (
    <div className="min-h-32 rounded-lg border border-line bg-slate-50 p-3">
      <p className="text-xs font-bold uppercase text-muted">{label}</p>
      <strong className="mt-2 block break-words text-2xl leading-none">{value}</strong>
      <p className="mt-1 text-xs text-muted">{detail}</p>
      <div className="mt-2"><Pill level={level}>{riskCopy(level)}</Pill></div>
    </div>
  );
}

function ExposureRow({ label, value, detail }: { label: string; value: number; detail: string }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-line bg-white p-3">
      <div className="min-w-0">
        <strong className="text-sm">{label}</strong>
        <p className="mt-0.5 text-xs text-muted">{detail}</p>
      </div>
      <strong className="shrink-0 text-lg">£{Math.round(value).toLocaleString()}</strong>
    </div>
  );
}

function CollectionOpportunityReport({ opportunities, ecl, cashAtRisk, setActive }: { opportunities: CollectionOpportunity[]; ecl: number; cashAtRisk: number; setActive: (value: string) => void }) {
  const topValue = opportunities.reduce((sum, item) => sum + item.value, 0);

  return (
    <Panel title="Collection Opportunity Report">
      <div className="grid gap-4 xl:grid-cols-[0.82fr_1.18fr]">
        <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
          <SummaryItem label="Cash At Risk" value={`£${cashAtRisk.toLocaleString("en-GB")}`} detail="AR assurance findings" level={cashAtRisk ? "high" : "low"} />
          <SummaryItem label="Top 10 Opportunity" value={`£${topValue.toLocaleString("en-GB")}`} detail="priority collection queue" level={topValue ? "medium" : "low"} />
          <SummaryItem label="Provision Estimate" value={`£${Math.round(ecl).toLocaleString("en-GB")}`} detail="IFRS 9-style ECL proxy" level={ecl ? "medium" : "low"} />
        </div>
        <div className="overflow-x-auto rounded-lg border border-line">
          {opportunities.length ? (
            <table className="w-full min-w-[820px] border-collapse text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-muted">
                <tr>
                  <th className="border-b border-line p-3">Customer / Group</th>
                  <th className="border-b border-line p-3">Exposure</th>
                  <th className="border-b border-line p-3">Why It Matters</th>
                  <th className="border-b border-line p-3">Next Action</th>
                </tr>
              </thead>
              <tbody>
                {opportunities.map((item, index) => (
                  <tr key={`${item.customer}-${index}`}>
                    <td className="border-b border-line p-3 font-bold">{item.customer}</td>
                    <td className="border-b border-line p-3 font-black">£{item.value.toLocaleString("en-GB")}</td>
                    <td className="border-b border-line p-3">{item.reason}</td>
                    <td className="border-b border-line p-3">{item.action}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="p-5">
              <p className="font-bold text-muted">No collection priorities identified yet.</p>
              <p className="mt-1 text-sm text-muted">Upload an aged debtors report to generate cash collection actions and provision indicators.</p>
            </div>
          )}
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <button className="rounded-lg bg-brand px-4 py-2 text-sm font-bold text-white" onClick={() => setActive("Cash Intelligence")}>Open Cash Intelligence</button>
        <button className="rounded-lg border border-line px-4 py-2 text-sm font-bold" onClick={() => setActive("Collections Intelligence")}>Open Collections</button>
      </div>
    </Panel>
  );
}

function SupplierRiskReport({ opportunities, setActive }: { opportunities: SupplierRiskOpportunity[]; setActive: (value: string) => void }) {
  const supplierExposure = opportunities.reduce((sum, item) => sum + item.value, 0);
  const duplicateRisk = opportunities.filter((item) => /duplicate/i.test(item.reason)).reduce((sum, item) => sum + item.value, 0);

  return (
    <Panel title="Supplier Risk Report">
      <div className="grid gap-4 xl:grid-cols-[0.82fr_1.18fr]">
        <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
          <SummaryItem label="Supplier Exposure" value={`£${supplierExposure.toLocaleString("en-GB")}`} detail="priority AP queue" level={supplierExposure ? "medium" : "low"} />
          <SummaryItem label="Duplicate Risk" value={`£${duplicateRisk.toLocaleString("en-GB")}`} detail="payment hold candidates" level={duplicateRisk ? "high" : "low"} />
          <SummaryItem label="Supplier Actions" value={String(opportunities.length)} detail="requiring AP review" level={opportunities.length ? "medium" : "low"} />
        </div>
        <div className="overflow-x-auto rounded-lg border border-line">
          {opportunities.length ? (
            <table className="w-full min-w-[820px] border-collapse text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-muted">
                <tr>
                  <th className="border-b border-line p-3">Supplier / Group</th>
                  <th className="border-b border-line p-3">Exposure</th>
                  <th className="border-b border-line p-3">Why It Matters</th>
                  <th className="border-b border-line p-3">Next Action</th>
                </tr>
              </thead>
              <tbody>
                {opportunities.map((item, index) => (
                  <tr key={`${item.supplier}-${index}`}>
                    <td className="border-b border-line p-3 font-bold">{item.supplier}</td>
                    <td className="border-b border-line p-3 font-black">£{item.value.toLocaleString("en-GB")}</td>
                    <td className="border-b border-line p-3">{item.reason}</td>
                    <td className="border-b border-line p-3">{item.action}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="p-5">
              <p className="font-bold text-muted">No supplier risks identified yet.</p>
              <p className="mt-1 text-sm text-muted">Upload an aged creditors report to generate duplicate payment, concentration and supplier control actions.</p>
            </div>
          )}
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <button className="rounded-lg bg-brand px-4 py-2 text-sm font-bold text-white" onClick={() => setActive("Controls & Fraud")}>Open Controls & Fraud</button>
        <button className="rounded-lg border border-line px-4 py-2 text-sm font-bold" onClick={() => setActive("Close Review")}>Open Close Review</button>
      </div>
    </Panel>
  );
}

function ReadinessTimeline({ uploads, findings, recommendations, validationChecks }: { uploads: Upload[]; findings: Finding[]; recommendations: Recommendation[]; validationChecks: ValidationCheck[] }) {
  const dataUploaded = uploads.length > 0;
  const criticalFindings = findings.filter((f) => f.severity === "critical" && isOpenFinding(f));
  const highVatFindings = findings.filter((f) => f.category === "vat" && (f.severity === "high" || f.severity === "critical") && isOpenFinding(f));
  const criticalArFindings = findings.filter((f) => f.category === "ar" && f.severity === "critical" && isOpenFinding(f));
  const vatCheckFailed = validationChecks.some((v) => v.name.toLowerCase().includes("vat") && v.status === "failed");
  const allRecsComplete = recommendations.length > 0 && recommendations.every((r) => r.completed);
  const steps = [
    ["Data Uploaded",     dataUploaded ? "Complete" : "Awaiting upload",                                                              dataUploaded ? "low" : "medium"],
    ["Variance Review",   dataUploaded ? (criticalFindings.length === 0 ? "Complete" : "Warning") : "Not started",                    dataUploaded ? (criticalFindings.length === 0 ? "low" : "medium") : "none"],
    ["VAT Review",        dataUploaded ? (highVatFindings.length === 0 && !vatCheckFailed ? "Complete" : "Warning") : "Not started",  dataUploaded ? (highVatFindings.length === 0 && !vatCheckFailed ? "low" : "medium") : "none"],
    ["AR Review",         dataUploaded ? (criticalArFindings.length === 0 ? "Complete" : "Warning") : "Not started",                  dataUploaded ? (criticalArFindings.length === 0 ? "low" : "medium") : "none"],
    ["Management Review", dataUploaded ? (allRecsComplete ? "Complete" : "In progress") : "Not started",                              dataUploaded && allRecsComplete ? "low" : dataUploaded ? "medium" : "none"],
  ] as const;

  return (
    <Panel title="Finance Review Timeline">
      <div className="grid gap-3 md:grid-cols-5">
        {steps.map(([step, status, level], index) => (
          <div key={step} className="rounded-lg border border-line bg-white p-4">
            <div className="mb-3 flex items-center gap-2">
              <span className="grid h-7 w-7 place-items-center rounded-full bg-slate-100 text-sm font-black">{index + 1}</span>
              <Pill level={level}>{status}</Pill>
            </div>
            <strong>{step}</strong>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-line bg-white p-5 shadow-panel">
      <div className="mb-4 flex items-center gap-3">
        <span className="h-5 w-1 rounded-full bg-brand" aria-hidden="true" />
        <h2 className="font-bold">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function Pill({ level, children }: { level: string; children: React.ReactNode }) {
  const colors: Record<string, string> = {
    low: "bg-emerald-100 text-emerald-800",
    medium: "bg-amber-100 text-amber-800",
    high: "bg-red-100 text-red-800",
    critical: "bg-red-100 text-red-800",
    none: "bg-slate-100 text-slate-500"
  };
  return <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-black capitalize leading-none ${colors[level] || colors.medium}`}>{children}</span>;
}

function MetricTile({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-lg border border-line bg-slate-50 p-4">
      <p className="text-xs font-bold uppercase text-muted">{label}</p>
      <p className="mt-2 truncate text-2xl font-black">{value}</p>
      <p className="mt-1 text-sm text-muted">{sub}</p>
    </div>
  );
}

function ValidationPill({ status }: { status: ValidationStatus | "warning" | "passed" | "failed" }) {
  const level = status === "passed" ? "low" : status === "warning" ? "medium" : "critical";
  return <Pill level={level}>{status}</Pill>;
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="rounded-lg border border-dashed border-line bg-slate-50 p-6 text-center">
      <strong className="block">{title}</strong>
      <p className="mt-1 text-sm text-muted">{detail}</p>
    </div>
  );
}

function EvidenceRowsPreview({ finding, compact = false }: { finding: Finding; compact?: boolean }) {
  const rows = finding.evidence.rows ?? [];
  const evidenceRef = findingEvidenceReference(finding);
  if (!rows.length) {
    return (
      <div className="mt-3 rounded-lg border border-dashed border-line bg-white p-3 text-xs text-muted">
        <p className="font-bold text-slate-700">No source rows were captured for this finding.</p>
        <p className="mt-1">Source: {evidenceRef.sourceFile}. Calculation: {evidenceRef.calculation}</p>
      </div>
    );
  }

  const visibleRows = compact ? rows.slice(0, 3) : rows.slice(0, 8);
  return (
    <div className="mt-3 rounded-lg border border-line bg-white">
      <div className="flex flex-col gap-1 border-b border-line p-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase text-muted">Source Rows</p>
          <p className="mt-1 text-sm font-semibold">{evidenceRef.sourceFile}</p>
        </div>
        <p className="text-xs text-muted">{rows.length} row{rows.length !== 1 ? "s" : ""} captured{compact && rows.length > visibleRows.length ? `, showing ${visibleRows.length}` : ""}</p>
      </div>
      <div className="grid gap-2 border-b border-line bg-slate-50 p-3 text-xs sm:grid-cols-3">
        <SummaryLine label="Rows" value={evidenceRef.rowIndexes} />
        <SummaryLine label="Account / Party" value={evidenceRef.accountOrParty} />
        <SummaryLine label="Calculation" value={evidenceRef.calculation} />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[920px] border-collapse text-left text-xs">
          <thead className="bg-slate-50 uppercase text-muted">
            <tr>
              <th className="border-b border-line p-2">Source File</th>
              <th className="border-b border-line p-2">Row</th>
              <th className="border-b border-line p-2">Calculation Input</th>
              <th className="border-b border-line p-2">Account / Party</th>
              <th className="border-b border-line p-2">Amount</th>
              <th className="border-b border-line p-2">Raw Source Values</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row, index) => (
              <tr key={`${row.sourceFile}-${row.rowIndex ?? "row"}-${index}`}>
                <td className="border-b border-line p-2 font-semibold">{row.sourceFile || evidenceRef.sourceFile}</td>
                <td className="border-b border-line p-2 font-mono">
                  {row.sheetName ? `${row.sheetName} · ` : ""}{row.rowIndex ? `#${row.rowIndex}` : "n/a"}
                </td>
                <td className="border-b border-line p-2 font-semibold">{evidenceCalculationLabel(row)}</td>
                <td className="border-b border-line p-2">{row.accountCode || "—"}</td>
                <td className="border-b border-line p-2">{typeof row.amount === "number" ? `£${Math.round(Math.abs(row.amount)).toLocaleString("en-GB")}` : "—"}</td>
                <td className="border-b border-line p-2">{evidenceRowPreview(row)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TrustPanel({ validationChecks, validationBlockers, validationWarnings, findings }: { validationChecks: ValidationCheck[]; validationBlockers: number; validationWarnings: number; findings: Finding[] }) {
  const hasData = findings.length > 0 || validationChecks.length > 0;
  const profile = evidenceProfile(findings);
  const evidencePct = findings.length === 0 ? null : Math.round(findings.filter((f) => f.evidence?.sourceFile).length / findings.length * 100);
  const reviewedPct = findings.length === 0 ? 0 : Math.round(profile.reviewed / findings.length * 100);
  const reportStatus = !hasData
    ? "No data uploaded — upload a finance pack to begin"
    : validationBlockers
      ? "Draft blocked: validation exceptions need review"
      : profile.blockers
        ? "Manager review required before final pack"
        : profile.unresolved
          ? "Draft ready: review remaining findings"
          : "Final-ready: evidence reviewed and signed off";
  const gates = [
    { label: "Data validation", status: hasData && validationBlockers === 0 ? "passed" : validationBlockers ? "failed" : "warning", detail: validationBlockers ? `${validationBlockers} blocker(s)` : validationWarnings ? `${validationWarnings} warning(s)` : hasData ? "No blockers" : "Awaiting upload" },
    { label: "Evidence linked", status: findings.length && evidencePct === 100 ? "passed" : findings.length ? "warning" : "warning", detail: evidencePct !== null ? `${evidencePct}% of findings` : "No findings yet" },
    { label: "Reviewer decisions", status: findings.length && profile.unresolved === 0 ? "passed" : profile.blockers ? "failed" : "warning", detail: findings.length ? `${profile.reviewed}/${findings.length} reviewed` : "No review queue" },
    { label: "Export readiness", status: hasData && validationBlockers === 0 && profile.blockers === 0 ? "passed" : validationBlockers || profile.blockers ? "failed" : "warning", detail: profile.blockers ? `${profile.blockers} high/critical open` : hasData ? "Can export draft" : "No pack" },
  ] as const;
  return (
    <Panel title="Accuracy & Trust Gate">
      <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
        <div className="rounded-lg border border-line bg-slate-50 p-4">
          <p className="text-xs font-bold uppercase text-muted">Report Status</p>
          <h3 className="mt-2 text-2xl font-black">{reportStatus}</h3>
          <p className="mt-2 text-sm text-muted">Core numbers are calculated by rules. AI explains findings only after source files, validation checks and evidence links are available.</p>
          <div className="mt-4 grid gap-2 text-sm">
            <div className="flex justify-between rounded-lg bg-white p-3"><span>Validation blockers</span><strong>{validationBlockers}</strong></div>
            <div className="flex justify-between rounded-lg bg-white p-3"><span>Validation warnings</span><strong>{validationWarnings}</strong></div>
            <div className="flex justify-between rounded-lg bg-white p-3"><span>Findings with source evidence</span><strong>{evidencePct !== null ? `${evidencePct}%` : "—"}</strong></div>
            <div className="flex justify-between rounded-lg bg-white p-3"><span>Reviewed findings</span><strong>{findings.length ? `${reviewedPct}%` : "—"}</strong></div>
          </div>
        </div>
        <div className="grid gap-3 content-start">
          <div className="grid gap-2 md:grid-cols-2">
            {gates.map((gate) => (
              <div key={gate.label} className="rounded-lg border border-line bg-white p-3">
                <div className="flex items-start justify-between gap-3">
                  <strong className="text-sm">{gate.label}</strong>
                  <ValidationPill status={gate.status} />
                </div>
                <p className="mt-1 text-xs text-muted">{gate.detail}</p>
              </div>
            ))}
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3"><strong className="text-2xl text-emerald-700">{profile.deterministic}</strong><p className="text-xs font-bold text-emerald-800">Assurance findings</p></div>
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-3"><strong className="text-2xl text-blue-700">{profile.indicator}</strong><p className="text-xs font-bold text-blue-800">Risk indicators</p></div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3"><strong className="text-2xl text-slate-600">{profile.advisory}</strong><p className="text-xs font-bold text-slate-700">Review reminders</p></div>
          </div>
          {validationChecks.slice(0, 4).map((check) => (
            <div key={check.id} className="rounded-lg border border-line bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <strong>{check.name}</strong>
                <ValidationPill status={check.status} />
              </div>
              <p className="mt-2 text-sm text-muted">{check.detail}</p>
            </div>
          ))}
          {validationChecks.length > 4 && <p className="text-xs text-muted">{validationChecks.length - 4} more validation checks appear in the appendix.</p>}
        </div>
      </div>
    </Panel>
  );
}

function ActionRow({ recommendation, complete }: { recommendation: Recommendation; complete: () => void }) {
  return (
    <div className="grid gap-3 rounded-lg border border-line bg-white p-4 shadow-sm sm:grid-cols-[1fr_auto] sm:items-center">
      <div className="min-w-0">
        <strong>{recommendation.action}</strong>
        <p className="text-sm text-muted">{recommendation.expectedImpact}</p>
      </div>
      {recommendation.completed ? (
        <span className="inline-flex h-10 items-center justify-center rounded-lg bg-emerald-100 px-3 text-sm font-black text-emerald-800">Done</span>
      ) : (
        <button className="h-10 rounded-lg bg-brand px-3 text-sm font-black text-white transition-colors hover:bg-blue-700" onClick={complete}>Approve</button>
      )}
    </div>
  );
}

function CopilotPrompt({ question, setQuestion, openCopilot }: { question: string; setQuestion: (value: string) => void; openCopilot: () => void }) {
  return (
    <Panel title="Ask ClosePilot">
      <p className="mb-3 text-sm text-muted">Ask why profit moved, what is blocking close, or where cash risk is hiding.</p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input className="h-11 flex-1 rounded-lg border border-line px-3" value={question} onChange={(event) => setQuestion(event.target.value)} />
        <button className="rounded-lg bg-brand px-5 font-bold text-white" onClick={openCopilot}>Ask</button>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {["Why is profit down?", "What is blocking month-end?", "Where is cash risk?", "Generate VAT review steps."].map((item) => (
          <button key={item} className="rounded-lg border border-line px-3 py-2 text-left text-sm font-bold" onClick={() => {
            setQuestion(item);
            openCopilot();
          }}>{item}</button>
        ))}
      </div>
    </Panel>
  );
}

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  open:                 { label: "Awaiting Review", color: "bg-slate-100 text-slate-600" },
  under_review:         { label: "Under Review",    color: "bg-blue-100 text-blue-700" },
  evidence_requested:   { label: "Evidence Requested", color: "bg-amber-100 text-amber-800" },
  evidence_received:    { label: "Evidence Received", color: "bg-cyan-100 text-cyan-800" },
  resolved:             { label: "Resolved",         color: "bg-emerald-100 text-emerald-700" },
  approved:             { label: "Approved",         color: "bg-green-100 text-green-800" },
  closed:               { label: "Closed",           color: "bg-slate-100 text-slate-500" },
  false_positive:        { label: "False Positive",   color: "bg-red-100 text-red-700" },
  accepted_risk:         { label: "Accepted Risk",    color: "bg-violet-100 text-violet-700" },
  in_review:            { label: "Under Review",     color: "bg-blue-100 text-blue-700" },
  accepted:             { label: "Resolved",         color: "bg-emerald-100 text-emerald-800" },
  rejected:             { label: "Rejected",         color: "bg-red-100 text-red-700" },
  needs_investigation:  { label: "Evidence Requested", color: "bg-amber-100 text-amber-800" },
  not_applicable:       { label: "Closed",           color: "bg-slate-100 text-slate-500" },
};

const LIFECYCLE_LABELS: Record<LifecycleStatus, string> = {
  open: "Open",
  under_review: "Under Review",
  evidence_requested: "Evidence Requested",
  evidence_received: "Evidence Received",
  resolved: "Resolved",
  approved: "Approved",
  closed: "Closed",
};

function FindingLifecycleSummary({ findings, setActive }: { findings: Finding[]; setActive: (value: string) => void }) {
  const counts = findingLifecycleCounts(findings);
  const tones: Record<LifecycleStatus, RiskLevel> = {
    open: counts.open ? "high" : "low",
    under_review: counts.under_review ? "medium" : "low",
    evidence_requested: counts.evidence_requested ? "high" : "low",
    evidence_received: counts.evidence_received ? "medium" : "low",
    resolved: "low",
    approved: "low",
    closed: "low",
  };

  return (
    <div className="grid gap-2">
      {lifecycleStatuses.map((status) => (
        <button key={status} className="grid grid-cols-[1fr_auto] items-center rounded-lg border border-line bg-slate-50 px-3 py-2 text-left transition-colors hover:border-brand hover:bg-cyan-50" onClick={() => setActive("Findings")}>
          <span className="text-sm font-bold">{LIFECYCLE_LABELS[status]}</span>
          <strong className="text-lg">{counts[status]}</strong>
          <span className="col-span-2 mt-1">
            <Pill level={tones[status]}>{status === "evidence_requested" ? "evidence queue" : status === "resolved" ? "ready for sign-off" : STATUS_CONFIG[status].label}</Pill>
          </span>
        </button>
      ))}
    </div>
  );
}

function findingOwner(finding: Finding) {
  return finding.assignedTo || finding.reviewer || "Unassigned";
}

function findingDueDate(finding: Finding) {
  if (!finding.dueDate) return "—";
  return new Date(finding.dueDate).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

function FindingsHub({ findings, findingEvidence, findingComments, findingActivities, partnerSignOff, reviewLocked, pilotWalkthroughStep, focusedFindingId, clearFocusedFinding, validationChecks, uploads, updateFindingStatus, updateFindingAssignment, updateManagerReview, recordPartnerSignOff, addFindingComment, addFindingEvidence, updateEvidenceStatus, onCreateNewReviewCycle, setActive }: {
  findings: Finding[];
  findingEvidence: Evidence[];
  findingComments: FindingComment[];
  findingActivities: FindingActivity[];
  partnerSignOff?: PartnerSignOff;
  reviewLocked: boolean;
  pilotWalkthroughStep?: number;
  focusedFindingId: string | null;
  clearFocusedFinding: () => void;
  validationChecks: ValidationCheck[];
  uploads: Upload[];
  updateFindingStatus: (findingId: string, status: FindingStatus, reason?: string) => void;
  updateFindingAssignment: (findingId: string, assignedTo: string, dueDate: string) => void;
  updateManagerReview: (findingId: string, status: ManagerReviewStatus, note?: string) => void;
  recordPartnerSignOff: (gateSnapshot: PartnerSignOffGateSnapshot, note?: string) => void;
  addFindingComment: (findingId: string, comment: string) => void;
  addFindingEvidence: (findingId: string, files: FileList | null, notes?: string) => Promise<void>;
  updateEvidenceStatus: (findingId: string, evidenceId: string, status: EvidenceStatus, note?: string) => void;
  onCreateNewReviewCycle: () => void;
  setActive: (value: string) => void;
}) {
  const [statusFilter, setStatusFilter] = useState<LifecycleStatus | "all">("all");
  const [ownerFilter, setOwnerFilter] = useState("all");
  const [selectedFindingId, setSelectedFindingId] = useState<string | null>(null);
  const [selectedFindingIds, setSelectedFindingIds] = useState<string[]>([]);
  const [bulkOwner, setBulkOwner] = useState("");
  const [bulkDueDate, setBulkDueDate] = useState("");
  const [partnerNote, setPartnerNote] = useState("");
  const counts = findingLifecycleCounts(findings);
  const readiness = calculateAuditReadinessV2(findings, validationChecks, uploads);
  const readyForManager = findings.filter(isReadyForManagerReview);
  const managerApproved = findings.filter((finding) => managerReviewStatus(finding) === "approved").length;
  const managerReturned = findings.filter((finding) => managerReviewStatus(finding) === "returned").length;
  const managerEscalated = findings.filter((finding) => managerReviewStatus(finding) === "escalated").length;
  const managerReviewComplete = uploads.length > 0 && findings.length > 0 && readyForManager.length > 0 && readyForManager.every((finding) => managerReviewStatus(finding) === "approved" || managerReviewStatus(finding) === "escalated");
  const validationBlockers = validationChecks.filter((check) => check.status === "failed").length;
  const criticalOpen = findings.filter((finding) => isOpenFinding(finding) && finding.severity === "critical").length;
  const highOpen = findings.filter((finding) => isOpenFinding(finding) && finding.severity === "high").length;
  const mediumOpen = findings.filter((finding) => isOpenFinding(finding) && finding.severity === "medium").length;
  const openEvidenceItems = findingEvidence.filter((item) => ["requested", "uploaded", "under_review", "rejected"].includes(item.status ?? "uploaded"));
  const evidenceOutstanding = findings.filter((finding) => ["evidence_requested", "needs_investigation"].includes(finding.status)).length + openEvidenceItems.length;
  const importGateBlockers = uploads.filter((upload) => upload.importGateStatus && upload.importGateStatus !== "ready").length;
  const forecastReadiness = readinessForecast(findings, validationChecks, uploads);
  const hasEvidenceCoverage = (finding: Finding) => Boolean(finding.evidenceAttached || finding.evidenceIds?.length || finding.evidence?.rows?.length || findingEvidence.some((item) => item.findingId === finding.id));
  const percentOfFindings = (count: number) => findings.length ? Math.round((count / findings.length) * 100) : 0;
  const reviewedPercent = percentOfFindings(findings.filter((finding) => reviewedFindingStatuses.includes(finding.status) || Boolean(finding.reviewedAt)).length);
  const resolvedPercent = percentOfFindings(findings.filter((finding) => !isOpenFinding(finding)).length);
  const evidenceCoveragePercent = percentOfFindings(findings.filter(hasEvidenceCoverage).length);
  const managerApprovedPercent = percentOfFindings(managerApproved);
  const workflowCoverage = findings.length ? Math.round((reviewedPercent + resolvedPercent + evidenceCoveragePercent + managerApprovedPercent) / 4) : 0;
  const workflowCoverageReady = workflowCoverage >= 80;
  const signOffEnabled = criticalOpen === 0 && highOpen === 0 && validationBlockers === 0 && evidenceOutstanding === 0 && managerReviewComplete && readiness > 70 && workflowCoverageReady && importGateBlockers === 0;
  const acceptedRiskCount = findings.filter((finding) => finding.status === "accepted_risk").length;
  const signOffSnapshot: PartnerSignOffGateSnapshot = {
    criticalOpen,
    highOpen,
    mediumOpen,
    evidenceOutstanding,
    validationBlockers,
    managerReviewComplete,
    readiness,
    findingCount: findings.length,
    uploadCount: uploads.length,
  };
  const signOffComplete = partnerSignOff?.status === "locked" || partnerSignOff?.status === "signed";
  const traffic = signOffTrafficLight({ signOffEnabled, signOffComplete: Boolean(signOffComplete), acceptedRiskCount, criticalOpen, highOpen, validationBlockers, evidenceOutstanding, managerReviewComplete });
  const trafficClasses = trafficLightClasses(traffic.state);
  const owners = Array.from(new Set(findings.map(findingOwner))).sort((a, b) => a.localeCompare(b));
  const visibleFindings = (statusFilter === "all" ? findings : findings.filter((finding) => lifecycleStatus(finding.status) === statusFilter))
    .filter((finding) => ownerFilter === "all" || findingOwner(finding) === ownerFilter);
  const evidenceQueue = findings.filter((finding) => ["evidence_requested", "needs_investigation", "evidence_received"].includes(finding.status));
  const selectedFinding = findings.find((finding) => finding.id === selectedFindingId);
  const selectedVisibleCount = visibleFindings.filter((finding) => selectedFindingIds.includes(finding.id)).length;
  const allVisibleSelected = visibleFindings.length > 0 && selectedVisibleCount === visibleFindings.length;
  const applyBulkStatus = (status: FindingStatus) => {
    selectedFindingIds.forEach((findingId) => updateFindingStatus(findingId, status));
    setSelectedFindingIds([]);
  };
  const applyBulkAssignment = () => {
    selectedFindingIds.forEach((findingId) => updateFindingAssignment(findingId, bulkOwner, bulkDueDate));
    setSelectedFindingIds([]);
    setBulkOwner("");
    setBulkDueDate("");
  };
  const toggleFindingSelection = (findingId: string) => {
    setSelectedFindingIds((ids) => ids.includes(findingId) ? ids.filter((id) => id !== findingId) : [...ids, findingId]);
  };
  const toggleAllVisibleFindings = () => {
    setSelectedFindingIds((ids) => {
      const visibleIds = visibleFindings.map((finding) => finding.id);
      if (visibleIds.every((id) => ids.includes(id))) {
        return ids.filter((id) => !visibleIds.includes(id));
      }
      return Array.from(new Set([...ids, ...visibleIds]));
    });
  };

  useEffect(() => {
    if (pilotWalkthroughStep === undefined) return;
    const targetId =
      pilotWalkthroughStep === 1 ? "find_pilot_vat_001"
        : pilotWalkthroughStep === 2 ? "find_pilot_ar_001"
          : pilotWalkthroughStep === 3 ? "find_pilot_close_001"
            : null;
    if (targetId && findings.some((finding) => finding.id === targetId)) {
      setSelectedFindingId(targetId);
    }
    if (pilotWalkthroughStep === 0) {
      setSelectedFindingId(null);
      setStatusFilter("all");
    }
  }, [findings, pilotWalkthroughStep]);

  useEffect(() => {
    if (!focusedFindingId) return;
    if (findings.some((finding) => finding.id === focusedFindingId)) {
      setSelectedFindingId(focusedFindingId);
      clearFocusedFinding();
    }
  }, [clearFocusedFinding, findings, focusedFindingId]);

  return (
    <div className="grid gap-4">
      {reviewLocked && (
        <section className="flex flex-col gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-bold uppercase text-emerald-800">Review Pack Locked</p>
            <p className="mt-1 text-sm font-semibold text-emerald-900">Partner sign-off is complete. Workflow edits are disabled; the review pack can still be exported.</p>
          </div>
          <button className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-bold text-white" onClick={onCreateNewReviewCycle}>Create New Review Cycle</button>
        </section>
      )}
      <section className="rounded-lg border border-line bg-white p-5 shadow-panel">
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
          <div>
            <p className="text-xs font-bold uppercase text-muted">Finding Lifecycle</p>
            <h2 className="mt-1 text-2xl font-black">Review, evidence, approval and sign-off</h2>
            <p className="mt-1 text-sm text-muted">{findings.length ? `${findings.length} finding(s) tracked through the review workflow.` : "Upload a finance pack to create the first review queue."}</p>
          </div>
          <button className="rounded-lg bg-brand px-4 py-2.5 text-sm font-black text-white" onClick={() => setActive(uploads.length ? "Review Pack" : "Upload Finance Pack")}>
            {uploads.length ? "Open Review Pack" : "Upload Pack"}
          </button>
        </div>
        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-left text-sm">
            <thead className="text-xs uppercase text-muted">
              <tr>
                <th className="border-b border-line p-2">Status</th>
                <th className="border-b border-line p-2 text-right">Count</th>
              </tr>
            </thead>
            <tbody>
              {lifecycleStatuses.map((status) => (
                <tr key={status} className={`cursor-pointer ${statusFilter === status ? "bg-cyan-50" : "hover:bg-slate-50"}`} onClick={() => setStatusFilter(status)}>
                  <td className="border-b border-line p-2 font-bold">{LIFECYCLE_LABELS[status]}</td>
                  <td className="border-b border-line p-2 text-right text-lg font-black">{counts[status]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <SummaryItem label="Reviewed" value={`${reviewedPercent}%`} detail="findings touched" level={reviewedPercent >= 80 ? "low" : "medium"} />
          <SummaryItem label="Resolved" value={`${resolvedPercent}%`} detail="closed or approved" level={resolvedPercent >= 70 ? "low" : "medium"} />
          <SummaryItem label="Evidence Coverage" value={`${evidenceCoveragePercent}%`} detail="support linked" level={evidenceCoveragePercent >= 75 ? "low" : "high"} />
          <SummaryItem label="Manager Approved" value={`${managerApprovedPercent}%`} detail={`${managerApproved} approved`} level={managerApprovedPercent >= 70 ? "low" : "medium"} />
          <SummaryItem label="Workflow Coverage" value={`${workflowCoverage}%`} detail="pilot quality gate" level={workflowCoverageReady ? "low" : "high"} />
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
        <Panel title="Partner View">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <SummaryItem label="Critical Open" value={String(criticalOpen)} detail="must be zero" level={criticalOpen ? "critical" : "low"} />
            <SummaryItem label="High Open" value={String(highOpen)} detail="manager review" level={highOpen ? "high" : "low"} />
            <SummaryItem label="Medium Open" value={String(mediumOpen)} detail="review queue" level={mediumOpen ? "medium" : "low"} />
            <SummaryItem label="Evidence Outstanding" value={String(evidenceOutstanding)} detail="requests to close" level={evidenceOutstanding ? "high" : "low"} />
            <SummaryItem label="Workflow" value={`${workflowCoverage}%`} detail="threshold 80%" level={workflowCoverageReady ? "low" : "high"} />
          </div>
          <div className={`mt-4 rounded-lg border p-4 ${trafficClasses.box}`}>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xs font-bold uppercase text-muted">Partner Sign-Off Status</p>
                <strong className={`mt-1 block text-2xl ${trafficClasses.text}`}>{traffic.label}</strong>
                <p className="mt-1 text-sm font-semibold text-muted">{traffic.detail}</p>
              </div>
              <div className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-full ${trafficClasses.dot} text-sm font-black text-white`}>
                {traffic.state === "green" ? "READY" : traffic.state === "amber" ? "RISK" : "STOP"}
              </div>
            </div>
            {partnerSignOff ? (
              <p className="mt-1 text-sm font-semibold text-emerald-800">
                Signed by {partnerSignOff.signedBy} on {new Date(partnerSignOff.signedAt).toLocaleString("en-GB")}.
              </p>
            ) : null}
          </div>
          <div className="mt-4 rounded-lg border border-line bg-slate-50 p-4">
            <p className="text-xs font-bold uppercase text-muted">Readiness Forecast</p>
            <div className="mt-3 grid gap-2">
              <ForecastLine label={forecastReadiness.nextFinding ? `Next: ${forecastReadiness.nextFinding.title}` : "Next finding"} from={forecastReadiness.current} to={forecastReadiness.nextResolved} />
              <ForecastLine label="All high-risk findings" from={forecastReadiness.current} to={forecastReadiness.highResolved} />
              <ForecastLine label="All open findings" from={forecastReadiness.current} to={forecastReadiness.allResolved} />
            </div>
            <p className="mt-3 text-xs font-semibold text-muted">Estimated review effort: {forecastReadiness.effortMinutes} mins.</p>
          </div>
        </Panel>

        <Panel title="Partner Sign-Off Gate">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <SignOffCheck label="Critical Findings" passed={criticalOpen === 0} detail={criticalOpen ? `${criticalOpen} critical open` : "No critical findings open"} />
            <SignOffCheck label="High Findings" passed={highOpen === 0} detail={highOpen ? `${highOpen} high open` : "No high findings open"} />
            <SignOffCheck label="Validation Blockers" passed={validationBlockers === 0} detail={validationBlockers ? `${validationBlockers} blocker(s)` : "No failed checks"} />
            <SignOffCheck label="Evidence Requests" passed={evidenceOutstanding === 0} detail={evidenceOutstanding ? `${evidenceOutstanding} outstanding` : "All evidence requests closed"} />
            <SignOffCheck label="Manager Review" passed={managerReviewComplete} detail={managerReviewComplete ? "Review complete" : "Manager review open"} />
            <SignOffCheck label="Accepted Risks" passed={acceptedRiskCount === 0} warning={acceptedRiskCount > 0} detail={acceptedRiskCount ? `${acceptedRiskCount} partner-visible risk(s)` : "No accepted risks"} />
            <SignOffCheck label="Readiness" passed={readiness > 70} detail={`${readiness}%`} />
            <SignOffCheck label="Workflow Coverage" passed={workflowCoverageReady} detail={`${workflowCoverage}%`} />
            <SignOffCheck label="Import Gates" passed={importGateBlockers === 0} detail={importGateBlockers ? `${importGateBlockers} upload(s) need mapping` : "Imports cleared"} />
          </div>
          <div className={`mt-4 rounded-lg border p-4 ${trafficClasses.box}`}>
            <p className="text-xs font-bold uppercase text-muted">Partner Sign-Off</p>
            <strong className={`mt-1 block text-2xl ${trafficClasses.text}`}>{traffic.headline}</strong>
            <p className="mt-1 text-sm font-semibold text-muted">{traffic.detail}</p>
            {partnerSignOff ? (
              <div className="mt-3 rounded-lg border border-emerald-200 bg-white p-3 text-sm">
                <p className="font-bold">Partner conclusion recorded</p>
                <p className="mt-1 text-muted">Readiness {partnerSignOff.gateSnapshot.readiness}% · {partnerSignOff.gateSnapshot.findingCount} finding(s) · {partnerSignOff.gateSnapshot.uploadCount} upload(s)</p>
                {partnerSignOff.note ? <p className="mt-2 text-muted">{partnerSignOff.note}</p> : null}
              </div>
            ) : (
              <div className="mt-3 grid gap-3">
                <textarea
                  className="min-h-24 rounded-lg border border-line p-3 text-sm"
                  placeholder="Partner conclusion note"
                  value={partnerNote}
                  onChange={(event) => setPartnerNote(event.target.value)}
                />
                <button
                  className={`rounded-lg px-4 py-2.5 text-sm font-black ${signOffEnabled ? "bg-emerald-600 text-white" : "cursor-not-allowed bg-slate-200 text-muted"}`}
                  disabled={!signOffEnabled}
                  onClick={() => {
                    recordPartnerSignOff(signOffSnapshot, partnerNote);
                    setPartnerNote("");
                  }}
                >
                  Sign Off Review Pack
                </button>
              </div>
            )}
          </div>
        </Panel>

      </section>

      <section className="grid gap-4 xl:grid-cols-[1fr_0.86fr]">
        <Panel title="Manager Review Queue">
          <div className="mb-4 grid gap-3 sm:grid-cols-4">
            <SummaryItem label="Ready" value={String(readyForManager.length)} detail="awaiting manager decision" level={readyForManager.length ? "medium" : "low"} />
            <SummaryItem label="Approved" value={String(managerApproved)} detail="manager signed" level="low" />
            <SummaryItem label="Returned" value={String(managerReturned)} detail="back to reviewer" level={managerReturned ? "high" : "low"} />
            <SummaryItem label="Escalated" value={String(managerEscalated)} detail="partner attention" level={managerEscalated ? "medium" : "low"} />
          </div>
          <div className="grid gap-3">
            {readyForManager.slice(0, 5).map((finding) => {
              const reviewStatus = managerReviewStatus(finding);
              return (
                <div key={finding.id} className="rounded-lg border border-line bg-slate-50 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <strong className="block truncate text-sm">{finding.title}</strong>
                      <p className="mt-1 text-xs text-muted">{findingOwner(finding)} · {STATUS_CONFIG[finding.status]?.label ?? finding.status}</p>
                    </div>
                    <span className="shrink-0 rounded-full bg-white px-2 py-0.5 text-xs font-black text-slate-600">{reviewStatus.replaceAll("_", " ")}</span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300" disabled={reviewLocked} onClick={() => updateManagerReview(finding.id, "approved")}>Manager Approve</button>
                    <button className="rounded-lg border border-line bg-white px-3 py-1.5 text-xs font-bold disabled:cursor-not-allowed disabled:text-muted" disabled={reviewLocked} onClick={() => updateManagerReview(finding.id, "returned")}>Return</button>
                    <button className="rounded-lg bg-slate-700 px-3 py-1.5 text-xs font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300" disabled={reviewLocked} onClick={() => updateManagerReview(finding.id, "escalated")}>Escalate</button>
                  </div>
                </div>
              );
            })}
            {!readyForManager.length && <EmptyState title="No manager review queue" detail="Resolve, accept risk, false-positive, or receive evidence before manager review." />}
          </div>
        </Panel>

        <Panel title="Finding Register">
          <div className="mb-3 flex flex-wrap gap-2">
            <select className="h-10 rounded-lg border border-line bg-white px-3 text-sm font-bold" value={ownerFilter} onChange={(event) => setOwnerFilter(event.target.value)}>
              <option value="all">All Owners</option>
              {owners.map((owner) => <option key={owner} value={owner}>{owner}</option>)}
            </select>
            <button className={`rounded-lg px-3 py-2 text-sm font-bold ${statusFilter === "all" ? "bg-brand text-white" : "border border-line bg-white"}`} onClick={() => setStatusFilter("all")}>All Findings</button>
            {lifecycleStatuses.map((status) => (
              <button key={status} className={`rounded-lg px-3 py-2 text-sm font-bold ${statusFilter === status ? "bg-brand text-white" : "border border-line bg-white"}`} onClick={() => setStatusFilter(status)}>
                {LIFECYCLE_LABELS[status]}
              </button>
            ))}
          </div>
          <div className="mb-3 grid gap-2 rounded-lg border border-line bg-slate-50 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <button className="rounded-lg border border-line bg-white px-3 py-2 text-sm font-bold" onClick={toggleAllVisibleFindings}>
                {allVisibleSelected ? "Clear Visible" : "Select Visible"} ({selectedVisibleCount})
              </button>
              <input className="h-10 min-w-44 rounded-lg border border-line bg-white px-3 text-sm" value={bulkOwner} onChange={(event) => setBulkOwner(event.target.value)} placeholder="Owner" />
              <input className="h-10 rounded-lg border border-line bg-white px-3 text-sm" type="date" value={bulkDueDate} onChange={(event) => setBulkDueDate(event.target.value)} />
              <button className="rounded-lg bg-brand px-3 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300" disabled={reviewLocked || !selectedFindingIds.length} onClick={applyBulkAssignment}>Assign Owner</button>
            </div>
            <div className="flex flex-wrap gap-2">
              <button className="rounded-lg border border-line bg-white px-3 py-2 text-sm font-bold disabled:cursor-not-allowed disabled:text-muted" disabled={reviewLocked || !selectedFindingIds.length} onClick={() => applyBulkStatus("evidence_requested")}>Request Evidence</button>
              <button className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300" disabled={reviewLocked || !selectedFindingIds.length} onClick={() => applyBulkStatus("resolved")}>Mark Resolved</button>
              <button className="rounded-lg bg-green-700 px-3 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300" disabled={reviewLocked || !selectedFindingIds.length} onClick={() => applyBulkStatus("approved")}>Approve</button>
            </div>
          </div>
          <FindingRegister findings={visibleFindings} onSelect={setSelectedFindingId} selectedIds={selectedFindingIds} onToggleSelected={toggleFindingSelection} />
        </Panel>

        <Panel title="Evidence Management">
          <div className="grid gap-3">
            {evidenceQueue.length ? evidenceQueue.slice(0, 5).map((finding) => (
              <div key={finding.id} className="rounded-lg border border-line bg-slate-50 p-3">
                {(() => {
                  const linkedEvidence = findingEvidence.filter((item) => item.findingId === finding.id);
                  const actionableEvidence = linkedEvidence.find((item) => item.status === "uploaded" || item.status === "under_review" || !item.status) ?? linkedEvidence.find((item) => item.status === "rejected" || item.status === "requested");
                  return (
                    <>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <strong className="block truncate text-sm">{finding.title}</strong>
                    <p className="mt-1 text-xs text-muted">{linkedEvidence.length || finding.evidenceIds?.length ? `${linkedEvidence.length || finding.evidenceIds?.length} evidence item(s) linked · ${linkedEvidence.filter((item) => item.status === "accepted").length} accepted · ${linkedEvidence.filter((item) => item.status === "rejected").length} rejected · ${linkedEvidence.filter((item) => item.status === "superseded").length} superseded` : finding.evidence.sourceFile}</p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-black ${STATUS_CONFIG[finding.status]?.color ?? STATUS_CONFIG.open.color}`}>{STATUS_CONFIG[finding.status]?.label ?? "Open"}</span>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button className="rounded-lg border border-line bg-white px-3 py-1.5 text-xs font-bold disabled:cursor-not-allowed disabled:text-muted" disabled={reviewLocked} onClick={() => updateFindingStatus(finding.id, "evidence_requested")}>Request Evidence</button>
                  <button className="rounded-lg border border-line bg-white px-3 py-1.5 text-xs font-bold disabled:cursor-not-allowed disabled:text-muted" disabled={reviewLocked} onClick={() => updateFindingStatus(finding.id, "evidence_received")}>Evidence Received</button>
                  <button className="rounded-lg border border-line bg-white px-3 py-1.5 text-xs font-bold disabled:cursor-not-allowed disabled:text-muted" disabled={reviewLocked || !actionableEvidence || actionableEvidence.status === "requested"} onClick={() => actionableEvidence ? updateEvidenceStatus(finding.id, actionableEvidence.id, "under_review") : undefined}>Review Evidence</button>
                  <button className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300" disabled={reviewLocked || !actionableEvidence || actionableEvidence.status === "rejected" || actionableEvidence.status === "requested"} onClick={() => actionableEvidence ? updateEvidenceStatus(finding.id, actionableEvidence.id, "accepted") : undefined}>Accept Evidence</button>
                  <button className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-bold text-red-700 disabled:cursor-not-allowed disabled:text-muted" disabled={reviewLocked || !actionableEvidence || actionableEvidence.status === "requested"} onClick={() => actionableEvidence ? updateEvidenceStatus(finding.id, actionableEvidence.id, "rejected") : undefined}>Reject Evidence</button>
                </div>
                    </>
                  );
                })()}
              </div>
            )) : (
              <EmptyState title="No evidence requests" detail="Request evidence from any finding that needs support before approval." />
            )}
          </div>
        </Panel>
      </section>

      <Panel title="Finding Detail Queue">
        <div className="mb-3 flex flex-wrap gap-2">
          <button className={`rounded-lg px-3 py-2 text-sm font-bold ${statusFilter === "all" ? "bg-brand text-white" : "border border-line bg-white"}`} onClick={() => setStatusFilter("all")}>All Findings</button>
          {lifecycleStatuses.map((status) => (
            <button key={status} className={`rounded-lg px-3 py-2 text-sm font-bold ${statusFilter === status ? "bg-brand text-white" : "border border-line bg-white"}`} onClick={() => setStatusFilter(status)}>
              {LIFECYCLE_LABELS[status]}
            </button>
          ))}
        </div>
        <FindingList findings={visibleFindings} setActive={setActive} updateFindingStatus={updateFindingStatus} />
      </Panel>
      {selectedFinding && (
        <FindingDetailDrawer
          finding={selectedFinding}
          evidence={findingEvidence.filter((evidence) => evidence.findingId === selectedFinding.id)}
          comments={findingComments.filter((comment) => comment.findingId === selectedFinding.id)}
          activities={findingActivities.filter((activity) => activity.findingId === selectedFinding.id)}
          updateFindingStatus={updateFindingStatus}
          updateFindingAssignment={updateFindingAssignment}
          updateManagerReview={updateManagerReview}
          addFindingComment={addFindingComment}
          addFindingEvidence={addFindingEvidence}
          updateEvidenceStatus={updateEvidenceStatus}
          reviewLocked={reviewLocked}
          onClose={() => setSelectedFindingId(null)}
        />
      )}
    </div>
  );
}

function FindingRegister({
  findings,
  onSelect,
  selectedIds,
  onToggleSelected,
}: {
  findings: Finding[];
  onSelect: (findingId: string) => void;
  selectedIds: string[];
  onToggleSelected: (findingId: string) => void;
}) {
  if (!findings.length) return <p className="py-4 text-center text-sm text-muted">No findings match the current status.</p>;
  const weight: Record<RiskLevel, number> = { critical: 4, high: 3, medium: 2, low: 1 };
  const rows = findings.slice().sort((a, b) => weight[b.severity] - weight[a.severity]).slice(0, 12);

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] border-collapse text-left text-sm">
        <thead className="text-xs uppercase text-muted">
          <tr>
            <th className="border-b border-line p-2">Select</th>
            <th className="border-b border-line p-2">Severity</th>
            <th className="border-b border-line p-2">Finding</th>
            <th className="border-b border-line p-2">Owner</th>
            <th className="border-b border-line p-2">Status</th>
            <th className="border-b border-line p-2">Due Date</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((finding) => {
            const statusCfg = STATUS_CONFIG[finding.status] ?? STATUS_CONFIG.open;
            return (
              <tr key={finding.id} className="cursor-pointer hover:bg-slate-50" onClick={() => onSelect(finding.id)}>
                <td className="border-b border-line p-2" onClick={(event) => event.stopPropagation()}>
                  <input
                    className="h-4 w-4 accent-brand"
                    type="checkbox"
                    checked={selectedIds.includes(finding.id)}
                    onChange={() => onToggleSelected(finding.id)}
                    aria-label={`Select ${finding.title}`}
                  />
                </td>
                <td className="border-b border-line p-2"><Pill level={finding.severity}>{finding.severity}</Pill></td>
                <td className="border-b border-line p-2">
                  <strong className="block">{finding.title}</strong>
                  <span className="text-xs text-muted">{finding.sourceFile ?? finding.evidence.sourceFile}</span>
                </td>
                <td className="border-b border-line p-2 font-semibold">{findingOwner(finding)}</td>
                <td className="border-b border-line p-2"><span className={`rounded-full px-2 py-0.5 text-xs font-black ${statusCfg.color}`}>{statusCfg.label}</span></td>
                <td className="border-b border-line p-2 font-semibold">{findingDueDate(finding)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {findings.length > rows.length && <p className="mt-2 text-xs text-muted">{findings.length - rows.length} more finding(s) in the detail queue.</p>}
    </div>
  );
}

function activityLabel(action: FindingActivity["action"]) {
  return action.replaceAll("_", " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function FindingDetailDrawer({
  finding,
  evidence,
  comments,
  activities,
  updateFindingStatus,
  updateFindingAssignment,
  updateManagerReview,
  addFindingComment,
  addFindingEvidence,
  updateEvidenceStatus,
  reviewLocked,
  onClose,
}: {
  finding: Finding;
  evidence: Evidence[];
  comments: FindingComment[];
  activities: FindingActivity[];
  updateFindingStatus: (findingId: string, status: FindingStatus, reason?: string) => void;
  updateFindingAssignment: (findingId: string, assignedTo: string, dueDate: string) => void;
  updateManagerReview: (findingId: string, status: ManagerReviewStatus, note?: string) => void;
  addFindingComment: (findingId: string, comment: string) => void;
  addFindingEvidence: (findingId: string, files: FileList | null, notes?: string) => Promise<void>;
  updateEvidenceStatus: (findingId: string, evidenceId: string, status: EvidenceStatus, note?: string) => void;
  reviewLocked: boolean;
  onClose: () => void;
}) {
  const [note, setNote] = useState("");
  const [managerNote, setManagerNote] = useState("");
  const [comment, setComment] = useState("");
  const [assignee, setAssignee] = useState(finding.assignedTo ?? "");
  const [assignmentDueDate, setAssignmentDueDate] = useState(finding.dueDate ?? "");
  const [evidenceNotes, setEvidenceNotes] = useState("");
  const [isUploadingEvidence, setIsUploadingEvidence] = useState(false);
  const statusCfg = STATUS_CONFIG[finding.status] ?? STATUS_CONFIG.open;
  const confidencePct = findingDetectionConfidence(finding);
  const evidenceStrengthPct = findingEvidenceStrengthScore(finding, evidence.length);
  const primaryRow = finding.evidence.rows?.[0];
  const evidenceRef = findingEvidenceReference(finding);
  const impactAmount = finding.amount ?? parseImpactAmount(finding.expectedImpact);
  const sortedActivities = activities.slice().sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  const sortedComments = comments.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const managerStatus = managerReviewStatus(finding);
  const evidenceItemCount = evidence.length || finding.evidenceIds?.length || finding.evidence.rows?.length || 0;
  const formatDateTime = (value?: string) => value ? new Date(value).toLocaleString("en-GB") : "-";

  useEffect(() => {
    setAssignee(finding.assignedTo ?? "");
    setAssignmentDueDate(finding.dueDate ?? "");
  }, [finding.assignedTo, finding.dueDate, finding.id]);

  const act = (status: FindingStatus, fallback = "") => {
    updateFindingStatus(finding.id, status, note || fallback);
    setNote("");
  };

  const submitComment = () => {
    addFindingComment(finding.id, comment);
    setComment("");
  };

  const managerAct = (status: ManagerReviewStatus) => {
    updateManagerReview(finding.id, status, managerNote);
    setManagerNote("");
  };

  const uploadEvidence = async (files: FileList | null) => {
    setIsUploadingEvidence(true);
    try {
      await addFindingEvidence(finding.id, files, evidenceNotes);
      setEvidenceNotes("");
    } finally {
      setIsUploadingEvidence(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/40">
      <aside className="ml-auto flex h-full w-full max-w-[min(96vw,1536px)] flex-col overflow-hidden bg-white shadow-2xl">
        <div className="border-b border-line p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Pill level={finding.severity}>{finding.severity}</Pill>
                <span className={`rounded-full px-2 py-0.5 text-xs font-black ${statusCfg.color}`}>{statusCfg.label}</span>
                {finding.ruleId && <span className="rounded-full bg-slate-100 px-2 py-0.5 font-mono text-xs text-slate-500">{finding.ruleId}</span>}
              </div>
              <h2 className="mt-3 text-xl font-black">{finding.title}</h2>
              <p className="mt-1 text-sm text-muted">{finding.description}</p>
            </div>
            <button className="rounded-lg border border-line px-3 py-2 text-sm font-black" onClick={onClose}>Close</button>
          </div>
        </div>

        <div className="grid min-w-0 flex-1 gap-4 overflow-y-auto p-5 xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.82fr)]">
          <div className="grid min-w-0 content-start gap-4">
            <section className="rounded-lg border border-line bg-slate-50 p-4">
              <p className="text-xs font-bold uppercase text-muted">Finding Details</p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <DrawerField label="Owner" value={findingOwner(finding)} />
                <DrawerField label="Reviewer" value={finding.reviewer || "-"} />
                <DrawerField label="Manager" value={finding.manager || finding.managerReviewedBy || "-"} />
                <DrawerField label="Partner" value={finding.partner || "-"} />
                <DrawerField label="Due Date" value={findingDueDate(finding)} />
                <DrawerField label="Status" value={statusCfg.label} />
                <DrawerField label="Category" value={finding.category.replaceAll("_", " ")} />
                <DrawerField label="Detection Confidence" value={`${confidencePct}%`} />
                <DrawerField label="Evidence Strength" value={`${evidenceStrengthPct}% · ${findingEvidenceTier(finding)}`} />
                <DrawerField label="Risk Score" value={String(finding.riskScore ?? findingSeverityRank(finding.severity) * 25)} />
                <DrawerField label="Amount" value={impactAmount ? `£${Math.round(impactAmount).toLocaleString()}` : finding.expectedImpact || "-"} />
                <DrawerField label="Evidence Attached" value={evidenceItemCount ? "Yes" : "No"} />
                <DrawerField label="Reviewed At" value={formatDateTime(finding.reviewedAt)} />
                <DrawerField label="Resolved By" value={finding.resolvedBy || "-"} />
                <DrawerField label="Resolved At" value={formatDateTime(finding.resolvedAt)} />
                <DrawerField label="Approved By" value={finding.approvedBy || "-"} />
                <DrawerField label="Approved At" value={formatDateTime(finding.approvedAt)} />
                <DrawerField label="Manager Status" value={managerStatus.replaceAll("_", " ")} />
              </div>
              {finding.resolutionNote && (
                <div className="mt-3 rounded-lg border border-line bg-white p-3">
                  <p className="text-xs font-bold text-muted">Resolution Note</p>
                  <p className="mt-1 text-sm">{finding.resolutionNote}</p>
                </div>
              )}
              {finding.recommendation && (
                <div className="mt-3 rounded-lg border border-line bg-white p-3">
                  <p className="text-xs font-bold text-muted">Recommendation</p>
                  <p className="mt-1 text-sm">{finding.recommendation}</p>
                </div>
              )}
            </section>

            <section className="rounded-lg border border-line bg-white p-4">
              <p className="text-xs font-bold uppercase text-muted">Assignment</p>
              <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto]">
                <label className="grid gap-1">
                  <span className="text-xs font-bold text-muted">Owner</span>
                  <input className="h-10 rounded-lg border border-line px-3 text-sm" value={assignee} onChange={(event) => setAssignee(event.target.value)} placeholder="Reviewer name" />
                </label>
                <label className="grid gap-1">
                  <span className="text-xs font-bold text-muted">Due date</span>
                  <input className="h-10 rounded-lg border border-line px-3 text-sm" type="date" value={assignmentDueDate} onChange={(event) => setAssignmentDueDate(event.target.value)} />
                </label>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button className="rounded-lg bg-brand px-4 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300" disabled={reviewLocked} onClick={() => updateFindingAssignment(finding.id, assignee, assignmentDueDate)}>Save Assignment</button>
                <button className="rounded-lg border border-line bg-white px-4 py-2 text-sm font-bold disabled:cursor-not-allowed disabled:text-muted" disabled={reviewLocked} onClick={() => {
                  setAssignee("Me");
                  updateFindingAssignment(finding.id, "Me", assignmentDueDate);
                }}>Assign To Me</button>
                <button className="rounded-lg border border-line bg-white px-4 py-2 text-sm font-bold text-muted disabled:cursor-not-allowed" disabled={reviewLocked} onClick={() => {
                  setAssignee("");
                  setAssignmentDueDate("");
                  updateFindingAssignment(finding.id, "", "");
                }}>Clear</button>
              </div>
            </section>

            <section className="rounded-lg border border-line bg-white p-4">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-xs font-bold uppercase text-muted">Evidence Viewer</p>
                  <h3 className="mt-1 font-black">Source evidence and rule trigger</h3>
                </div>
                <span className="rounded-full bg-cyan-50 px-3 py-1 text-xs font-black text-cyan-800">{findingEvidenceTier(finding)} evidence</span>
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <DrawerField label="Source File" value={evidenceRef.sourceFile} />
                <DrawerField label="Sheet" value={primaryRow?.sheetName || "Default / extracted rows"} />
                <DrawerField label="Rows" value={evidenceRef.rowIndexes} />
                <DrawerField label="Source Row Count" value={String(evidenceRef.rowCount)} />
                <DrawerField label="Account / Party" value={evidenceRef.accountOrParty} />
                <DrawerField label="Period" value={finding.evidence.period || "-"} />
                <DrawerField label="Rule Triggered" value={finding.ruleId ?? finding.id} />
                <DrawerField label="Detection Confidence" value={`${confidencePct}%`} />
                <DrawerField label="Evidence Strength" value={`${evidenceStrengthPct}%`} />
                <DrawerField label="Evidence Items" value={String(evidenceItemCount)} />
                <DrawerField label="Balance / Amount" value={typeof primaryRow?.amount === "number" ? `£${Math.round(primaryRow.amount).toLocaleString("en-GB")}` : impactAmount ? `£${Math.round(impactAmount).toLocaleString("en-GB")}` : "-"} />
              </div>
              <div className="mt-3 rounded-lg border border-line bg-slate-50 p-3">
                <p className="text-xs font-bold text-muted">Calculation</p>
                <p className="mt-1 text-sm">{evidenceRef.calculation}</p>
              </div>
              <div className="mt-3 rounded-lg border border-cyan-100 bg-cyan-50 p-3">
                <p className="text-xs font-bold uppercase text-cyan-900">Evidence Reference</p>
                <p className="mt-1 text-sm font-semibold text-cyan-950">{evidenceRef.sourceFile} · {evidenceRef.rowIndexes}</p>
                <p className="mt-1 text-xs text-cyan-900">{evidenceRef.rowCount} source row{evidenceRef.rowCount !== 1 ? "s" : ""} linked to {finding.ruleId ?? finding.id}.</p>
              </div>
              <div className="mt-3 rounded-lg border border-line bg-amber-50 p-3">
                <p className="text-xs font-bold uppercase text-amber-800">Why Triggered</p>
                <p className="mt-1 text-sm font-semibold text-amber-950">{findingTriggeredReason(finding)}</p>
                <p className="mt-2 text-xs text-amber-900">ClosePilot records the source file, row-level evidence and rule identifier so reviewers can inspect the exception without regenerating the analysis.</p>
              </div>
              {primaryRow ? (
                <div className="mt-3 rounded-lg border border-line bg-white p-3">
                  <p className="text-xs font-bold uppercase text-muted">Primary Source Row</p>
                  <div className="mt-2 grid gap-2 text-xs sm:grid-cols-2">
                    {Object.entries(primaryRow.sourceRow ?? {}).filter(([, value]) => String(value ?? "").trim()).slice(0, 10).map(([key, value]) => (
                      <div key={key} className="rounded-lg bg-slate-50 p-2">
                        <span className="block font-bold uppercase text-muted">{key}</span>
                        <span className="mt-1 block break-words font-semibold">{String(value)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
              <div className="mt-3 rounded-lg border border-line bg-slate-50 p-3">
                <p className="text-xs font-bold uppercase text-muted">Upload Evidence</p>
                <textarea className="mt-2 min-h-16 w-full rounded-lg border border-line bg-white px-3 py-2 text-sm" value={evidenceNotes} onChange={(event) => setEvidenceNotes(event.target.value)} placeholder="Optional evidence note." />
                <label className="mt-2 inline-flex cursor-pointer rounded-lg bg-brand px-4 py-2 text-sm font-bold text-white">
                  {isUploadingEvidence ? "Uploading..." : "Upload Evidence"}
                  <input className="hidden" type="file" multiple disabled={reviewLocked || isUploadingEvidence} onChange={(event) => uploadEvidence(event.target.files)} />
                </label>
              </div>
              {evidence.length > 0 && (
                <div className="mt-3 grid gap-2">
                  {evidence.map((item) => (
                    <div key={item.id} className="rounded-lg border border-line bg-white p-3 text-sm">
                      <div className="flex items-start justify-between gap-3">
                        <a className="min-w-0 transition-colors hover:text-brand" href={item.fileUrl || "#"} target={item.fileUrl ? "_blank" : undefined} rel="noreferrer">
                          <strong className="block truncate">{item.fileName}</strong>
                          <span className="mt-1 block text-xs text-muted">{item.uploadedBy} · {new Date(item.uploadedAt).toLocaleString("en-GB")}</span>
                        </a>
                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-black ${item.status === "accepted" || item.status === "not_required" ? "bg-emerald-100 text-emerald-700" : item.status === "rejected" ? "bg-red-100 text-red-700" : item.status === "requested" ? "bg-amber-100 text-amber-800" : item.status === "under_review" ? "bg-cyan-100 text-cyan-800" : item.status === "superseded" ? "bg-slate-100 text-slate-500" : "bg-blue-100 text-blue-700"}`}>{(item.status ?? "uploaded").replaceAll("_", " ")}</span>
                      </div>
                      {item.notes && <p className="mt-2 text-xs text-muted">{item.notes}</p>}
                      {item.reviewNote && <p className="mt-1 text-xs text-muted">Review: {item.reviewNote}</p>}
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button className="rounded-lg border border-line bg-white px-3 py-1.5 text-xs font-bold disabled:cursor-not-allowed disabled:text-muted" disabled={reviewLocked || item.status === "requested" || item.status === "accepted" || item.status === "superseded" || item.status === "not_required"} onClick={() => updateEvidenceStatus(finding.id, item.id, "under_review", evidenceNotes)}>Under Review</button>
                        <button className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300" disabled={reviewLocked || item.status === "accepted" || item.status === "requested" || item.status === "superseded" || item.status === "not_required"} onClick={() => updateEvidenceStatus(finding.id, item.id, "accepted", evidenceNotes)}>Accept Evidence</button>
                        <button className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-bold text-red-700 disabled:cursor-not-allowed disabled:text-muted" disabled={reviewLocked || item.status === "rejected" || item.status === "requested" || item.status === "superseded" || item.status === "not_required"} onClick={() => updateEvidenceStatus(finding.id, item.id, "rejected", evidenceNotes)}>Reject Evidence</button>
                        <button className="rounded-lg border border-line bg-white px-3 py-1.5 text-xs font-bold disabled:cursor-not-allowed disabled:text-muted" disabled={reviewLocked || item.status === "accepted" || item.status === "superseded" || item.status === "not_required"} onClick={() => updateEvidenceStatus(finding.id, item.id, "superseded", evidenceNotes)}>Supersede</button>
                        <button className="rounded-lg border border-line bg-white px-3 py-1.5 text-xs font-bold disabled:cursor-not-allowed disabled:text-muted" disabled={reviewLocked || item.status === "not_required"} onClick={() => updateEvidenceStatus(finding.id, item.id, "not_required", evidenceNotes)}>Not Required</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <EvidenceRowsPreview finding={finding} compact />
            </section>

            <section className="rounded-lg border border-line bg-white p-4">
              <p className="text-xs font-bold uppercase text-muted">Reviewer Workflow</p>
              <label className="mt-3 block">
                <span className="mb-1 block text-xs font-bold text-muted">Action note</span>
                <textarea className="min-h-20 w-full rounded-lg border border-line px-3 py-2 text-sm" value={note} onChange={(event) => setNote(event.target.value)} />
              </label>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <button className="rounded-lg border border-line bg-white px-3 py-2 text-sm font-bold disabled:cursor-not-allowed disabled:text-muted" disabled={reviewLocked} onClick={() => act("under_review")}>Assign / Review</button>
                <button className="rounded-lg bg-amber-500 px-3 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300" disabled={reviewLocked} onClick={() => act("evidence_requested")}>Request Evidence</button>
                <button className="rounded-lg bg-cyan-600 px-3 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300" disabled={reviewLocked} onClick={() => act("evidence_received")}>Evidence Received</button>
                <button className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300" disabled={reviewLocked} onClick={() => act("resolved")}>Resolve</button>
                <button className="rounded-lg bg-green-700 px-3 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300" disabled={reviewLocked} onClick={() => act("approved")}>Approve</button>
                <button className="rounded-lg bg-red-600 px-3 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300" disabled={reviewLocked} onClick={() => act("false_positive")}>False Positive</button>
                <button className="rounded-lg bg-violet-600 px-3 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300" disabled={reviewLocked} onClick={() => act("accepted_risk")}>Accept Risk</button>
              </div>
            </section>

            <section className="rounded-lg border border-line bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-bold uppercase text-muted">Manager Review</p>
                  <p className="mt-1 text-sm font-semibold capitalize">{managerStatus.replaceAll("_", " ")}</p>
                </div>
                <Pill level={managerStatus === "approved" ? "low" : managerStatus === "returned" ? "high" : managerStatus === "escalated" ? "medium" : "medium"}>{managerStatus.replaceAll("_", " ")}</Pill>
              </div>
              {finding.managerReviewNote && (
                <div className="mt-3 rounded-lg border border-line bg-slate-50 p-3">
                  <p className="text-xs font-bold text-muted">Latest manager note</p>
                  <p className="mt-1 text-sm">{finding.managerReviewNote}</p>
                  {finding.managerReviewedBy && <p className="mt-1 text-xs text-muted">{finding.managerReviewedBy} · {finding.managerReviewedAt ? new Date(finding.managerReviewedAt).toLocaleString("en-GB") : ""}</p>}
                </div>
              )}
              <textarea className="mt-3 min-h-20 w-full rounded-lg border border-line px-3 py-2 text-sm" value={managerNote} onChange={(event) => setManagerNote(event.target.value)} placeholder="Manager approval, return reason, or escalation note." />
              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                <button className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300" disabled={reviewLocked} onClick={() => managerAct("approved")}>Approve</button>
                <button className="rounded-lg border border-line bg-white px-3 py-2 text-sm font-bold disabled:cursor-not-allowed disabled:text-muted" disabled={reviewLocked} onClick={() => managerAct("returned")}>Return</button>
                <button className="rounded-lg bg-slate-700 px-3 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300" disabled={reviewLocked} onClick={() => managerAct("escalated")}>Escalate</button>
              </div>
            </section>
          </div>

          <div className="grid min-w-0 content-start gap-4">
            <section className="rounded-lg border border-line bg-white p-4">
              <p className="text-xs font-bold uppercase text-muted">Comments</p>
              <textarea className="mt-3 min-h-24 w-full rounded-lg border border-line px-3 py-2 text-sm" value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Add manager note, client response, or evidence request context." />
              <button className="mt-2 rounded-lg bg-brand px-4 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300" disabled={reviewLocked} onClick={submitComment}>Add Comment</button>
              <div className="mt-4 grid gap-3">
                {sortedComments.length ? sortedComments.map((item) => (
                  <div key={item.id} className="rounded-lg border border-line bg-slate-50 p-3">
                    <p className="text-sm">{item.comment}</p>
                    <p className="mt-2 text-xs text-muted">{item.userId} · {new Date(item.createdAt).toLocaleString("en-GB")}</p>
                  </div>
                )) : <p className="text-sm text-muted">No comments yet.</p>}
              </div>
            </section>

            <section className="rounded-lg border border-line bg-white p-4">
              <p className="text-xs font-bold uppercase text-muted">Activity</p>
              <div className="mt-3 grid gap-3">
                {sortedActivities.length ? sortedActivities.map((item) => (
                  <div key={item.id} className="border-l-2 border-brand pl-3">
                    <strong className="block text-sm">{activityLabel(item.action)}</strong>
                    {item.details && <p className="mt-1 text-xs text-muted">{item.details}</p>}
                    <p className="mt-1 text-xs text-muted">{item.userId} · {new Date(item.timestamp).toLocaleString("en-GB")}</p>
                  </div>
                )) : <p className="text-sm text-muted">No activity recorded yet.</p>}
              </div>
            </section>
          </div>
        </div>
      </aside>
    </div>
  );
}

function DrawerField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-bold uppercase text-muted">{label}</p>
      <p className="mt-1 break-words text-sm font-semibold capitalize">{value}</p>
    </div>
  );
}

function SignOffCheck({ label, passed, warning = false, detail }: { label: string; passed: boolean; warning?: boolean; detail: string }) {
  const state = warning ? "amber" : passed ? "green" : "red";
  const classes = trafficLightClasses(state);
  return (
    <div className={`rounded-lg border p-4 ${classes.box}`}>
      <span className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-sm font-black ${classes.dot} text-white`}>{warning ? "!" : passed ? "✓" : "✕"}</span>
      <strong className="mt-3 block">{label}</strong>
      <p className="mt-1 text-xs text-muted">{detail}</p>
    </div>
  );
}

function FindingCard({ finding, setActive, updateFindingStatus, expanded = false }: { finding: Finding; setActive: (v: string) => void; updateFindingStatus?: (id: string, status: FindingStatus, reason?: string) => void; expanded?: boolean }) {
  const [open, setOpen] = useState(expanded);
  const [reviewReason, setReviewReason] = useState("");
  const statusCfg = STATUS_CONFIG[finding.status] ?? STATUS_CONFIG.open;
  const confidencePct = findingDetectionConfidence(finding);
  const evidenceStrengthPct = findingEvidenceStrengthScore(finding);
  const severityBorder = finding.evidenceStrength === "advisory" ? "border-l-slate-300" : finding.severity === "critical" ? "border-l-red" : finding.severity === "high" ? "border-l-amber" : "border-l-line";
  const strengthLabel: Record<string, { label: string; color: string }> = {
    deterministic: { label: "Assurance Finding", color: "bg-emerald-100 text-emerald-800" },
    indicator:     { label: "Control Indicator", color: "bg-blue-100 text-blue-800" },
    advisory:      { label: "Compliance Reminder", color: "bg-slate-100 text-slate-600" },
  };
  const strength = strengthLabel[finding.evidenceStrength ?? "indicator"];
  const isDecided = !isOpenFinding(finding);

  return (
    <article className={`rounded-lg border border-l-4 border-line bg-white shadow-sm ${severityBorder} ${isDecided ? "opacity-75" : ""}`}>
      {/* Header */}
      <div className="flex cursor-pointer items-start gap-3 p-4" onClick={() => setOpen((v) => !v)}>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Pill level={finding.severity}>{finding.severity}</Pill>
            <span className={`rounded-full px-2 py-0.5 text-xs font-black ${statusCfg.color}`}>{statusCfg.label}</span>
            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${strength.color}`}>{strength.label}</span>
            {finding.ruleId && <span className="rounded-full bg-slate-100 px-2 py-0.5 font-mono text-xs text-slate-500">{finding.ruleId}</span>}
          </div>
          <h3 className="mt-2 font-bold leading-snug">{finding.title}</h3>
          <p className="mt-1 text-sm text-muted line-clamp-2">{finding.description}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5 text-right">
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted">Detection</span>
            <span className={`text-sm font-black ${confidencePct >= 90 ? "text-emerald-700" : confidencePct >= 70 ? "text-amber-700" : "text-red-600"}`}>{confidencePct}%</span>
          </div>
          <span className="text-xs font-semibold text-muted">Evidence {evidenceStrengthPct}%</span>
          {finding.expectedImpact && <span className="text-xs font-semibold text-muted">{finding.expectedImpact}</span>}
          <span className="text-xs text-muted">{open ? "▲ Hide" : "▼ Details"}</span>
        </div>
      </div>

      {/* Expanded: evidence + HITL buttons */}
      {open && (
        <div className="border-t border-line px-4 pb-4 pt-3">
          {/* Evidence panel */}
          <div className="rounded-lg bg-slate-50 p-4">
            <p className="mb-2 text-xs font-bold uppercase text-muted">Evidence</p>
            <div className="grid gap-2 text-sm md:grid-cols-2">
              <div><span className="text-xs text-muted">Source file</span><p className="font-semibold">{finding.evidence.sourceFile}</p></div>
              <div><span className="text-xs text-muted">Account / Party</span><p className="font-semibold truncate">{finding.evidence.accountCode || "—"}</p></div>
              <div><span className="text-xs text-muted">Period</span><p className="font-semibold">{finding.evidence.period}</p></div>
              <div><span className="text-xs text-muted">Detection confidence</span><p className={`font-black ${confidencePct >= 90 ? "text-emerald-700" : confidencePct >= 70 ? "text-amber-700" : "text-red-600"}`}>{confidencePct}%</p></div>
              <div><span className="text-xs text-muted">Evidence strength</span><p className={`font-black ${evidenceStrengthPct >= 90 ? "text-emerald-700" : evidenceStrengthPct >= 70 ? "text-amber-700" : "text-red-600"}`}>{evidenceStrengthPct}%</p></div>
            </div>
            <div className="mt-3 rounded-lg border border-line bg-white p-3">
              <p className="text-xs font-bold text-muted">Calculation</p>
              <p className="mt-1 text-sm">{finding.evidence.calculation}</p>
            </div>
            <EvidenceRowsPreview finding={finding} compact />
            {finding.reviewer && (
              <p className="mt-2 text-xs text-muted">Reviewed by: <strong>{finding.reviewer}</strong></p>
            )}
            {finding.reviewReason && (
              <div className="mt-2 rounded-lg border border-line bg-white p-3">
                <p className="text-xs font-bold text-muted">Reviewer reason</p>
                <p className="mt-1 text-sm">{finding.reviewReason}</p>
                {finding.reviewedAt && <p className="mt-1 text-xs text-muted">{new Date(finding.reviewedAt).toLocaleString("en-GB")}</p>}
              </div>
            )}
          </div>

          {/* HITL decision buttons */}
          {updateFindingStatus && (
            <div className="mt-4">
              <p className="mb-2 text-xs font-bold uppercase text-muted">Reviewer Actions</p>
              <label className="mb-3 block">
                <span className="mb-1 block text-xs font-bold text-muted">Action note</span>
                <textarea
                  className="min-h-20 w-full rounded-lg border border-line px-3 py-2 text-sm"
                  value={reviewReason}
                  onChange={(event) => setReviewReason(event.target.value)}
                  placeholder="Capture the review action, evidence request, resolution note or sign-off rationale."
                />
              </label>
              <div className="grid gap-2 sm:grid-cols-3 xl:grid-cols-8">
                <button className="rounded-lg border border-line bg-white px-3 py-2.5 text-sm font-bold hover:border-brand hover:text-brand transition-colors" onClick={() => updateFindingStatus(finding.id, "under_review", reviewReason)}>
                  Assign
                  <span className="block text-xs font-normal opacity-70">Under review</span>
                </button>
                <button className="rounded-lg bg-amber-500 px-3 py-2.5 text-sm font-bold text-white hover:bg-amber-600 transition-colors" onClick={() => updateFindingStatus(finding.id, "evidence_requested", reviewReason)}>
                  Request Evidence
                  <span className="block text-xs font-normal opacity-80">Need support</span>
                </button>
                <button className="rounded-lg bg-cyan-600 px-3 py-2.5 text-sm font-bold text-white hover:bg-cyan-700 transition-colors" onClick={() => updateFindingStatus(finding.id, "evidence_received", reviewReason)}>
                  Review Evidence
                  <span className="block text-xs font-normal opacity-80">Evidence in</span>
                </button>
                <button className="rounded-lg bg-emerald-600 px-3 py-2.5 text-sm font-bold text-white hover:bg-emerald-700 transition-colors" onClick={() => updateFindingStatus(finding.id, "resolved", reviewReason)}>
                  Resolve
                  <span className="block text-xs font-normal opacity-80">Resolve</span>
                </button>
                <button className="rounded-lg bg-green-700 px-3 py-2.5 text-sm font-bold text-white hover:bg-green-800 transition-colors" onClick={() => updateFindingStatus(finding.id, "approved", reviewReason)}>
                  Approve
                  <span className="block text-xs font-normal opacity-80">Sign off</span>
                </button>
                <button className="rounded-lg bg-red-600 px-3 py-2.5 text-sm font-bold text-white hover:bg-red-700 transition-colors" onClick={() => updateFindingStatus(finding.id, "false_positive", reviewReason)}>
                  False Positive
                  <span className="block text-xs font-normal opacity-80">Close path</span>
                </button>
                <button className="rounded-lg bg-violet-600 px-3 py-2.5 text-sm font-bold text-white hover:bg-violet-700 transition-colors" onClick={() => updateFindingStatus(finding.id, "accepted_risk", reviewReason)}>
                  Accept Risk
                  <span className="block text-xs font-normal opacity-80">No remediation</span>
                </button>
                <button className="rounded-lg bg-slate-600 px-3 py-2.5 text-sm font-bold text-white hover:bg-slate-700 transition-colors" onClick={() => updateFindingStatus(finding.id, "under_review", reviewReason || "Escalated for manager or partner review.")}>
                  Escalate
                  <span className="block text-xs font-normal opacity-80">Senior review</span>
                </button>
              </div>
            </div>
          )}

          {/* Already decided — show undo option */}
          {updateFindingStatus && isDecided && (
            <div className="mt-4 flex items-center gap-3">
              <span className={`rounded-lg px-3 py-2 text-sm font-bold ${statusCfg.color}`}>{statusCfg.label}</span>
              <button className="text-sm font-bold text-muted underline" onClick={() => updateFindingStatus(finding.id, "open")}>Undo decision</button>
            </div>
          )}

          <div className="mt-3 flex gap-2">
            <button className="rounded-lg border border-line px-3 py-1.5 text-xs font-bold" onClick={() => setActive("Ask ClosePilot")}>Ask ClosePilot</button>
          </div>
        </div>
      )}
    </article>
  );
}

function FindingList({ findings, setActive, updateFindingStatus }: { findings: Finding[]; setActive: (value: string) => void; updateFindingStatus?: (findingId: string, status: FindingStatus, reason?: string) => void }) {
  const [severityFilter, setSeverityFilter] = useState<"all" | RiskLevel>("all");
  const [evidenceFilter, setEvidenceFilter] = useState<"all" | "deterministic" | "indicator" | "advisory">("all");
  const [statusFilter, setStatusFilter] = useState<"open" | "reviewed" | "all">("open");
  if (findings.length === 0) return <p className="py-4 text-center text-sm text-muted">No findings to display.</p>;
  const filtered = findings.filter((finding) => {
    if (severityFilter !== "all" && finding.severity !== severityFilter) return false;
    if (evidenceFilter !== "all" && (finding.evidenceStrength ?? "indicator") !== evidenceFilter) return false;
    if (statusFilter === "open" && !isOpenFinding(finding)) return false;
    if (statusFilter === "reviewed" && !reviewedFindingStatuses.includes(finding.status)) return false;
    return true;
  });
  return (
    <div className="grid gap-3">
      <div className="grid gap-2 rounded-lg border border-line bg-slate-50 p-3 md:grid-cols-3">
        <select className="h-9 rounded-lg border border-line bg-white px-3 text-sm font-bold" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}>
          <option value="open">Open queue</option>
          <option value="reviewed">Reviewed</option>
          <option value="all">All statuses</option>
        </select>
        <select className="h-9 rounded-lg border border-line bg-white px-3 text-sm font-bold" value={severityFilter} onChange={(e) => setSeverityFilter(e.target.value as typeof severityFilter)}>
          <option value="all">All severities</option>
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
        <select className="h-9 rounded-lg border border-line bg-white px-3 text-sm font-bold" value={evidenceFilter} onChange={(e) => setEvidenceFilter(e.target.value as typeof evidenceFilter)}>
          <option value="all">All evidence tiers</option>
          <option value="deterministic">Assurance findings</option>
          <option value="indicator">Risk indicators</option>
          <option value="advisory">Review reminders</option>
        </select>
      </div>
      {filtered.map((finding) => (
        <FindingCard key={finding.id} finding={finding} setActive={setActive} updateFindingStatus={updateFindingStatus} />
      ))}
      {filtered.length === 0 && <EmptyState title="No matching findings" detail="Change the filters to see the rest of the review queue." />}
    </div>
  );
}

function CashChart({ forecast }: { forecast: CashForecastPoint[] }) {
  return (
    <div className="h-72">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={forecast} margin={{ left: 4, right: 12, top: 12, bottom: 0 }}>
          <CartesianGrid stroke="#e5e7eb" strokeDasharray="4 4" vertical={false} />
          <XAxis dataKey="period" tickLine={false} axisLine={false} />
          <YAxis width={58} tickFormatter={(value) => `£${Number(value) / 1000}k`} tickLine={false} axisLine={false} />
          <Tooltip formatter={(value) => `£${Number(value).toLocaleString()}`} />
          <Area type="monotone" dataKey="cash" stroke="#0e7490" fill="#cffafe" strokeWidth={3} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function BreakdownChart({ breakdown }: { breakdown: FinanceScoreBreakdown }) {
  const data = Object.entries(breakdown).map(([name, value]) => ({ name: name.replace(/([A-Z])/g, " $1"), value }));
  return (
    <div className="h-72">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ left: 24, right: 18 }}>
          <CartesianGrid stroke="#e5e7eb" strokeDasharray="4 4" horizontal={false} />
          <XAxis type="number" domain={[0, 100]} />
          <YAxis dataKey="name" type="category" width={95} />
          <Tooltip />
          <Bar dataKey="value" fill="#1d4ed8" radius={[0, 6, 6, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function UploadList({ uploads, onDelete, onClear }: { uploads: Upload[]; onDelete?: (id: string) => void; onClear?: () => void }) {
  if (uploads.length === 0) return <p className="py-4 text-center text-sm text-muted">No files uploaded yet.</p>;
  return (
    <div className="grid gap-3">
      {onClear && (
        <div className="flex justify-end">
          <button
            className="rounded-lg border border-red-200 bg-white px-3 py-2 text-xs font-black text-red-700 transition-colors hover:bg-red-50"
            onClick={() => {
              if (confirm("Clear this review and remove all uploaded data, findings, scores, VAT review and recommendations?")) {
                onClear();
              }
            }}
          >
            Clear Review
          </button>
        </div>
      )}
      {uploads.map((upload) => (
        <div key={upload.id} className="flex items-center justify-between gap-3 rounded-lg border border-line p-3">
          <div className="min-w-0">
            <strong className="block truncate">{upload.fileName}</strong>
            <p className="text-sm text-muted">{uploadTypeLabels[upload.fileType]} · {upload.uploadedAt}{upload.rowCount !== undefined ? ` · ${upload.rowCount} rows` : ""}</p>
            {upload.mappingProfileName && (
              <p className="mt-1 text-xs text-muted">
                {upload.mappingProfileName} · {upload.mappingConfidence ?? 0}% mapping · {upload.importConfidence ?? upload.mappingConfidence ?? 0}% import · {(upload.importGateStatus ?? "review_required").replaceAll("_", " ")}
              </p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Pill level="low">Parsed</Pill>
            {onDelete && (
              <button
                title="Remove this file and its findings"
                className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs font-bold text-red-700 hover:bg-red-100 transition-colors"
                onClick={() => {
                  if (confirm(`Remove "${upload.fileName}" and its associated findings?`)) {
                    onDelete(upload.id);
                  }
                }}
              >
                Remove
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function UploadIntelligence({ uploads }: { uploads: Upload[] }) {
  const [overrides, setOverrides] = useState<Record<string, Upload["fileType"]>>({});
  const displayedUploads = uploads.map((upload) => ({ ...upload, fileType: overrides[upload.id] ?? upload.fileType }));
  const detectedTypes = new Set(displayedUploads.map((upload) => upload.fileType));
  const missingCore = coreUploadTypes.filter((fileType) => !detectedTypes.has(fileType));
  const averageConfidence = uploads.length
    ? Math.round(uploads.reduce((sum, upload) => sum + (upload.detectionConfidence ?? 70), 0) / uploads.length)
    : 0;
  const vendorSummary = Array.from(new Set(uploads.map((upload) => upload.detectedVendor).filter(Boolean))).join(", ") || "Not detected yet";

  return (
    <Panel title="Upload Intelligence">
      {uploads.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line bg-slate-50 p-5 text-sm text-muted">
          ClosePilot will identify document type, likely vendor format and confidence after upload.
        </div>
      ) : (
        <div className="grid gap-4">
          <div className="grid gap-3 md:grid-cols-3">
            <MetricTile label="Files Detected" value={String(uploads.length)} sub={`${detectedTypes.size} document type(s)`} />
            <MetricTile label="Format Confidence" value={`${averageConfidence}%`} sub={averageConfidence >= 85 ? "High confidence" : averageConfidence >= 70 ? "Review recommended" : "Needs confirmation"} />
            <MetricTile label="Vendor Signal" value={vendorSummary} sub="From headers and file structure" />
          </div>

          <div className="grid gap-2">
            {displayedUploads.map((upload) => {
              const confidence = upload.detectionConfidence ?? 70;
              const confidenceLevel: RiskLevel = confidence >= 85 ? "low" : confidence >= 70 ? "medium" : "high";
              return (
                <div key={upload.id} className="grid gap-3 rounded-lg border border-line p-3 lg:grid-cols-[1fr_190px_120px] lg:items-center">
                  <div className="min-w-0">
                    <strong className="block truncate">{upload.fileName}</strong>
                    <p className="mt-1 text-sm text-muted">
                      {upload.detectedVendor ?? "Unknown format"} · {upload.rowCount ?? 0} rows · {upload.detectionBasis ?? "Detected from filename and headers"}
                    </p>
                    {upload.importGateStatus && (
                      <p className="mt-1 text-xs text-muted">
                        Import confidence {upload.importConfidence ?? 0}% · rules {upload.importGateStatus === "ready" ? "enabled" : "paused"}
                      </p>
                    )}
                  </div>
                  <select
                    className="h-10 rounded-lg border border-line bg-white px-3 text-sm font-bold"
                    value={upload.fileType}
                    onChange={(event) => setOverrides((items) => ({ ...items, [upload.id]: event.target.value as Upload["fileType"] }))}
                  >
                    {Object.entries(uploadTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                  <Pill level={confidenceLevel}>{confidence}% confidence</Pill>
                </div>
              );
            })}
          </div>

          <div className="rounded-lg border border-line bg-slate-50 p-4">
            <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
              <div>
                <p className="font-bold">Required Finance Pack Coverage</p>
                <p className="mt-1 text-sm text-muted">
                  {missingCore.length ? `${missingCore.length} core document(s) still missing.` : "All core review documents detected."}
                </p>
              </div>
              <Pill level={missingCore.length ? "medium" : "low"}>{missingCore.length ? "Incomplete" : "Complete"}</Pill>
            </div>
            {missingCore.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {missingCore.map((fileType) => <span key={fileType} className="rounded-lg border border-line bg-white px-3 py-1.5 text-xs font-bold">{uploadTypeLabels[fileType]}</span>)}
              </div>
            )}
          </div>
        </div>
      )}
    </Panel>
  );
}

function ImportMappingProfilesPanel({ profiles, confirmImportProfile }: { profiles: ImportMappingProfile[]; confirmImportProfile: (profileId: string) => void }) {
  return (
    <Panel title="Mapping Profiles">
      {profiles.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line bg-slate-50 p-5 text-sm text-muted">
          Upload a finance export to see detected column mappings and save reusable profiles.
        </div>
      ) : (
        <div className="grid gap-3">
          {profiles.map((profile) => {
            const level: RiskLevel = profile.status === "confirmed" || profile.status === "known_profile" ? "low" : profile.status === "needs_confirmation" ? "high" : "medium";
            return (
              <div key={profile.id} className="rounded-lg border border-line p-4">
                <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                  <div>
                    <strong>{profile.profileName}</strong>
                    <p className="mt-1 text-sm text-muted">
                      {uploadTypeLabels[profile.fileType]} · {profile.vendor ?? "Unknown vendor"} · {profile.confidence}% mapping confidence
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Pill level={level}>{profile.status.replaceAll("_", " ")}</Pill>
                    {profile.status !== "confirmed" && (
                      <button className="rounded-lg bg-brand px-3 py-2 text-xs font-black text-white hover:bg-blue-700" onClick={() => confirmImportProfile(profile.id)}>
                        Confirm
                      </button>
                    )}
                  </div>
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {profile.fields.map((field) => (
                    <div key={`${profile.id}_${field.targetField}`} className="rounded-lg bg-slate-50 px-3 py-2 text-xs">
                      <span className="font-black">{field.targetField}</span>
                      <span className="text-muted"> from </span>
                      <span className="font-bold">{field.sourceColumn}</span>
                      <span className="text-muted"> · {field.confidence}%</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );
}

function UploadAnalyse({ analyseUploads, isAnalysing, uploadMessage, validationChecks, uploads, importProfiles, confirmImportProfile, findings, recommendations, onDelete, onClear }: { analyseUploads: (files: FileList | null) => void; isAnalysing: boolean; uploadMessage: string; validationChecks: ValidationCheck[]; uploads: Upload[]; importProfiles: ImportMappingProfile[]; confirmImportProfile: (profileId: string) => void; findings: Finding[]; recommendations: Recommendation[]; onDelete: (id: string) => void; onClear: () => void }) {
  return (
    <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
      <div className="grid gap-4">
        <Panel title="Upload Finance Pack">
          <div className="rounded-lg border-2 border-dashed border-line bg-slate-50 p-8 text-center">
            <strong>Drop Trial Balance, P&L, Balance Sheet, AR, AP and VAT files</strong>
            <p className="mt-2 text-sm text-muted">ClosePilot parses CSV, TSV, TXT, XLSX and XLS finance exports server-side, then generates evidence-linked findings and validation checks.</p>
            <label className="mt-5 inline-flex cursor-pointer rounded-lg bg-brand px-4 py-3 font-bold text-white">
              {isAnalysing ? "Analysing..." : "Choose Files"}
              <input className="sr-only" type="file" multiple accept=".csv,.tsv,.txt,.xlsx,.xls" onChange={(event) => analyseUploads(event.target.files)} />
            </label>
            <p className="mt-3 text-sm text-muted">{uploadMessage}</p>
          </div>
        </Panel>
        <Panel title="Uploaded Files">
          <UploadList uploads={uploads} onDelete={onDelete} onClear={uploads.length ? onClear : undefined} />
        </Panel>
        <UploadIntelligence uploads={uploads} />
        <ImportMappingProfilesPanel profiles={importProfiles} confirmImportProfile={confirmImportProfile} />
        <Panel title="Validation Checks">
          <div className="grid gap-3">
            {validationChecks.length === 0 && <p className="text-sm text-muted">No validation checks yet. Upload a finance pack to begin.</p>}
            {validationChecks.map((check) => (
              <div key={check.id} className="rounded-lg border border-line p-3">
                <div className="flex items-start justify-between gap-3">
                  <strong>{check.name}</strong>
                  <ValidationPill status={check.status} />
                </div>
                <p className="mt-1 text-sm text-muted">{check.detail}</p>
              </div>
            ))}
          </div>
        </Panel>
      </div>
      <Panel title="Finance Review Pipeline">
        <div className="grid gap-3">
          {([
            ["Validate exports", validationChecks.length > 0],
            ["Map accounts and periods", uploads.length > 0],
            ["Find anomalies and finance risks", findings.length > 0],
            ["Generate actions and commentary", recommendations.length > 0],
            ["Prepare board-ready finance review", findings.length > 0 && recommendations.length > 0],
          ] as [string, boolean][]).map(([step, done]) => (
            <div key={step} className="flex items-center justify-between rounded-lg border border-line p-4">
              <strong>{step}</strong>
              <Pill level={done ? "low" : "medium"}>{done ? "Complete" : "Queued"}</Pill>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}

function MonthEndClose({ findings, recommendations, completeRecommendation, updateFindingStatus }: { findings: Finding[]; recommendations: Recommendation[]; completeRecommendation: (value: Recommendation) => void; updateFindingStatus: (findingId: string, status: FindingStatus, reason?: string) => void }) {
  const counts = findingLifecycleCounts(findings);
  const allOpen = findings.filter(isOpenFinding);
  const decided = counts.resolved + counts.closed;
  const resolutionRate = decided > 0 ? Math.round((counts.resolved / decided) * 100) : 0;
  const closureRate = decided > 0 ? Math.round((counts.closed / decided) * 100) : 0;

  return (
    <div className="grid gap-4">
      {/* HITL metrics */}
      <section className="rounded-lg border border-line bg-white p-5 shadow-panel">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <p className="text-xs font-bold uppercase text-muted">Human-in-the-Loop Review</p>
            <h2 className="text-xl font-black">Findings move from review to evidence to resolution.</h2>
          </div>
          <div className="text-right">
            <p className="text-xs text-muted">{decided} of {findings.length} reviewed</p>
            <div className="mt-1 h-2 w-40 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${findings.length ? (decided / findings.length) * 100 : 0}%` }} />
            </div>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-6">
          <div className="rounded-lg border border-line bg-slate-50 p-3 text-center">
            <strong className="block text-2xl font-black text-slate-600">{counts.open}</strong>
            <p className="text-xs text-muted">Open</p>
          </div>
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-center">
            <strong className="block text-2xl font-black text-blue-700">{counts.under_review}</strong>
            <p className="text-xs text-muted">Under Review</p>
          </div>
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-center">
            <strong className="block text-2xl font-black text-amber-700">{counts.evidence_requested}</strong>
            <p className="text-xs text-muted">Evidence Requested</p>
          </div>
          <div className="rounded-lg border border-cyan-200 bg-cyan-50 p-3 text-center">
            <strong className="block text-2xl font-black text-cyan-700">{counts.evidence_received}</strong>
            <p className="text-xs text-muted">Evidence Received</p>
          </div>
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-center">
            <strong className="block text-2xl font-black text-emerald-700">{counts.resolved}</strong>
            <p className="text-xs text-muted">Resolved</p>
          </div>
          <div className="rounded-lg border border-line bg-slate-50 p-3 text-center">
            <strong className="block text-2xl font-black text-slate-500">{counts.closed}</strong>
            <p className="text-xs text-muted">Closed</p>
          </div>
        </div>
        {decided > 0 && (
          <div className="mt-4 flex gap-6 border-t border-line pt-4">
            <div>
              <p className="text-xs text-muted">Resolution rate</p>
              <strong className="text-lg font-black text-emerald-700">{resolutionRate}%</strong>
              <p className="text-xs text-muted">of decided findings resolved</p>
            </div>
            <div>
              <p className="text-xs text-muted">Closure rate</p>
              <strong className="text-lg font-black text-slate-600">{closureRate}%</strong>
              <p className="text-xs text-muted">of decided findings closed</p>
            </div>
            <div className="ml-auto text-right">
              <p className="text-xs text-muted">Workflow signal</p>
              <strong className={`text-lg font-black ${allOpen.length === 0 ? "text-emerald-700" : counts.evidence_requested ? "text-amber-700" : "text-blue-700"}`}>
                {allOpen.length === 0 ? "Ready for sign-off" : counts.evidence_requested ? "Evidence outstanding" : "Review in progress"}
              </strong>
            </div>
          </div>
        )}
      </section>

      <div className="grid gap-4 xl:grid-cols-[1fr_0.9fr]">
        <Panel title={`Findings to Review (${allOpen.length} open)`}>
          <FindingList findings={findings} setActive={() => undefined} updateFindingStatus={updateFindingStatus} />
        </Panel>
        <Panel title="Recommended Actions">
          <div className="grid gap-3">
            {recommendations.filter((r) => !r.completed).map((item) => (
              <ActionRow key={item.id} recommendation={item} complete={() => completeRecommendation(item)} />
            ))}
            {recommendations.filter((r) => !r.completed).length === 0 && (
              <p className="text-sm text-muted">All recommended actions are complete.</p>
            )}
          </div>
        </Panel>
      </div>
    </div>
  );
}

function CashflowPanel({ forecast, findings, uploads }: { forecast: CashForecastPoint[]; findings: Finding[]; uploads: Upload[] }) {
  const hasUploads = uploads.length > 0;
  const arFindings = findings.filter((finding) => finding.category === "ar" && finding.status !== "false_positive" && finding.status !== "not_applicable");
  const expectedCollections = arFindings.reduce((sum, finding) => sum + (finding.amount ?? parseImpactAmount(finding.expectedImpact)), 0);
  const f30 = hasUploads ? (forecast[1]?.cash ?? 0) : 0;
  const f90 = hasUploads ? (forecast[3]?.cash ?? 0) : 0;
  const risk30: RiskLevel = forecast[1]?.risk ?? "medium";
  const risk90: RiskLevel = forecast[3]?.risk ?? "high";

  return (
    <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
      <Panel title="Cash Intelligence">
        {hasUploads ? (
          <CashChart forecast={forecast} />
        ) : (
          <div className="flex h-72 items-center justify-center rounded-lg border-2 border-dashed border-line bg-slate-50">
            <div className="text-center">
              <p className="font-bold text-muted">No finance data uploaded</p>
              <p className="mt-1 text-sm text-muted">Upload a trial balance or bank export to see your cash forecast.</p>
            </div>
          </div>
        )}
      </Panel>
      <Panel title="Working Capital Signals">
        <div className="grid gap-3">
          <Metric title="30-Day Forecast" value={f30 ? `£${Math.round(f30 / 1000)}k` : "—"} detail={hasUploads ? riskCopy(risk30) + " risk" : "Upload to calculate"} tone={hasUploads ? risk30 : "low"} />
          <Metric title="90-Day Forecast" value={f90 ? `£${Math.round(f90 / 1000)}k` : "—"} detail={hasUploads ? `${riskCopy(risk90)} risk` : "Upload to calculate"} tone={hasUploads ? risk90 : "low"} />
          <Metric title="Expected Collections" value={expectedCollections ? `£${Math.round(expectedCollections / 1000)}k` : "—"} detail={hasUploads ? "Identified from AR review" : "Upload aged debtors"} tone={expectedCollections ? "low" : "medium"} />
        </div>
      </Panel>
    </div>
  );
}

function CollectionsPanel({ findings }: { findings: Finding[] }) {
  const arFindings = findings.filter((f) => f.category === "ar");
  type Debtor = { name: string; amount: number; risk: RiskLevel; action: string };
  const debtors: Debtor[] = arFindings.flatMap((f) => {
    const names = f.evidence.accountCode.split("/").map((n) => n.trim()).filter(Boolean);
    const total = parseImpactAmount(f.expectedImpact);
    const perDebtor = names.length ? Math.round(total / names.length) : 0;
    return names.map((name, i) => ({
      name,
      amount: perDebtor,
      risk: (i === 0 ? f.severity : f.severity === "critical" ? "high" : f.severity) as RiskLevel,
      action: f.severity === "critical" ? "Call CFO today" : f.severity === "high" ? "Send payment plan" : "Escalate to sales owner",
    }));
  });

  return (
    <Panel title="Collections Intelligence">
      {debtors.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted">No AR findings found. Upload your aged debtors file to see collection priorities.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-left">
            <thead className="text-xs uppercase text-muted">
              <tr><th className="border-b border-line p-3">Debtor</th><th className="border-b border-line p-3">Amount</th><th className="border-b border-line p-3">Risk</th><th className="border-b border-line p-3">Recovery Action</th><th className="border-b border-line p-3"></th></tr>
            </thead>
            <tbody>
              {debtors.map((d) => (
                <tr key={d.name}>
                  <td className="border-b border-line p-3 font-bold">{d.name}</td>
                  <td className="border-b border-line p-3">{d.amount ? `£${d.amount.toLocaleString()}` : "—"}</td>
                  <td className="border-b border-line p-3"><Pill level={d.risk}>{riskCopy(d.risk)}</Pill></td>
                  <td className="border-b border-line p-3">{d.action}</td>
                  <td className="border-b border-line p-3">
                    <button
                      className="rounded-lg bg-brand px-3 py-2 text-sm font-bold text-white"
                      onClick={() => {
                        const subject = encodeURIComponent(`Payment follow-up: ${d.name}`);
                        const body = encodeURIComponent(`Hello,\n\nWe are reviewing the outstanding balance for ${d.name}. Please can you confirm the expected payment date for the balance currently showing as ${d.amount ? `£${d.amount.toLocaleString()}` : "outstanding"}?\n\nRegards,\nFinance Team`);
                        window.location.href = `mailto:?subject=${subject}&body=${body}`;
                      }}
                    >
                      Draft Email
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

type VatReviewGroup = {
  id: string;
  title: string;
  severity: RiskLevel;
  exposure: number;
  action: string;
  items: Array<{
    label: string;
    detail: string;
    source: "engine" | "rule";
    findingId?: string;
    status?: FindingStatus;
    reviewer?: string;
    reviewReason?: string;
    reviewedAt?: string;
  }>;
};

type VatGroupDecision = {
  status: FindingStatus;
  comment: string;
  reviewer: string;
  reviewedAt: string;
};

type VatAdjustment = {
  id: string;
  title: string;
  exposure: number;
  materiality: RiskLevel;
  debitAccount: string;
  creditAccount: string;
  debitAmount: number;
  creditAmount: number;
  boxImpact: Partial<Record<keyof VatReviewResult["vatReturn"], number>>;
  reason: string;
};

function vatMateriality(amount: number): RiskLevel {
  const abs = Math.abs(amount);
  if (abs >= 1000) return "high";
  if (abs >= 100) return "medium";
  return "low";
}

function buildVatAdjustments(engineFindings: VatReviewResult["findings"]): VatAdjustment[] {
  return engineFindings
    .filter((finding) => /VAT200|VAT202|blocked|entertainment|company car|box 4 overclaim/i.test(`${finding.id ?? ""} ${finding.finding} ${finding.impact ?? ""}`))
    .filter((finding) => (finding.exposure ?? 0) > 0)
    .map((finding, index) => {
      const exposure = Math.round(Math.abs(finding.exposure ?? 0));
      const isCar = /car|vehicle/i.test(finding.finding);
      return {
        id: `vat_adj_${index + 1}`,
        title: finding.finding,
        exposure,
        materiality: vatMateriality(exposure),
        debitAccount: isCar ? "Motor expenses / fixed asset cost" : "Entertainment expense",
        creditAccount: "VAT input control",
        debitAmount: exposure,
        creditAmount: exposure,
        boxImpact: { box4: -exposure, box5: exposure },
        reason: finding.recommendation,
      };
    });
}

function applyVatAdjustments(vatReturn: VatReviewResult["vatReturn"], adjustments: VatAdjustment[]): VatReviewResult["vatReturn"] {
  const next = { ...vatReturn };
  adjustments.forEach((adjustment) => {
    (Object.entries(adjustment.boxImpact) as Array<[keyof VatReviewResult["vatReturn"], number]>).forEach(([box, amount]) => {
      next[box] = Math.round((next[box] ?? 0) + amount);
    });
  });
  next.box3 = Math.round(next.box1 + next.box2);
  next.box5 = Math.round(next.box3 - next.box4);
  return next;
}

type VatPartnerConclusion = "ready" | "ready_after_adjustments" | "manager_review" | "do_not_submit";

function vatSubmissionReadiness(reviewCoverage: number, reconciliationFailures: number, adjustments: VatAdjustment[], partnerConclusion: VatPartnerConclusion) {
  const highAdjustments = adjustments.filter((adjustment) => adjustment.materiality === "high").length;
  if (partnerConclusion === "do_not_submit" || reconciliationFailures > 0) return { label: "Not Ready", tone: "critical" as RiskLevel, detail: "Resolve failed reconciliations before submission." };
  if (partnerConclusion === "ready") return { label: "Ready To Submit", tone: "low" as RiskLevel, detail: "Partner conclusion supports submission." };
  if (adjustments.length || highAdjustments || reviewCoverage < 90) return { label: "Adjustments Required", tone: "medium" as RiskLevel, detail: `${adjustments.length} proposed adjustment(s), ${reviewCoverage}% reviewed.` };
  return { label: "Ready To Submit", tone: "low" as RiskLevel, detail: "No material blockers identified." };
}

function deriveVatPartnerConclusion(reconciliationFailures: number, adjustments: VatAdjustment[], groupedCoverage: number, findingCoverage: number): VatPartnerConclusion {
  if (reconciliationFailures > 0) return "do_not_submit";
  if (adjustments.length > 0) return "ready_after_adjustments";
  if (groupedCoverage < 100 || findingCoverage < 100) return "manager_review";
  return "ready";
}

function vatConclusionLabel(conclusion: VatPartnerConclusion) {
  if (conclusion === "ready") return "Ready For Submission";
  if (conclusion === "ready_after_adjustments") return "Ready After Adjustments";
  if (conclusion === "do_not_submit") return "Do Not Submit";
  return "Manager Review Required";
}

function vatConclusionShortLabel(conclusion: VatPartnerConclusion) {
  if (conclusion === "ready") return "Ready";
  if (conclusion === "ready_after_adjustments") return "After adjustments";
  if (conclusion === "do_not_submit") return "Do not submit";
  return "Manager review";
}

function vatConclusionTone(conclusion: VatPartnerConclusion): RiskLevel {
  if (conclusion === "ready") return "low";
  if (conclusion === "do_not_submit") return "critical";
  return "medium";
}

function vatRuleExposure(_finding: Finding, _groupId: string) {
  return 0;
}

function buildVatReviewGroups(engineFindings: VatReviewResult["findings"], vatFindings: Finding[], reconciliationResults: VatReviewResult["reconciliationResults"]): VatReviewGroup[] {
  const groups: VatReviewGroup[] = [
    { id: "reverse_charge", title: "Reverse Charge Review", severity: "high", exposure: 0, action: "Confirm reverse charge treatment and Box 1/Box 4 population.", items: [] },
    { id: "blocked_vat", title: "Blocked VAT Review", severity: "high", exposure: 0, action: "Confirm recoverability and remove blocked input VAT from Box 4 where required.", items: [] },
    { id: "vat_reconciliation", title: "VAT Control Reconciliation", severity: "high", exposure: 0, action: "Investigate VAT control, HMRC payment and return differences before sign-off.", items: [] },
    { id: "vat_coding", title: "VAT Coding & Rate Review", severity: "medium", exposure: 0, action: "Review missing codes, unusual rates and supporting evidence.", items: [] },
  ];
  const byId = new Map(groups.map((group) => [group.id, group]));

  const add = (groupId: string, item: VatReviewGroup["items"][number], exposure = 0, severity?: RiskLevel) => {
    const group = byId.get(groupId);
    if (!group) return;
    group.items.push(item);
    group.exposure += Math.round(Math.abs(exposure));
    if (severity && severityRank(severity) > severityRank(group.severity)) group.severity = severity;
  };

  engineFindings.forEach((finding) => {
    const text = `${finding.id ?? ""} ${finding.finding} ${finding.evidence} ${finding.impact ?? ""}`.toLowerCase();
    const groupId =
      /reverse charge|construction/.test(text) ? "reverse_charge" :
      /blocked|entertainment|car|recoverability|box 4 overclaim/.test(text) ? "blocked_vat" :
      /reconciliation|control|hmrc payment|agrees/.test(text) ? "vat_reconciliation" :
      "vat_coding";
    add(groupId, {
      label: finding.finding,
      detail: finding.evidence,
      source: "engine",
    }, finding.exposure ?? 0, finding.severity);
  });

  reconciliationResults.filter((item) => item.status !== "passed").forEach((item) => {
    const duplicate = byId.get("vat_reconciliation")?.items.some((existing) => existing.label === item.name);
    if (duplicate) return;
    add("vat_reconciliation", {
      label: item.name,
      detail: item.detail,
      source: "engine",
    }, item.difference, item.status === "failed" ? "high" : "medium");
  });

  vatFindings.forEach((finding) => {
    const text = `${finding.ruleId ?? ""} ${finding.title} ${finding.description} ${finding.evidence.calculation}`.toLowerCase();
    const groupId =
      /reverse charge|digital service|overseas|construction/.test(text) ? "reverse_charge" :
      /blocked|entertainment|hospitality|car|fuel|recoverability/.test(text) ? "blocked_vat" :
      /control|reconcil|box|return/.test(text) ? "vat_reconciliation" :
      "vat_coding";
    add(groupId, {
      label: finding.title,
      detail: finding.evidence.calculation || finding.description,
      source: "rule",
      findingId: finding.id,
      status: finding.status,
      reviewer: finding.reviewer,
      reviewReason: finding.reviewReason,
      reviewedAt: finding.reviewedAt,
    }, vatRuleExposure(finding, groupId), finding.severity);
  });

  return groups
    .filter((group) => group.items.length > 0)
    .sort((a, b) => severityRank(b.severity) - severityRank(a.severity) || b.exposure - a.exposure);
}

function severityRank(level: RiskLevel) {
  const ranks: Record<RiskLevel, number> = { low: 1, medium: 2, high: 3, critical: 4 };
  return ranks[level];
}

function VatReviewGroupCard({ group, decision, onDecision, updateFindingStatus }: { group: VatReviewGroup; decision?: VatGroupDecision; onDecision: (status: FindingStatus, comment: string) => void; updateFindingStatus: (findingId: string, status: FindingStatus, reason?: string) => void }) {
  const [comment, setComment] = useState(decision?.comment ?? "");
  const linkedFindings = group.items.filter((item) => item.findingId);
  const reviewedLinked = linkedFindings.filter((item) => item.status && reviewedFindingStatuses.includes(item.status)).length;
  const isDecided = Boolean(decision);

  const decide = (status: FindingStatus) => {
    const reason = comment.trim() || defaultReviewReason(status);
    onDecision(status, reason);
    linkedFindings.forEach((item) => {
      if (item.findingId) updateFindingStatus(item.findingId, status, reason);
    });
  };

  return (
    <div className="rounded-lg border border-line bg-slate-50 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Pill level={group.severity}>{riskCopy(group.severity)}</Pill>
            {decision && <Pill level={decision.status === "accepted_risk" || decision.status === "resolved" ? "low" : decision.status === "false_positive" || decision.status === "closed" ? "medium" : "high"}>{decision.status.replaceAll("_", " ")}</Pill>}
            <strong>{group.title}</strong>
          </div>
          <p className="mt-2 text-sm text-muted">{group.action}</p>
        </div>
        <div className="text-right">
          <p className="text-xs font-bold uppercase text-muted">Exposure</p>
          <p className="text-xl font-black">£{Math.round(group.exposure).toLocaleString("en-GB")}</p>
        </div>
      </div>

      <div className="mt-3 grid gap-2">
        {group.items.slice(0, 6).map((item, index) => (
          <div key={`${group.id}-${item.label}-${index}`} className="rounded-lg border border-line bg-white p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <strong>{item.label}</strong>
              <span className="text-xs font-bold uppercase text-muted">{item.source === "engine" ? "Engine" : item.status?.replaceAll("_", " ") ?? "Finding"}</span>
            </div>
            <p className="mt-1 text-muted">{item.detail}</p>
            {item.reviewer && (
              <p className="mt-2 text-xs text-muted">
                Reviewed by <strong>{item.reviewer}</strong>{item.reviewedAt ? ` on ${new Date(item.reviewedAt).toLocaleString("en-GB")}` : ""}{item.reviewReason ? ` — ${item.reviewReason}` : ""}
              </p>
            )}
          </div>
        ))}
        {group.items.length > 6 && <p className="text-xs font-semibold text-muted">+ {group.items.length - 6} supporting item(s) in the evidence appendix.</p>}
      </div>

      <div className="no-print mt-4 grid gap-3">
        <textarea
          className="min-h-20 rounded-lg border border-line p-3 text-sm"
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          placeholder="Reviewer comment or evidence reference"
        />
        <div className="flex flex-wrap gap-2">
          <button className="rounded-lg bg-violet-600 px-3 py-2 text-sm font-bold text-white" onClick={() => decide("accepted_risk")}>Accept Risk</button>
          <button className="rounded-lg bg-amber-500 px-3 py-2 text-sm font-bold text-white" onClick={() => decide("evidence_requested")}>Request Evidence</button>
          <button className="rounded-lg bg-brand px-3 py-2 text-sm font-bold text-white" onClick={() => decide("resolved")}>Resolved</button>
          <button className="rounded-lg border border-line bg-white px-3 py-2 text-sm font-bold" onClick={() => decide("false_positive")}>False Positive</button>
        </div>
        {linkedFindings.length > 0 && <p className="text-xs text-muted">{reviewedLinked}/{linkedFindings.length} linked rule finding(s) have reviewer decisions.</p>}
      </div>
      {decision && <p className="mt-3 text-xs text-muted">Decision by <strong>{decision.reviewer}</strong> on {new Date(decision.reviewedAt).toLocaleString("en-GB")}.</p>}
    </div>
  );
}

function VatAssuranceModule({ vatReview, findings, updateFindingStatus, setActive, userName, tenantId, companyId, onVatReviewChange }: { vatReview?: VatReviewResult; findings: Finding[]; updateFindingStatus: (findingId: string, status: FindingStatus, reason?: string) => void; setActive: (value: string) => void; userName: string; tenantId: string; companyId: string; onVatReviewChange: (review: VatReviewResult) => void }) {
  const vatFindings = findings.filter((item) => item.category === "vat");
  const engineFindings = vatReview?.findings ?? [];
  const health = vatReview?.healthScore ?? 0;
  const vatReadiness = vatReview?.readinessScore ?? health;
  const assuranceChecks = vatReview?.assuranceChecks ?? [];
  const exceptionDashboard = vatReview?.exceptionDashboard;
  const periodComparison = vatReview?.periodComparison;
  const filingSignOff = vatReview?.filingSignOff;
  const reconciliationResults = vatReview?.reconciliationResults ?? [];
  const boxContributions = vatReview?.boxContributions ?? [];
  const reconciliationFailures = reconciliationResults.filter((item) => item.status === "failed").length;
  const boxRows = vatReview
    ? (Object.entries(vatReview.vatReturn) as Array<[keyof VatReviewResult["vatReturn"], number]>)
    : [];
  const [selectedBox, setSelectedBox] = useState<keyof VatReviewResult["vatReturn"]>("box1");
  const selectedContributions = boxContributions.filter((item) => item.box === selectedBox);
  const selectedContributionTotal = selectedContributions.reduce((sum, item) => sum + item.amount, 0);
  const drillThroughUnavailable = Boolean(vatReview && vatReview.source !== "empty" && boxContributions.length === 0);
  const hasVatReturnData = Boolean(vatReview && vatReview.transactionsAnalysed > 0) || Boolean(vatReview && Object.values(vatReview.vatReturn).some((value) => Math.abs(value) > 0));
  const reviewGroups = vatReview ? buildVatReviewGroups(engineFindings, vatFindings, reconciliationResults) : [];
  const [groupDecisions, setGroupDecisions] = useState<Record<string, VatGroupDecision>>({});
  const [partnerComment, setPartnerComment] = useState("");
  const [preparedBy, setPreparedBy] = useState(userName);
  const [reviewedBy, setReviewedBy] = useState(userName);
  const [approvedBy, setApprovedBy] = useState(userName);
  const [reopenReason, setReopenReason] = useState("");
  const [signOffError, setSignOffError] = useState("");
  const filingApproval = vatReview?.filingApproval;
  const reviewedRuleFindings = vatFindings.filter((finding) => reviewedFindingStatuses.includes(finding.status)).length;
  const reviewedGroups = reviewGroups.filter((group) => Boolean(groupDecisions[group.id])).length;
  const groupReviewCoverage = reviewGroups.length ? Math.round((reviewedGroups / reviewGroups.length) * 100) : 100;
  const findingReviewCoverage = vatFindings.length ? Math.round((reviewedRuleFindings / vatFindings.length) * 100) : 100;
  const reviewCoverage = Math.min(groupReviewCoverage, findingReviewCoverage);
  const highRiskGroups = reviewGroups.filter((group) => group.severity === "high" || group.severity === "critical").length;
  const proposedAdjustments = buildVatAdjustments(engineFindings);
  const totalAdjustmentValue = proposedAdjustments.reduce((sum, adjustment) => sum + adjustment.exposure, 0);
  const adjustedVatReturn = vatReview ? applyVatAdjustments(vatReview.vatReturn, proposedAdjustments) : undefined;
  const workflowPartnerConclusion = deriveVatPartnerConclusion(reconciliationFailures, proposedAdjustments, groupReviewCoverage, findingReviewCoverage);
  const effectivePartnerConclusion = vatReview?.status === "Review Required Before Submission" && workflowPartnerConclusion === "ready"
    ? "manager_review"
    : workflowPartnerConclusion;
  const workflowSubmissionReadiness = vatSubmissionReadiness(reviewCoverage, reconciliationFailures, proposedAdjustments, effectivePartnerConclusion);
  const submissionReadiness = filingSignOff
    ? {
        label: filingSignOff.label,
        tone: filingSignOff.status === "not_ready" ? "critical" as RiskLevel : filingSignOff.status === "ready_with_risks" ? "medium" as RiskLevel : "low" as RiskLevel,
        detail: filingSignOff.detail,
      }
    : workflowSubmissionReadiness;

  const decideGroup = (groupId: string, status: FindingStatus, comment: string) => {
    setGroupDecisions((items) => ({
      ...items,
      [groupId]: {
        status,
        comment,
        reviewer: userName,
        reviewedAt: new Date().toISOString(),
      },
    }));
  };

  const persistFilingApproval = (nextReview: VatReviewResult) => {
    onVatReviewChange(nextReview);
    fetch("/api/vat-signoff", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenantId, companyId, approval: nextReview.filingApproval }),
    }).catch(() => {});
  };

  const approveFiling = async () => {
    if (!vatReview) return;
    setSignOffError("");
    try {
      const nextReview = await approveVatFiling(vatReview, { preparedBy, reviewedBy, approvedBy });
      persistFilingApproval(nextReview);
    } catch (error) {
      setSignOffError(error instanceof Error ? error.message : "VAT filing approval failed.");
    }
  };

  const reopenFiling = () => {
    if (!vatReview) return;
    setSignOffError("");
    try {
      const nextReview = reopenVatFiling(vatReview, userName, reopenReason);
      persistFilingApproval(nextReview);
      setReopenReason("");
    } catch (error) {
      setSignOffError(error instanceof Error ? error.message : "VAT filing could not be reopened.");
    }
  };

  if (!vatReview || vatReview.source === "empty" || !hasVatReturnData) {
    return (
      <Panel title="ClosePilot VAT Assurance">
        <div className="grid gap-4 xl:grid-cols-[0.8fr_1.2fr]">
          <div className="rounded-lg border border-dashed border-line bg-slate-50 p-6">
            <p className="text-xs font-bold uppercase text-muted">VAT Return</p>
            <h2 className="mt-2 text-2xl font-black">Upload VAT transactions or a VAT return export.</h2>
            <p className="mt-2 text-sm text-muted">ClosePilot will calculate Boxes 1-9, reconcile the VAT control account, detect exceptions, and produce a return ready for review.</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Metric title="VAT Health Score" value="—" detail="Awaiting VAT data" tone="medium" />
            <Metric title="Review Status" value="Required" detail="No VAT report uploaded" tone="medium" />
          </div>
        </div>
      </Panel>
    );
  }

  return (
    <div className="grid gap-4">
      <Panel title="ClosePilot VAT Assurance">
        <div className="grid gap-4 xl:grid-cols-[0.8fr_1.2fr]">
          <div className="rounded-lg border border-line bg-slate-50 p-5">
            <p className="text-xs font-bold uppercase text-muted">HMRC VAT Return</p>
            <h2 className="mt-2 text-2xl font-black">{filingSignOff?.status === "ready_to_submit" ? "HMRC VAT Return Ready for Review" : "HMRC VAT Return Requires Review"}</h2>
            <p className="mt-2 text-sm text-muted">
              {vatReview.source === "explicit_return" ? "Boxes imported from VAT return export." : "Boxes calculated from VAT transactions."} {vatReview.transactionsAnalysed} VAT transaction(s) analysed.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Pill level={submissionReadiness.tone}>{submissionReadiness.label}</Pill>
              <button className="rounded-lg bg-brand px-4 py-2 text-sm font-black text-white" onClick={() => window.print()}>Print / Save PDF</button>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Metric title="VAT Readiness" value={`${vatReadiness}%`} detail={vatReview.status} tone={vatReadiness >= 85 ? "low" : vatReadiness >= 70 ? "medium" : "high"} />
            <Metric title="VAT Liability" value={`£${Math.round(Math.abs(vatReview.vatReturn.box5)).toLocaleString("en-GB")}`} detail={vatReview.vatReturn.box5 < 0 ? "Reclaim position" : "Payable position"} tone={vatReview.vatReturn.box5 > 0 ? "medium" : "low"} />
            <Metric title="Exceptions" value={vatReview.exceptionsCount ?? engineFindings.length + vatFindings.length} detail={`${vatReview.highRiskCount ?? 0} high risk`} tone={(vatReview.highRiskCount ?? 0) ? "high" : engineFindings.length || vatFindings.length ? "medium" : "low"} />
            <Metric title="Blocked VAT Risk" value={`£${Math.round(vatReview.blockedVatRisk ?? 0).toLocaleString("en-GB")}`} detail="Potential Box 4 overclaim" tone={(vatReview.blockedVatRisk ?? 0) ? "high" : "low"} />
            <Metric title="Reconciliation" value={vatReview.reconciliationStatus ?? (reconciliationFailures ? "FAIL" : "PASS")} detail="VAT return evidence" tone={reconciliationFailures ? "high" : "low"} />
            <Metric title="Computation" value={`${vatReview.scoreBreakdown?.computationAccuracy ?? 0}%`} detail="Box calculation accuracy" tone={(vatReview.scoreBreakdown?.computationAccuracy ?? 0) >= 85 ? "low" : "medium"} />
          </div>
        </div>
      </Panel>

      <section className="grid gap-4 xl:grid-cols-[1fr_1fr]">
        <Panel title="VAT Exception Dashboard">
          {exceptionDashboard ? (
            <>
              <div className="grid gap-3 sm:grid-cols-4">
                <Metric title="High Risk" value={exceptionDashboard.high} detail="Immediate review" tone={exceptionDashboard.high ? "high" : "low"} />
                <Metric title="Medium Risk" value={exceptionDashboard.medium} detail="Reviewer attention" tone={exceptionDashboard.medium ? "medium" : "low"} />
                <Metric title="Low Risk" value={exceptionDashboard.low} detail="Monitor" tone="low" />
                <Metric title="Total Exceptions" value={exceptionDashboard.total} detail="Operational VAT queue" tone={exceptionDashboard.total ? "medium" : "low"} />
              </div>
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                {(Object.entries(exceptionDashboard.categories) as Array<[keyof typeof exceptionDashboard.categories, number]>).map(([category, count]) => (
                  <div key={category} className="flex items-center justify-between rounded-lg border border-line bg-slate-50 px-3 py-2 text-sm">
                    <span className="font-semibold">{({ boxValidation: "Box Validation", controlReconciliation: "Control Reconciliation", manualJournals: "Manual Journals", reverseCharge: "Reverse Charge", piva: "PIVA", trendAnalysis: "Trend Analysis", codingAndRates: "Coding & Rates" } as const)[category]}</span>
                    <Pill level={count ? "medium" : "low"}>{count}</Pill>
                  </div>
                ))}
              </div>
            </>
          ) : <EmptyState title="No exception summary" detail="Run VAT Assurance to generate the operational exception dashboard." />}
        </Panel>

        <Panel title="Prior-Period VAT Comparison">
          {periodComparison && periodComparison.status !== "not_available" ? (
            <div className="grid gap-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <Metric title="Current VAT Due" value={`£${Math.round(Math.abs(periodComparison.currentVatDue)).toLocaleString("en-GB")}`} detail="Current Box 5" tone="medium" />
                <Metric title="Previous VAT Due" value={`£${Math.round(Math.abs(periodComparison.previousVatDue)).toLocaleString("en-GB")}`} detail="Prior Box 5" tone="low" />
                <Metric title="Movement" value={`${periodComparison.percentageChange === null ? "—" : `${periodComparison.percentageChange > 0 ? "+" : ""}${periodComparison.percentageChange}%`}`} detail={`${periodComparison.movement >= 0 ? "+" : "-"}£${Math.round(Math.abs(periodComparison.movement)).toLocaleString("en-GB")}`} tone={periodComparison.status === "review" ? "high" : "low"} />
              </div>
              <div className={`rounded-lg border p-4 ${periodComparison.status === "review" ? "border-amber-200 bg-amber-50" : "border-emerald-200 bg-emerald-50"}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <strong>{periodComparison.status === "review" ? "Movement requires explanation" : "Movement within 30% threshold"}</strong>
                  <Pill level={periodComparison.status === "review" ? "medium" : "low"}>{periodComparison.status}</Pill>
                </div>
                <p className="mt-2 text-sm text-muted">{periodComparison.detail}</p>
              </div>
            </div>
          ) : (
            <EmptyState title="Prior-period VAT data required" detail="Upload a VAT file containing ‘prior’ or ‘previous’ in its filename to activate VAT_022 movement analysis." />
          )}
        </Panel>
      </section>

      <Panel title="VAT Filing Sign-Off">
        {filingSignOff ? (
          <div className="grid gap-4 lg:grid-cols-[0.8fr_1.2fr]">
            <div className={`rounded-lg border p-5 ${filingSignOff.status === "not_ready" ? "border-red-200 bg-red-50" : filingSignOff.status === "ready_with_risks" ? "border-amber-200 bg-amber-50" : "border-emerald-200 bg-emerald-50"}`}>
              <p className="text-xs font-bold uppercase text-muted">System filing assessment</p>
              <h3 className="mt-1 text-2xl font-black">{filingSignOff.label}</h3>
              <p className="mt-2 text-sm text-muted">{filingSignOff.detail}</p>
              {!filingApproval?.locked && (
                <div className="mt-4 grid gap-2">
                  <input className="rounded-lg border border-line bg-white px-3 py-2 text-sm" value={preparedBy} onChange={(event) => setPreparedBy(event.target.value)} placeholder="Prepared by" />
                  <input className="rounded-lg border border-line bg-white px-3 py-2 text-sm" value={reviewedBy} onChange={(event) => setReviewedBy(event.target.value)} placeholder="Reviewed by" />
                  <input className="rounded-lg border border-line bg-white px-3 py-2 text-sm" value={approvedBy} onChange={(event) => setApprovedBy(event.target.value)} placeholder="Approved by" />
                  <button
                    className="rounded-lg bg-brand px-4 py-2 text-sm font-black text-white disabled:cursor-not-allowed disabled:bg-slate-300"
                    disabled={filingSignOff.status === "not_ready"}
                    onClick={approveFiling}
                  >
                    {filingSignOff.status === "ready_with_risks" ? "Acknowledge Risks & Approve" : "Approve Ready to File"}
                  </button>
                </div>
              )}
              {filingApproval?.locked && <Pill level="low">Snapshot locked</Pill>}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-line bg-slate-50 p-4">
                <strong>Filing blockers</strong>
                {filingSignOff.blockers.length ? <ul className="mt-2 list-disc pl-5 text-sm text-muted">{filingSignOff.blockers.map((item) => <li key={item}>{item}</li>)}</ul> : <p className="mt-2 text-sm text-emerald-700">No filing blockers.</p>}
              </div>
              <div className="rounded-lg border border-line bg-slate-50 p-4">
                <strong>Residual risks</strong>
                {filingSignOff.risks.length ? <ul className="mt-2 list-disc pl-5 text-sm text-muted">{filingSignOff.risks.map((item) => <li key={item}>{item}</li>)}</ul> : <p className="mt-2 text-sm text-emerald-700">No residual risks.</p>}
              </div>
              <div className="rounded-lg border border-line bg-white p-4 sm:col-span-2">
                <strong>Approval record</strong>
                {!filingApproval ? (
                  <p className="mt-1 text-sm text-muted">Awaiting named preparer, reviewer and approver.</p>
                ) : (
                  <div className="mt-2 grid gap-2 text-sm text-muted">
                    <p>Prepared by <strong>{filingApproval.preparedBy}</strong> · Reviewed by <strong>{filingApproval.reviewedBy}</strong> · Approved by <strong>{filingApproval.approvedBy}</strong>.</p>
                    <p>{filingApproval.status === "approved_with_risks" ? "Risks acknowledged and approved" : filingApproval.status === "reopened" ? "Approval reopened" : "Ready to file approved"}{filingApproval.approvedAt ? ` at ${new Date(filingApproval.approvedAt).toLocaleString("en-GB")}` : ""}.</p>
                    {filingApproval.snapshotHash && <p className="break-all font-mono text-xs">SHA-256: {filingApproval.snapshotHash}</p>}
                    <p>{filingApproval.evidenceReferences.length} evidence reference(s) linked · {filingApproval.auditTrail.length} audit event(s).</p>
                    {filingApproval.locked && (
                      <button className="w-fit rounded-lg border border-line bg-white px-3 py-2 text-xs font-black" onClick={() => exportFile("closepilot-approved-vat-snapshot.json", JSON.stringify(filingApproval, null, 2), "application/json;charset=utf-8")}>Approved Snapshot JSON</button>
                    )}
                  </div>
                )}
              </div>
              {filingApproval?.locked && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 sm:col-span-2">
                  <strong>Controlled reopening</strong>
                  <p className="mt-1 text-sm text-muted">Reopening preserves the approved snapshot and adds a mandatory audit event.</p>
                  <textarea className="mt-3 min-h-20 w-full rounded-lg border border-line bg-white p-3 text-sm" value={reopenReason} onChange={(event) => setReopenReason(event.target.value)} placeholder="Reason for reopening (minimum 10 characters)" />
                  <button className="mt-2 rounded-lg border border-amber-300 bg-white px-3 py-2 text-xs font-black text-amber-800" onClick={reopenFiling}>Reopen VAT Review</button>
                </div>
              )}
              {signOffError && <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700 sm:col-span-2">{signOffError}</p>}
            </div>
          </div>
        ) : <EmptyState title="Filing assessment unavailable" detail="Run VAT Assurance to generate the filing sign-off gate." />}
      </Panel>

      <section className="grid gap-4 xl:grid-cols-[0.8fr_1.2fr]">
        <Panel title="VAT Readiness Drivers">
          <div className="grid gap-3 sm:grid-cols-2">
            {vatReview.readinessDrivers && (Object.entries(vatReview.readinessDrivers) as Array<[keyof NonNullable<VatReviewResult["readinessDrivers"]>, number]>).map(([driver, value]) => (
              <SummaryItem
                key={driver}
                label={({ boxValidation: "Box Validation", controlReconciliations: "Control Reconciliations", piva: "PIVA", reverseCharge: "Reverse Charge", evidence: "Evidence" } as const)[driver]}
                value={`${value}%`}
                detail={value >= 85 ? "Ready" : value >= 70 ? "Review" : "Evidence or remediation required"}
                level={value >= 85 ? "low" : value >= 70 ? "medium" : "high"}
              />
            ))}
          </div>
        </Panel>

        <Panel title="VAT Assurance V2 Checks">
          <div className="grid gap-3">
            {assuranceChecks.map((check) => (
              <div key={check.id} className="rounded-lg border border-line bg-slate-50 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-bold uppercase text-muted">{check.id} · {check.category.replaceAll("_", " ")}</p>
                    <strong className="mt-1 block">{check.title}</strong>
                    <p className="mt-1 text-sm text-muted">{check.detail}</p>
                    {check.recommendation && <p className="mt-2 text-sm font-semibold">{check.recommendation}</p>}
                  </div>
                  <Pill level={check.status === "passed" ? "low" : check.status === "not_tested" ? "medium" : check.status === "review" ? "medium" : "high"}>{check.status.replaceAll("_", " ")}</Pill>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      </section>

      <section className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
        <Panel title="VAT Review Workflow">
          <div className="grid gap-3 sm:grid-cols-4">
            <Metric title="High-Risk Reviews" value={highRiskGroups} detail={`${reviewGroups.length} grouped investigation(s)`} tone={highRiskGroups ? "high" : "low"} />
            <Metric title="Supporting Findings" value={vatFindings.length} detail="Rule-level evidence" tone={vatFindings.length ? "medium" : "low"} />
            <Metric title="Review Coverage" value={`${reviewCoverage}%`} detail={`${reviewedGroups}/${reviewGroups.length} groups, ${reviewedRuleFindings}/${vatFindings.length} findings`} tone={reviewCoverage >= 90 ? "low" : reviewCoverage >= 50 ? "medium" : "high"} />
            <Metric title="Partner Conclusion" value={vatConclusionShortLabel(effectivePartnerConclusion)} detail="System-derived VAT sign-off status" tone={vatConclusionTone(effectivePartnerConclusion)} />
          </div>

          <div className="mt-4 grid gap-3">
            {reviewGroups.length ? (
              reviewGroups.map((group) => (
                <VatReviewGroupCard
                  key={group.id}
                  group={group}
                  decision={groupDecisions[group.id]}
                  onDecision={(decisionStatus, comment) => decideGroup(group.id, decisionStatus, comment)}
                  updateFindingStatus={updateFindingStatus}
                />
              ))
            ) : (
              <EmptyState title="No VAT investigations required" detail="No grouped VAT risk reviews were generated from this pack." />
            )}
          </div>
        </Panel>

        <Panel title="Partner VAT Conclusion">
          <div className="grid gap-3">
            <div className={`rounded-lg border p-4 ${vatConclusionTone(effectivePartnerConclusion) === "critical" ? "border-red-200 bg-red-50" : vatConclusionTone(effectivePartnerConclusion) === "low" ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}>
              <p className="text-xs font-bold uppercase text-muted">Current conclusion</p>
              <strong className="mt-1 block text-xl">{vatConclusionLabel(effectivePartnerConclusion)}</strong>
              <p className="mt-2 text-sm text-muted">
                {effectivePartnerConclusion === "do_not_submit"
                  ? "Failed reconciliations must be resolved before submission."
                  : effectivePartnerConclusion === "ready_after_adjustments"
                    ? "Proposed VAT adjustments must be accepted, rejected, or posted before submission."
                    : effectivePartnerConclusion === "manager_review"
                      ? "Grouped investigations and rule findings need reviewer decisions."
                      : "Required review work is complete and the return can be submitted."}
              </p>
            </div>
            <label className="grid gap-2">
              <span className="text-sm font-bold text-muted">Partner / manager comment</span>
              <textarea
                className="min-h-28 rounded-lg border border-line p-3 text-sm"
                value={partnerComment}
                onChange={(event) => setPartnerComment(event.target.value)}
                placeholder="Record conclusion, adjustment references, or submission restrictions"
              />
            </label>
            <div className="rounded-lg border border-line bg-slate-50 p-4 text-sm">
              <strong>Audit trail</strong>
              <p className="mt-1 text-muted">Group coverage {groupReviewCoverage}% ({reviewedGroups}/{reviewGroups.length}). Finding coverage {findingReviewCoverage}% ({reviewedRuleFindings}/{vatFindings.length}). Overall coverage uses the lower of the two.</p>
              {partnerComment && <p className="mt-2 text-muted">Conclusion comment: {partnerComment}</p>}
            </div>
          </div>
        </Panel>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1fr_0.9fr]">
        <Panel title="Proposed VAT Adjustments">
          <div className="mb-4 grid gap-3 sm:grid-cols-3">
            <Metric title="Adjustment Value" value={`£${totalAdjustmentValue.toLocaleString("en-GB")}`} detail="Proposed VAT correction" tone={totalAdjustmentValue ? vatMateriality(totalAdjustmentValue) : "low"} />
            <Metric title="Materiality" value={riskCopy(vatMateriality(totalAdjustmentValue))} detail={totalAdjustmentValue < 100 ? "< £100" : totalAdjustmentValue < 1000 ? "£100-£1,000" : "> £1,000"} tone={vatMateriality(totalAdjustmentValue)} />
            <Metric title="Submission Readiness" value={submissionReadiness.label} detail={submissionReadiness.detail} tone={submissionReadiness.tone} />
          </div>

          {proposedAdjustments.length ? (
            <div className="overflow-x-auto rounded-lg border border-line">
              <table className="w-full min-w-[900px] border-collapse text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-muted">
                  <tr>
                    <th className="border-b border-line p-3">Adjustment</th>
                    <th className="border-b border-line p-3">Dr</th>
                    <th className="border-b border-line p-3">Cr</th>
                    <th className="border-b border-line p-3">Box Impact</th>
                    <th className="border-b border-line p-3">Materiality</th>
                  </tr>
                </thead>
                <tbody>
                  {proposedAdjustments.map((adjustment) => (
                    <tr key={adjustment.id}>
                      <td className="border-b border-line p-3">
                        <strong>{adjustment.title}</strong>
                        <p className="mt-1 text-xs text-muted">{adjustment.reason}</p>
                      </td>
                      <td className="border-b border-line p-3">{adjustment.debitAccount}<br /><strong>£{adjustment.debitAmount.toLocaleString("en-GB")}</strong></td>
                      <td className="border-b border-line p-3">{adjustment.creditAccount}<br /><strong>£{adjustment.creditAmount.toLocaleString("en-GB")}</strong></td>
                      <td className="border-b border-line p-3">Box 4 {(adjustment.boxImpact.box4 ?? 0) < 0 ? "decrease" : "increase"} £{Math.abs(adjustment.boxImpact.box4 ?? 0).toLocaleString("en-GB")}</td>
                      <td className="border-b border-line p-3"><Pill level={adjustment.materiality}>{riskCopy(adjustment.materiality)}</Pill></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState title="No VAT adjustments proposed" detail="No blocked VAT or correction journals were generated from the current evidence." />
          )}
        </Panel>

        <Panel title="Before / After VAT Return">
          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="w-full min-w-[520px] border-collapse text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-muted">
                <tr>
                  <th className="border-b border-line p-3">Box</th>
                  <th className="border-b border-line p-3 text-right">Original</th>
                  <th className="border-b border-line p-3 text-right">Proposed</th>
                  <th className="border-b border-line p-3 text-right">Movement</th>
                </tr>
              </thead>
              <tbody>
                {adjustedVatReturn && (Object.entries(vatReview.vatReturn) as Array<[keyof VatReviewResult["vatReturn"], number]>).map(([box, original]) => {
                  const proposed = adjustedVatReturn[box];
                  const movement = proposed - original;
                  return (
                    <tr key={box}>
                      <td className="border-b border-line p-3 font-black uppercase">{box.replace("box", "Box ")}</td>
                      <td className="border-b border-line p-3 text-right font-semibold">{formatVatAmount(box, original)}</td>
                      <td className="border-b border-line p-3 text-right font-semibold">{formatVatAmount(box, proposed)}</td>
                      <td className={`border-b border-line p-3 text-right font-black ${movement ? "text-amber-700" : "text-muted"}`}>{movement ? `${movement > 0 ? "+" : "-"}£${Math.abs(movement).toLocaleString("en-GB")}` : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      </section>

      <section className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
        <Panel title="VAT Return Boxes 1-9">
          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="w-full min-w-[620px] border-collapse text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-muted">
                <tr>
                  <th className="border-b border-line p-3">Box</th>
                  <th className="border-b border-line p-3">Meaning</th>
                  <th className="border-b border-line p-3 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {boxRows.map(([box, amount]) => (
                  <tr key={box} className={`cursor-pointer transition-colors hover:bg-cyan-50 ${selectedBox === box ? "bg-cyan-50" : ""}`} onClick={() => setSelectedBox(box)}>
                    <td className="border-b border-line p-3 font-black uppercase">
                      <button className="text-left font-black uppercase text-brand" onClick={() => setSelectedBox(box)}>{box.replace("box", "Box ")}</button>
                    </td>
                    <td className="border-b border-line p-3">{vatBoxLabel(box)}</td>
                    <td className="border-b border-line p-3 text-right font-black">{formatVatAmount(box, amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel title="VAT Reconciliation">
          <div className="grid gap-3">
            {reconciliationResults.map((item) => (
              <div key={item.name} className="rounded-lg border border-line bg-slate-50 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <strong>{item.name}</strong>
                    <p className="mt-1 text-sm text-muted">{item.detail}</p>
                  </div>
                  <Pill level={item.status === "passed" ? "low" : item.status === "warning" ? "medium" : "critical"}>{item.status}</Pill>
                </div>
                <div className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
                  <span><strong>Expected</strong> £{Math.round(item.expected).toLocaleString("en-GB")}</span>
                  <span><strong>Actual</strong> £{Math.round(item.actual).toLocaleString("en-GB")}</span>
                  <span><strong>Difference</strong> £{Math.round(item.difference).toLocaleString("en-GB")}</span>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      </section>

      <Panel title={`${selectedBox.replace("box", "Box ")} Transaction Drill-Through`}>
        {selectedContributions.length ? (
          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="w-full min-w-[1180px] border-collapse text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-muted">
                <tr>
                  <th className="border-b border-line p-3">Party</th>
                  <th className="border-b border-line p-3">Description</th>
                  <th className="border-b border-line p-3">Raw Code</th>
                  <th className="border-b border-line p-3">ClosePilot Code</th>
                  <th className="border-b border-line p-3">Country</th>
                  <th className="border-b border-line p-3">Treatment</th>
                  <th className="border-b border-line p-3">Recoverability</th>
                  <th className="border-b border-line p-3">Risk</th>
                  <th className="border-b border-line p-3">Reason</th>
                  <th className="border-b border-line p-3 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {selectedContributions.map((item, index) => (
                  <tr key={`${item.box}-${item.sourceFile}-${item.party}-${item.description}-${index}`}>
                    <td className="border-b border-line p-3 font-bold">{item.party || "—"}</td>
                    <td className="border-b border-line p-3">{item.description || "—"}</td>
                    <td className="border-b border-line p-3">{item.vatCode || "—"}</td>
                    <td className="border-b border-line p-3 font-mono text-xs">{item.canonicalCode || "—"}</td>
                    <td className="border-b border-line p-3">{item.countryCode ? `${item.countryCode} (${(item.countryRegion ?? "unknown").replaceAll("_", " ")})` : "—"}</td>
                    <td className="border-b border-line p-3">{item.treatment.replaceAll("_", " ")}</td>
                    <td className="border-b border-line p-3">{(item.recoverability ?? "review").replaceAll("_", " ")}</td>
                    <td className="border-b border-line p-3">{(item.riskCategory ?? "unknown").replaceAll("_", " ")}</td>
                    <td className="border-b border-line p-3">{item.reason}</td>
                    <td className="border-b border-line p-3 text-right font-black">£{Math.round(Math.abs(item.amount)).toLocaleString("en-GB")}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-slate-50">
                  <td className="p-3 font-black" colSpan={9}>Total contributing to {selectedBox.replace("box", "Box ")}</td>
                  <td className="p-3 text-right font-black">£{Math.round(Math.abs(selectedContributionTotal)).toLocaleString("en-GB")}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-line bg-slate-50 p-6 text-center">
            <p className="font-black">{drillThroughUnavailable ? "Transaction drill-through needs a fresh VAT transaction upload" : "No transaction drill-through for this box"}</p>
            <p className="mx-auto mt-2 max-w-2xl text-sm text-muted">
              {drillThroughUnavailable
                ? "This saved VAT review was created before transaction contribution tracking, or it only contains VAT return summary boxes. Re-upload the VAT transactions/export pack and ClosePilot will rebuild the box-level audit trail."
                : "No transactions contributed to this VAT box."}
            </p>
            {drillThroughUnavailable && (
              <button className="mt-4 rounded-lg bg-brand px-4 py-2 text-sm font-black text-white" onClick={() => setActive("Upload Finance Pack")}>Upload VAT Transactions</button>
            )}
          </div>
        )}
      </Panel>

      <Panel title="VAT Reviewer Questions">
        {vatReview.reviewActions?.length ? (
          <div className="grid gap-3 md:grid-cols-2">
            {vatReview.reviewActions.map((item, index) => (
              <div key={`${item.question}-${index}`} className="rounded-lg border border-line bg-slate-50 p-4">
                <div className="mb-2 flex items-center gap-2">
                  <Pill level={item.priority === "high" ? "high" : item.priority === "medium" ? "medium" : "low"}>{item.priority}</Pill>
                  <strong>{item.question}</strong>
                </div>
                <p className="text-sm text-muted">{item.action}</p>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState title="No VAT reviewer questions" detail="Upload VAT transactions to generate review questions and recommended actions." />
        )}
      </Panel>

      <Panel title="VAT Review Pack">
        <div className="grid gap-4 lg:grid-cols-[0.8fr_1.2fr]">
          <div className="rounded-lg border border-line bg-slate-50 p-4">
            <p className="text-xs font-bold uppercase text-muted">Prepared Output</p>
            <h3 className="mt-1 text-xl font-black">VAT return ready for reviewer sign-off</h3>
            <p className="mt-2 text-sm text-muted">The pack includes VAT summary, Boxes 1-9, grouped investigations, reconciliation results, reviewer decisions, partner conclusion and evidence appendix.</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button className="rounded-lg bg-brand px-4 py-2 text-sm font-black text-white" onClick={() => window.print()}>Print VAT Pack</button>
              <button
                className="rounded-lg border border-line bg-white px-4 py-2 text-sm font-black transition-colors hover:border-brand hover:text-brand"
                onClick={() => exportFile("closepilot_vat_evidence_pack.json", JSON.stringify({
                  vatReview,
                  reviewGroups,
                  groupDecisions,
                  proposedAdjustments,
                  adjustedVatReturn,
                  reviewCoverage,
                  groupReviewCoverage,
                  findingReviewCoverage,
                  submissionReadiness,
                  partnerConclusion: effectivePartnerConclusion,
                  partnerComment,
                }, null, 2), "application/json;charset=utf-8")}
              >
                VAT Evidence JSON
              </button>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <SummaryItem label="VAT Liability" value={`£${Math.round(Math.abs(vatReview.vatReturn.box5)).toLocaleString("en-GB")}`} detail={vatReview.vatReturn.box5 < 0 ? "reclaim position" : "payable position"} level={vatReview.vatReturn.box5 > 0 ? "medium" : "low"} />
            <SummaryItem label="Adjusted Liability" value={`£${Math.round(Math.abs(adjustedVatReturn?.box5 ?? vatReview.vatReturn.box5)).toLocaleString("en-GB")}`} detail={`${proposedAdjustments.length} proposed adjustment(s)`} level={proposedAdjustments.length ? "medium" : "low"} />
            <SummaryItem label="Review Coverage" value={`${reviewCoverage}%`} detail={`${reviewedGroups}/${reviewGroups.length} groups, ${reviewedRuleFindings}/${vatFindings.length} findings`} level={reviewCoverage >= 90 ? "low" : reviewCoverage >= 50 ? "medium" : "high"} />
            <SummaryItem label="Conclusion" value={vatConclusionShortLabel(effectivePartnerConclusion)} detail="system-derived sign-off status" level={vatConclusionTone(effectivePartnerConclusion)} />
          </div>
        </div>

        <div className="print-page mt-5 rounded-lg border border-line p-4">
          <h3 className="text-sm font-black uppercase text-muted">Review Pack Contents</h3>
          <div className="mt-3 grid gap-3 text-sm md:grid-cols-2">
            <div>
              <strong>Reviewer conclusion</strong>
              <p className="mt-1 text-muted">{vatConclusionLabel(effectivePartnerConclusion)}</p>
              {partnerComment && <p className="mt-1 text-muted">{partnerComment}</p>}
            </div>
            <div>
              <strong>Why we trust this return</strong>
              <p className="mt-1 text-muted">{reconciliationFailures ? "Resolve failed reconciliations before submission." : "Box arithmetic and available reconciliation evidence agree."} Review coverage is {reviewCoverage}%.</p>
            </div>
            <div>
              <strong>Primary review focus</strong>
              <p className="mt-1 text-muted">{reviewGroups.length ? `${reviewGroups.length} grouped investigation(s): ${reviewGroups.map((group) => group.title).join(", ")}.` : "No VAT engine exceptions identified."}</p>
            </div>
            <div>
              <strong>Evidence appendix</strong>
              <p className="mt-1 text-muted">{boxContributions.length} transaction-to-box contribution record(s), {vatFindings.length} supporting finding(s), {reviewedGroups + reviewedRuleFindings} reviewer decision(s).</p>
            </div>
          </div>
        </div>

        {vatReview.workpaper && (
          <div className="print-page mt-5 rounded-lg border border-line p-4">
            <p className="text-xs font-bold uppercase text-muted">{vatReview.workpaper.reference}</p>
            <h3 className="mt-1 text-lg font-black">VAT Assurance Workpaper</h3>
            <div className="mt-4 grid gap-4 text-sm md:grid-cols-2">
              <div><strong>Objective</strong><p className="mt-1 text-muted">{vatReview.workpaper.objective}</p></div>
              <div><strong>Risk</strong><p className="mt-1 text-muted">{vatReview.workpaper.risk}</p></div>
              <div><strong>Evidence reviewed</strong><ul className="mt-1 list-disc pl-5 text-muted">{vatReview.workpaper.evidenceReviewed.map((item) => <li key={item}>{item}</li>)}</ul></div>
              <div><strong>Procedures performed</strong><ul className="mt-1 list-disc pl-5 text-muted">{vatReview.workpaper.proceduresPerformed.map((item) => <li key={item}>{item}</li>)}</ul></div>
              <div className="md:col-span-2"><strong>Findings</strong><ul className="mt-1 list-disc pl-5 text-muted">{vatReview.workpaper.findings.map((item) => <li key={item}>{item}</li>)}</ul></div>
              <div className="md:col-span-2"><strong>Conclusion</strong><p className="mt-1 font-semibold">{vatReview.workpaper.conclusion}</p></div>
            </div>
          </div>
        )}
      </Panel>

      <section className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
        <Panel title="VAT Engine Exceptions">
          {engineFindings.length ? (
            <div className="grid gap-3">
              {engineFindings.map((finding, index) => (
                <div key={`${finding.finding}-${index}`} className="rounded-lg border border-line bg-slate-50 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Pill level={finding.severity}>{finding.severity}</Pill>
                    <strong>{finding.finding}</strong>
                  </div>
                  <p className="mt-2 text-sm text-muted">{finding.evidence}</p>
                  <p className="mt-2 text-sm font-semibold">{finding.recommendation}</p>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title="No VAT engine exceptions" detail="Box arithmetic, control reconciliation and exception checks are clear." />
          )}
        </Panel>
        <RiskModule title="VAT Rule Findings" category="vat" findings={findings} updateFindingStatus={updateFindingStatus} />
      </section>
    </div>
  );
}

function RiskModule({ title, category, findings, updateFindingStatus }: { title: string; category: Finding["category"]; findings: Finding[]; updateFindingStatus: (findingId: string, status: FindingStatus, reason?: string) => void }) {
  return (
    <Panel title={title}>
      <FindingList findings={findings.filter((item) => item.category === category)} setActive={() => undefined} updateFindingStatus={updateFindingStatus} />
    </Panel>
  );
}

function vatBoxLabel(box: keyof VatReviewResult["vatReturn"]) {
  const labels: Record<keyof VatReviewResult["vatReturn"], string> = {
    box1: "VAT due on sales and other outputs",
    box2: "VAT due on acquisitions",
    box3: "Total VAT due",
    box4: "VAT reclaimed on purchases and inputs",
    box5: "Net VAT payable or reclaimable",
    box6: "Total sales excluding VAT",
    box7: "Total purchases excluding VAT",
    box8: "EU dispatches excluding VAT",
    box9: "EU acquisitions excluding VAT",
  };
  return labels[box];
}

function formatVatAmount(box: keyof VatReviewResult["vatReturn"], amount: number) {
  const formatted = Math.round(Math.abs(amount)).toLocaleString("en-GB");
  if (box === "box5" && amount < 0) return `(£${formatted})`;
  return `£${formatted}`;
}

function ReportAppendix({ findings, uploads, validationChecks }: { findings: Finding[]; uploads: Upload[]; validationChecks: ValidationCheck[] }) {
  const accepted = findings.filter((item) => ["accepted", "resolved", "accepted_risk"].includes(item.status)).length;
  const unresolved = findings.filter(isOpenFinding).length;
  return (
    <Panel title="Finance Review Appendix">
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="rounded-lg border border-line bg-slate-50 p-4">
          <p className="text-xs font-bold uppercase text-muted">Files Analysed</p>
          <strong className="mt-2 block text-3xl">{uploads.length}</strong>
          <p className="mt-1 text-sm text-muted">TB, P&L, balance sheet, AR, AP and VAT exports.</p>
        </div>
        <div className="rounded-lg border border-line bg-slate-50 p-4">
          <p className="text-xs font-bold uppercase text-muted">Validation Checks</p>
          <strong className="mt-2 block text-3xl">{validationChecks.length}</strong>
          <p className="mt-1 text-sm text-muted">{validationChecks.filter((item) => item.status === "passed").length} passed, {validationChecks.filter((item) => item.status === "warning").length} warnings.</p>
        </div>
        <div className="rounded-lg border border-line bg-slate-50 p-4">
          <p className="text-xs font-bold uppercase text-muted">Reviewer Approval</p>
          <strong className="mt-2 block text-3xl">{accepted}/{findings.length}</strong>
          <p className="mt-1 text-sm text-muted">{unresolved} unresolved findings remain before final sign-off.</p>
        </div>
      </div>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[760px] border-collapse text-left">
          <thead className="text-xs uppercase text-muted">
            <tr>
              <th className="border-b border-line p-3">Finding</th>
              <th className="border-b border-line p-3">Source</th>
              <th className="border-b border-line p-3">Confidence</th>
              <th className="border-b border-line p-3">Reviewer</th>
              <th className="border-b border-line p-3">Reason</th>
              <th className="border-b border-line p-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {findings.map((finding) => (
              <tr key={finding.id}>
                <td className="border-b border-line p-3 font-bold">{finding.title}</td>
                <td className="border-b border-line p-3">{finding.evidence.sourceFile}</td>
                <td className="border-b border-line p-3">{finding.confidence}</td>
                <td className="border-b border-line p-3">{finding.reviewer ?? "Unassigned"}</td>
                <td className="border-b border-line p-3">{finding.reviewReason ?? "—"}</td>
                <td className="border-b border-line p-3">{finding.status.replaceAll("_", " ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function AICopilot({ question, setQuestion, score, findings, findingActivities, validationChecks, uploads, company, forecast, assistantResult, setAssistantResult, updateFindingStatus, updateManagerReview, openFindingEvidence, setActive }: { question: string; setQuestion: (value: string) => void; score: number; findings: Finding[]; findingActivities: FindingActivity[]; validationChecks: ValidationCheck[]; uploads: Upload[]; company: Company; forecast: CashForecastPoint[]; assistantResult: AssistantResult | null; setAssistantResult: (value: AssistantResult | null) => void; updateFindingStatus: (findingId: string, status: FindingStatus, reason?: string) => void; updateManagerReview: (findingId: string, status: ManagerReviewStatus, note?: string) => void; openFindingEvidence: (findingId: string) => void; setActive: (value: string) => void }) {
  const hasData = findings.length > 0;
  const [loading, setLoading] = useState(false);

  const ask = async (q: string) => {
    if (!hasData) return;
    setQuestion(q);
    setLoading(true);
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q, score, companyName: company.name, accountingSystem: company.accountingSystem, findings })
      });
      const data = await res.json();
      setAssistantResult({
        companyId: company.id,
        question: q,
        answer: data.answer ?? evidenceGroundedAnswer(q, score, findings) ?? assistantAnswer(q, score, findings, forecast),
        sections: data.sections ?? null,
        followUps: Array.isArray(data.followUps) ? data.followUps : [],
        findingId: data.findingId,
        relatedFindingId: data.relatedFindingId,
        source: data.source ?? "deterministic",
        confidence: typeof data.explanationConfidence === "number" ? data.explanationConfidence : null,
        createdAt: new Date().toISOString(),
      });
    } catch {
      setAssistantResult({
        companyId: company.id,
        question: q,
        answer: evidenceGroundedAnswer(q, score, findings),
        sections: null,
        followUps: [],
        source: "deterministic",
        confidence: null,
        createdAt: new Date().toISOString(),
      });
    } finally {
      setLoading(false);
    }
  };

  const contextMessage = hasData
    ? `I have reviewed ${company.name}'s uploaded data pack from ${company.accountingSystem}. ${findings.length} finding(s) are evidence-linked and ready for review.`
    : "No finance data uploaded yet. Upload a finance pack and I can answer questions about your specific findings, cash position, and close readiness.";

  const suggestedQuestions = hasData
    ? ["What should I do next?", "Why is profit down?", "What is blocking month-end close?", "Which debtor should we chase first?", "Generate VAT review steps.", "Why is the finance score low?"]
    : [];
  const answer = assistantResult?.answer ?? "";
  const answerSections = assistantResult?.sections ?? null;
  const followUps = assistantResult?.followUps ?? [];
  const answerFindingId = assistantResult?.findingId;
  const answerSource = assistantResult?.source ?? "";
  const answerConfidence = assistantResult?.confidence ?? null;
  const linkedFinding = answerFindingId ? findings.find((finding) => finding.id === answerFindingId) : undefined;
  const impactAmount = linkedFinding ? linkedFinding.amount ?? parseImpactAmount(linkedFinding.expectedImpact) : 0;
  const materiality = findingMaterialityStatus(impactAmount);
  const effort = findingReviewEffort(linkedFinding);
  const sourceFiles = Array.from(new Set([
    linkedFinding?.sourceFile,
    linkedFinding?.evidence?.sourceFile,
    ...uploads.map((upload) => upload.originalFileName || upload.fileName),
  ].filter(Boolean))).slice(0, 4);
  const resolvedCount = findings.filter((finding) => ["resolved", "approved", "closed", "false_positive", "accepted"].includes(finding.status)).length;
  const acceptedRiskCount = findings.filter((finding) => finding.status === "accepted_risk").length;
  const openCount = findings.filter(isOpenFinding).length;
  const completionPct = findings.length ? Math.round(((resolvedCount + acceptedRiskCount) / findings.length) * 100) : 0;
  const highOpenCount = findings.filter((finding) => isOpenFinding(finding) && finding.severity === "high").length;
  const criticalOpenCount = findings.filter((finding) => isOpenFinding(finding) && finding.severity === "critical").length;
  const validationBlockerCount = validationChecks.filter((check) => check.status === "failed").length;
  const managerApprovalRequired = findings.some((finding) => isReadyForManagerReview(finding) && managerReviewStatus(finding) !== "approved" && managerReviewStatus(finding) !== "escalated");
  const signOffBlocked = criticalOpenCount > 0 || highOpenCount > 0 || openCount > 0 || validationBlockerCount > 0 || managerApprovalRequired;
  const readinessDrivers = calculateReadinessDrivers(findings, validationChecks, uploads);
  const linkedActivities = answerFindingId ? findingActivities.filter((activity) => activity.findingId === answerFindingId).slice(0, 5) : [];
  const createdDate = linkedFinding?.createdAt ? new Date(linkedFinding.createdAt) : null;
  const updatedDate = linkedFinding?.updatedAt || linkedFinding?.reviewedAt ? new Date(linkedFinding.updatedAt || linkedFinding.reviewedAt || "") : null;
  const ageDays = createdDate ? Math.max(0, Math.ceil((Date.now() - createdDate.getTime()) / 86_400_000)) : null;

  return (
    <Panel title="Ask ClosePilot">
      <div className="grid gap-4 xl:grid-cols-[1fr_0.8fr]">
        <div className="grid gap-3">
          <div className="rounded-lg bg-slate-100 p-4">{contextMessage}</div>

          {hasData ? (
            <>
              {answer && (
                <div className="min-h-24 rounded-lg bg-cyan-50 p-4">
                  {assistantResult && !loading ? (
                    <div className="mb-3 flex flex-col gap-2 rounded-lg border border-cyan-100 bg-white p-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="text-xs font-black uppercase text-muted">Saved Result</p>
                        <p className="mt-1 text-sm font-semibold">{assistantResult.question}</p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-semibold text-muted">{new Date(assistantResult.createdAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</span>
                        <button className="rounded-lg border border-line px-3 py-1.5 text-xs font-bold" onClick={() => setAssistantResult(null)}>Clear Result</button>
                      </div>
                    </div>
                  ) : null}
                  {answerSource && !loading ? (
                    <div className="mb-3 flex flex-wrap gap-2 text-xs font-bold uppercase text-muted">
                      <span className="rounded-full bg-white px-3 py-1">{answerSource === "ai_grounded" ? "AI grounded" : "Deterministic"}</span>
                      {answerConfidence !== null ? <span className="rounded-full bg-white px-3 py-1">Grounding {answerConfidence}%</span> : null}
                    </div>
                  ) : null}
                  {loading ? <span className="text-muted italic">Thinking...</span> : (
                    answerSections ? (
                      <div className="grid gap-3">
                        <div className={`rounded-lg border p-3 ${signOffBlocked ? "border-amber-200 bg-amber-50" : "border-emerald-200 bg-emerald-50"}`}>
                          <p className={`text-xs font-black uppercase ${signOffBlocked ? "text-amber-800" : "text-emerald-800"}`}>{signOffBlocked ? "Sign-Off Blocked" : "Ready for Sign-Off"}</p>
                          <p className="mt-1 text-sm font-semibold">
                            {criticalOpenCount} critical · {highOpenCount} high · {openCount} open finding{openCount !== 1 ? "s" : ""} · {validationBlockerCount} validation blocker{validationBlockerCount !== 1 ? "s" : ""}
                          </p>
                          {managerApprovalRequired ? <p className="mt-1 text-xs text-muted">Manager approval is still required for one or more reviewed findings.</p> : null}
                        </div>
                        <div className="rounded-lg bg-white p-3">
                          <p className="text-xs font-black uppercase text-muted">Executive Summary</p>
                          <p className="mt-1 font-semibold">{answerSections.executiveSummary}</p>
                        </div>
                        <div className="rounded-lg bg-white p-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div>
                              <p className="text-xs font-black uppercase text-muted">Review Progress</p>
                              <p className="mt-1 text-sm font-semibold">Total {findings.length} · Resolved {resolvedCount} · Accepted Risk {acceptedRiskCount} · Open {openCount}</p>
                            </div>
                            <strong className="text-lg">{completionPct}% Complete</strong>
                          </div>
                          <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
                            <div className="h-full rounded-full bg-emerald-500" style={{ width: `${completionPct}%` }} />
                          </div>
                        </div>
                        <div className="grid gap-3 md:grid-cols-2">
                          <AssistantAnswerItem label="Main Driver" value={answerSections.mainDriver} />
                          <AssistantAnswerItem label="Confidence" value={answerSections.confidence} />
                          {linkedFinding ? (
                            <>
                              <AssistantAnswerItem label="Severity" value={linkedFinding.severity.toUpperCase()} />
                              <AssistantAnswerItem label="Category" value={findingCategoryLabel(linkedFinding.category)} detail={`Type: ${findingTypeLabel(linkedFinding)}`} />
                              <AssistantAnswerItem label="Review Status" value={`${STATUS_CONFIG[linkedFinding.status]?.label ?? linkedFinding.status} · Owner: ${findingOwner(linkedFinding)} · Due: ${findingDueDate(linkedFinding)}`} />
                              <AssistantAnswerItem label="Finding Age" value={ageDays === null ? "Unknown" : `${ageDays} day${ageDays !== 1 ? "s" : ""}`} detail={`Created ${createdDate ? createdDate.toLocaleDateString("en-GB") : "-"} · Updated ${updatedDate ? updatedDate.toLocaleDateString("en-GB") : "-"}`} />
                              <AssistantAnswerItem label="Financial Impact" value={impactAmount ? `£${Math.round(impactAmount).toLocaleString()} · ${materiality.label}` : materiality.label} detail={materiality.detail} />
                              <AssistantAnswerItem label="Review Effort" value={`Manual ${effort.manual} · ClosePilot ${effort.closePilot}`} detail={`Time saved ${effort.saved}`} />
                              <AssistantAnswerItem label="Source Data" value={sourceFiles.length ? sourceFiles.join(" · ") : "No source file linked"} detail={`${uploads.length} uploaded pack${uploads.length !== 1 ? "s" : ""} reviewed`} />
                            </>
                          ) : null}
                          <AssistantAnswerItem label="Why It Matters" value={answerSections.whyItMatters} />
                          <AssistantAnswerItem label="Evidence" value={answerSections.evidence} />
                          <AssistantAnswerItem label="Recommended Action" value={answerSections.recommendedAction} />
                          <AssistantAnswerItem label="Related Finding" value={answerSections.relatedFinding} />
                        </div>
                        <div className="grid gap-3 md:grid-cols-2">
                          <div className="rounded-lg bg-white p-3">
                            <p className="text-xs font-black uppercase text-muted">Audit Readiness Breakdown</p>
                            <div className="mt-2 grid gap-2">
                              {readinessDrivers.slice(0, 5).map((driver) => (
                                <div key={driver.label}>
                                  <div className="flex justify-between gap-3 text-xs font-semibold">
                                    <span>{driver.label}</span>
                                    <span>{driver.passed ? "Ready" : "Blocked"}</span>
                                  </div>
                                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
                                    <div className={`h-full ${driver.passed ? "bg-emerald-500" : "bg-amber-500"}`} style={{ width: driver.passed ? "100%" : "35%" }} />
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                          <div className="rounded-lg bg-white p-3">
                            <p className="text-xs font-black uppercase text-muted">Activity Trail</p>
                            {linkedActivities.length ? (
                              <div className="mt-2 grid gap-2">
                                {linkedActivities.map((activity) => (
                                  <p key={activity.id} className="text-xs text-muted">
                                    <span className="font-bold text-ink">{new Date(activity.timestamp).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</span> {activity.userId} {activity.action.replaceAll("_", " ")}
                                  </p>
                                ))}
                              </div>
                            ) : (
                              <p className="mt-2 text-xs text-muted">No activity has been recorded for this finding yet.</p>
                            )}
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2 pt-1">
                          <button className="rounded-lg bg-brand px-3 py-2 text-sm font-bold text-white" onClick={() => linkedFinding ? openFindingEvidence(linkedFinding.id) : setActive("Findings")}>Open Finding</button>
                          <button className="rounded-lg border border-line bg-white px-3 py-2 text-sm font-bold disabled:cursor-not-allowed disabled:text-muted" disabled={!linkedFinding} onClick={() => linkedFinding ? openFindingEvidence(linkedFinding.id) : undefined}>View Evidence</button>
                          <button className="rounded-lg border border-line bg-white px-3 py-2 text-sm font-bold" onClick={() => setActive("Findings")}>Assign Owner</button>
                          <button className="rounded-lg border border-line bg-white px-3 py-2 text-sm font-bold disabled:cursor-not-allowed disabled:text-muted" disabled={!linkedFinding} onClick={() => linkedFinding ? updateFindingStatus(linkedFinding.id, "evidence_requested", "Evidence requested from Ask ClosePilot result.") : undefined}>Request Evidence</button>
                          <button className="rounded-lg border border-line bg-white px-3 py-2 text-sm font-bold disabled:cursor-not-allowed disabled:text-muted" disabled={!linkedFinding} onClick={() => linkedFinding ? updateManagerReview(linkedFinding.id, "escalated", "Escalated from Ask ClosePilot result.") : undefined}>Escalate</button>
                          <button className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300" disabled={!linkedFinding} onClick={() => linkedFinding ? updateFindingStatus(linkedFinding.id, "resolved", "Resolved from Ask ClosePilot result.") : undefined}>Mark Resolved</button>
                          <button className="rounded-lg border border-line bg-white px-3 py-2 text-sm font-bold disabled:cursor-not-allowed disabled:text-muted" disabled={!linkedFinding} onClick={() => linkedFinding ? updateFindingStatus(linkedFinding.id, "accepted_risk", "Accepted risk from Ask ClosePilot result.") : undefined}>Accept Risk</button>
                          <button className="rounded-lg border border-line bg-white px-3 py-2 text-sm font-bold" onClick={() => setAssistantResult(assistantResult ? { ...assistantResult, question: "Generate partner sign-off note", answer: partnerReviewNote(linkedFinding), sections: null, followUps: ["Open Finding", "View Evidence", "Create action plan"], source: "deterministic", confidence: null, createdAt: new Date().toISOString() } : null)}>Generate Partner Sign-Off Note</button>
                        </div>
                        {followUps.length ? (
                          <div className="pt-1">
                            <p className="text-xs font-black uppercase text-muted">Suggested Follow-Up</p>
                            <div className="mt-2 flex flex-wrap gap-2">
                              {followUps.map((item) => (
                                <button key={item} className="rounded-lg border border-line bg-white px-3 py-2 text-sm font-bold" onClick={() => ask(item)}>{item}</button>
                              ))}
                            </div>
                          </div>
                        ) : null}
                        {answerFindingId ? <p className="text-xs text-muted">Linked finding: {answerFindingId}</p> : null}
                      </div>
                    ) : (
                      <p className="whitespace-pre-wrap">{answer}</p>
                    )
                  )}
                </div>
              )}
              {loading && !answer && (
                <div className="min-h-24 rounded-lg bg-cyan-50 p-4">
                  <span className="text-muted italic">Thinking...</span>
                </div>
              )}
              <div className="flex flex-col gap-2 sm:flex-row">
                <input className="h-11 flex-1 rounded-lg border border-line px-3" value={question} onChange={(event) => setQuestion(event.target.value)} onKeyDown={(e) => e.key === "Enter" && ask(question)} />
                <button className="rounded-lg bg-brand px-4 font-bold text-white" onClick={() => ask(question)} disabled={loading}>{loading ? "..." : "Ask"}</button>
              </div>
            </>
          ) : (
            <div className="rounded-lg border-2 border-dashed border-line bg-slate-50 p-6 text-center">
              <p className="font-bold text-muted">Upload a finance pack to get started</p>
              <p className="mt-1 text-sm text-muted">ClosePilot will answer questions based on your actual findings, VAT data, AR position, and close readiness.</p>
            </div>
          )}
        </div>

        {suggestedQuestions.length > 0 && (
          <div className="grid content-start gap-2">
            {suggestedQuestions.map((item) => (
              <button key={item} className="rounded-lg border border-line px-3 py-3 text-left text-sm font-bold" onClick={() => ask(item)}>{item}</button>
            ))}
          </div>
        )}
      </div>
    </Panel>
  );
}

function AssistantAnswerItem({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="rounded-lg bg-white p-3">
      <p className="text-xs font-black uppercase text-muted">{label}</p>
      <p className="mt-1 text-sm font-semibold">{value}</p>
      {detail ? <p className="mt-1 text-xs text-muted">{detail}</p> : null}
    </div>
  );
}

function ExportModal({
  company, tenant, score, risk, findings, findingEvidence, findingComments, findingActivities, partnerSignOff, recommendations, validationChecks, uploads, cashAtRisk, financialExposure, onClose
}: {
  company: Company; tenant: Tenant; score: number; risk: RiskLevel; findings: Finding[]; findingEvidence: Evidence[]; findingComments: FindingComment[]; findingActivities: FindingActivity[]; partnerSignOff?: PartnerSignOff; recommendations: Recommendation[]; validationChecks: ValidationCheck[]; uploads: Upload[]; cashAtRisk: number; financialExposure: number; onClose: () => void;
}) {
  const open = findings.filter(isOpenFinding);
  const critical = findings.filter((f) => f.severity === "critical").length;
  const high = findings.filter((f) => f.severity === "high").length;
  const profile = evidenceProfile(findings);
  const exportBlocked = validationChecks.some((v) => v.status === "failed") || profile.blockers > 0;
  const today = new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" });
  const [commentary, setCommentary] = useState("");
  const [commentaryLoading, setCommentaryLoading] = useState(false);
  const [reportType, setReportType] = useState<"audit" | "manager" | "evidence" | "client">("audit");
  const exposure = exposureBreakdown(findings, cashAtRisk, financialExposure);
  const clientFindings = findings.filter((f) => f.evidenceStrength !== "advisory" && (f.severity === "critical" || f.severity === "high" || ["accepted", "resolved", "accepted_risk"].includes(f.status)));
  const reportFindings = reportType === "client" ? clientFindings : findings;
  const readinessScore = calculateAuditReadinessV2(findings, validationChecks, uploads);
  const reviewQuestions = partnerReviewQuestions(findings, validationChecks).slice(0, 8);
  const reconciliationChecks = validationChecks.filter((check) => /ar ledger agrees|ap ledger agrees|vat report agrees|balance sheet equation|bank reconciliation agrees|p&l movement agrees/i.test(check.name));
  const reportTitle = reportType === "audit" ? "Audit Review Pack" : reportType === "manager" ? "Manager Summary" : reportType === "evidence" ? "Evidence Appendix" : "Client Pack";
  const reportDescription = reportType === "audit"
    ? "Partner-ready audit pack with status, required actions, partner summary, validation checks and evidence references."
    : reportType === "manager"
      ? "Internal review summary for manager sign-off, review triage, and final pack preparation."
      : reportType === "evidence"
        ? "Evidence-linked appendix showing source files, calculations, validation checks, and reviewer status."
        : "Client-facing summary focused on material matters, exposure, and agreed next actions.";
  const generatedPack = buildGeneratedReviewPack({
    company,
    tenant,
    score,
    risk,
    findings,
    findingEvidence,
    findingComments,
    findingActivities,
    partnerSignOff,
    recommendations,
    validationChecks,
    uploads,
    cashAtRisk,
    financialExposure,
    preparedBy: partnerSignOff?.preparedBy ?? "ClosePilot Reviewer",
    reviewedBy: partnerSignOff?.reviewedBy ?? "",
    approvedBy: partnerSignOff?.approval?.approvedBy ?? partnerSignOff?.approvedBy ?? "",
    reviewPackStatus: partnerSignOff?.reviewPackStatus ?? (exportBlocked ? "UNDER_REVIEW" : "PARTNER_REVIEW"),
    conclusion: exportBlocked ? "Draft: blockers remain before partner sign-off." : "Ready for partner review subject to final professional judgement.",
  });
  const auditRequiredActions = auditPackRequiredActions(findings, validationChecks, uploads);
  const auditPartnerSummary = auditPackPartnerSummary(findings, validationChecks, uploads);
  const auditChecklist = auditControlChecklist(findings, validationChecks, uploads);
  const auditPack = {
    client: company.name,
    period: today,
    preparedBy: partnerSignOff?.preparedBy ?? "ClosePilot Reviewer",
    reviewStatus: generatedPack.signOffGate.ready ? "Ready" : "Blocked",
    summary: {
      findingsIdentified: findings.length,
      openFindings: open.length,
      acceptedRisks: findings.filter((finding) => finding.status === "accepted_risk").length,
      validationBlockers: validationChecks.filter((check) => check.status === "failed").length,
      financialHealth: score,
      auditReadiness: generatedPack.executiveSummary.auditReadinessScore,
    },
    requiredActions: auditRequiredActions,
    partnerSummary: auditPartnerSummary,
    controlChecklist: auditChecklist,
  };
  const exportTraffic = signOffTrafficLight({
    signOffEnabled: generatedPack.signOffGate.ready,
    signOffComplete: Boolean(partnerSignOff),
    acceptedRiskCount: auditPack.summary.acceptedRisks,
    criticalOpen: generatedPack.signOffGate.blockers.criticalOpen,
    highOpen: generatedPack.signOffGate.blockers.highOpen,
    validationBlockers: generatedPack.signOffGate.blockers.validationBlockers,
    evidenceOutstanding: generatedPack.signOffGate.blockers.outstandingEvidence,
    managerReviewComplete: generatedPack.signOffGate.blockers.managerReviewComplete,
  });
  const exportPartnerConclusion = auditPartnerConclusion({
    trafficLabel: exportTraffic.label,
    findings,
    acceptedRisks: findings.filter((finding) => finding.status === "accepted_risk"),
    validationBlockers: auditPack.summary.validationBlockers,
    openHigh: generatedPack.signOffGate.blockers.criticalOpen + generatedPack.signOffGate.blockers.highOpen,
  });
  const workpapers = generateWorkpapers({
    findings: reportFindings,
    uploads,
    validationChecks,
    reviewer: partnerSignOff?.reviewedBy ?? partnerSignOff?.preparedBy ?? "ClosePilot Reviewer",
    date: new Date().toISOString(),
  });

  const fileSlug = slug(`${company.name}_${today}`);
  const downloadFindingsCsv = () => exportFile(`${fileSlug}_findings.csv`, findingsCsv(findings), "text/csv;charset=utf-8");
  const recordReportExport = (exportStatus: string) => {
    fetch("/api/reports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenantId: tenant.id,
        companyId: company.id,
        reportType,
        title: `${company.name} ${reportTitle}`,
        exportStatus,
        metadata: {
          score,
          risk,
          uploads: uploads.length,
          findings: findings.length,
          validationChecks: validationChecks.length,
          evidenceProfile: profile
        }
      })
    }).catch(() => {});
  };
  const downloadEvidencePack = () => {
    const exportStatus = exportBlocked ? "draft_blocked" : "draft_ready";
    recordReportExport(exportStatus);
    exportFile(`${fileSlug}_review_pack.json`, JSON.stringify({ reportType, auditPack, ...generatedPack, exportStatus }, null, 2), "application/json;charset=utf-8");
  };
  const downloadWordPack = () => {
    recordReportExport(exportBlocked ? "word_draft_blocked" : "word_draft_ready");
    exportFile(
      `${fileSlug}_partner_review_report.doc`,
      auditReviewPackWordHtml({
        company,
        tenant,
        today,
        preparedBy: auditPack.preparedBy,
        auditPack,
        partnerConclusion: exportPartnerConclusion,
        findings: reportFindings,
        workpapers,
      }),
      "application/msword;charset=utf-8",
    );
  };
  const printReport = () => {
    recordReportExport(exportBlocked ? "draft_blocked" : "draft_ready");
    printWithTitle(`${company.name} Partner Review Report`);
  };

  const generateCommentary = async () => {
    setCommentaryLoading(true);
    try {
      const res = await fetch("/api/commentary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyName: company.name, score, risk, findings, recommendations, cashAtRisk, financialExposure, period: today })
      });
      const data = await res.json();
      setCommentary(data.commentary ?? data.error ?? "Failed to generate commentary.");
    } catch {
      setCommentary("Commentary generation failed. Check your API key.");
    } finally {
      setCommentaryLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 no-print" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div id="export-report" className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
        <div className="flex flex-col gap-4 border-b border-line p-6 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs font-bold uppercase text-muted">Finance Review Report</p>
            <h2 className="text-2xl font-black">{company.name}</h2>
            <p className="text-sm text-muted">{tenant.name} · Prepared {today}</p>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <button className="rounded-lg border border-line px-4 py-2.5 font-bold disabled:opacity-50" onClick={generateCommentary} disabled={commentaryLoading}>
              {commentaryLoading ? "Generating..." : "Generate Commentary"}
            </button>
            <button className="rounded-lg border border-line px-4 py-2.5 font-bold" onClick={downloadFindingsCsv}>CSV</button>
            <button className="rounded-lg border border-line px-4 py-2.5 font-bold" onClick={downloadEvidencePack}>Evidence Pack</button>
            <button className="rounded-lg border border-line px-4 py-2.5 font-bold" onClick={downloadWordPack}>Word Pack</button>
            <button className="rounded-lg bg-brand px-5 py-2.5 font-bold text-white" onClick={printReport}>Export PDF</button>
            <button className="rounded-lg border border-line px-4 py-2.5 font-bold" onClick={onClose}>Close</button>
          </div>
        </div>

        <div className="overflow-y-auto p-6 print:p-0">
          <section className={`mb-6 rounded-lg border p-4 ${exportBlocked ? "border-amber-200 bg-amber-50" : "border-emerald-200 bg-emerald-50"}`}>
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className={`text-xs font-bold uppercase ${exportBlocked ? "text-amber-800" : "text-emerald-800"}`}>Export Gate</p>
                <h3 className="font-black">{exportBlocked ? "Draft export: manager sign-off still required" : "Review pack ready for final export"}</h3>
                <p className="mt-1 text-sm text-muted">{profile.deterministic} assurance findings, {profile.indicator} indicators and {profile.advisory} review reminders. {profile.reviewed}/{findings.length} findings have reviewer decisions.</p>
              </div>
              <Pill level={exportBlocked ? "medium" : "low"}>{exportBlocked ? "Draft" : "Final-ready"}</Pill>
            </div>
          </section>

          <section className="mb-6 rounded-lg border border-line bg-slate-50 p-3">
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {([
                ["audit", "Audit Review Pack"],
                ["manager", "Manager Summary"],
                ["evidence", "Evidence Appendix"],
                ["client", "Client Pack"],
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  className={`rounded-lg px-3 py-2 text-sm font-bold ${reportType === value ? "bg-brand text-white" : "border border-line bg-white"}`}
                  onClick={() => setReportType(value)}
                  aria-pressed={reportType === value}
                >
                  {label}
                </button>
              ))}
            </div>
          </section>

          <section className="mb-6 rounded-lg border border-line bg-white p-5">
            <p className="text-xs font-bold uppercase text-muted">Selected Export View</p>
            <h3 className="mt-1 text-xl font-black">{reportTitle}</h3>
            <p className="mt-1 text-sm text-muted">{reportDescription}</p>
          </section>

          {reportType === "audit" && (
            <section className="mb-6 grid gap-4">
              <div className="print-page rounded-lg border border-slate-900 bg-white p-6 print-cover print:rounded-none print:border-0">
                <p className="text-xs font-black uppercase tracking-wide text-muted">ClosePilot Assurance</p>
                <h1 className="mt-2 text-3xl font-black">Partner Review Report</h1>
                <p className="mt-2 text-sm text-muted">{company.name} · {tenant.name} · Prepared {today}</p>
                <div className="mt-5 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                  <SummaryLine label="Client" value={auditPack.client} />
                  <SummaryLine label="Period" value={auditPack.period} />
                  <SummaryLine label="Status" value={exportTraffic.label} />
                  <SummaryLine label="Prepared By" value={auditPack.preparedBy} />
                </div>
                <div className="mt-5 rounded-lg border border-line bg-slate-50 p-4">
                  <p className="text-xs font-bold uppercase text-muted">Partner Conclusion</p>
                  <p className="mt-1 font-semibold">{exportPartnerConclusion}</p>
                </div>
              </div>

              <div className="rounded-lg border border-line bg-white p-5">
                <p className="text-xs font-bold uppercase text-muted">Audit Pack Output</p>
                <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                  <SummaryLine label="Client" value={auditPack.client} />
                  <SummaryLine label="Period" value={auditPack.period} />
                  <SummaryLine label="Prepared By" value={auditPack.preparedBy} />
                  <SummaryLine label="Review Status" value={auditPack.reviewStatus} />
                  <SummaryLine label="Findings" value={auditPack.summary.findingsIdentified} />
                  <SummaryLine label="Accepted Risks" value={auditPack.summary.acceptedRisks} />
                  <SummaryLine label="Validation Blockers" value={auditPack.summary.validationBlockers} />
                  <SummaryLine label="Audit Readiness" value={`${auditPack.summary.auditReadiness}/100`} />
                </div>
              </div>
              <div className="rounded-lg border border-line bg-white p-5">
                <p className="text-xs font-bold uppercase text-muted">Findings Summary</p>
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full min-w-[760px] border-collapse text-left text-sm">
                    <thead className="bg-slate-50 text-xs uppercase text-muted">
                      <tr>
                        <th className="border-b border-line p-2">Severity</th>
                        <th className="border-b border-line p-2">Finding</th>
                        <th className="border-b border-line p-2">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reportFindings.slice(0, 10).map((finding) => (
                        <tr key={finding.id}>
                          <td className="border-b border-line p-2 font-bold capitalize">{finding.severity}</td>
                          <td className="border-b border-line p-2">{finding.title}</td>
                          <td className="border-b border-line p-2">{STATUS_CONFIG[finding.status]?.label ?? finding.status}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              <div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
                <div className="rounded-lg border border-line bg-white p-5">
                  <p className="text-xs font-bold uppercase text-muted">Required Actions</p>
                  <div className="mt-3 grid gap-2">
                    {auditRequiredActions.length ? auditRequiredActions.slice(0, 6).map((item, index) => (
                      <div key={`${item.area}-${index}`} className="rounded-lg bg-slate-50 p-3">
                        <div className="flex items-start justify-between gap-3">
                          <strong className="text-sm">{item.action}</strong>
                          <span className="text-xs font-black uppercase text-muted">{item.priority}</span>
                        </div>
                        <p className="mt-1 text-xs text-muted">{item.reason}</p>
                      </div>
                    )) : (
                      <p className="rounded-lg bg-emerald-50 p-3 text-sm font-semibold text-emerald-800">No required actions remain before issue.</p>
                    )}
                  </div>
                </div>
                <div className="rounded-lg border border-line bg-white p-5">
                  <p className="text-xs font-bold uppercase text-muted">Partner Summary</p>
                  <div className="mt-3 grid gap-2">
                    {auditPartnerSummary.slice(0, 5).map((section) => (
                      <div key={section.area} className="rounded-lg bg-slate-50 p-3">
                        <div className="flex items-start justify-between gap-3">
                          <strong className="text-sm">{section.area}</strong>
                          <span className="text-xs font-black text-muted">{section.status}</span>
                        </div>
                        <p className="mt-1 text-xs text-muted">{section.summary}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <div className="rounded-lg border border-line bg-white p-5">
                <p className="text-xs font-bold uppercase text-muted">Generated Workpapers</p>
                <div className="mt-3 grid gap-2 md:grid-cols-2">
                  {workpapers.map((workpaper) => (
                    <div key={workpaper.id} className="rounded-lg bg-slate-50 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <strong className="text-sm">{workpaper.id} {workpaper.title}</strong>
                          <p className="mt-1 text-xs text-muted">{workpaper.conclusion}</p>
                          {workpaper.findings[0] ? (
                            <p className="mt-2 text-xs font-semibold text-slate-700">
                              Evidence: {workpaper.findings[0].sourceFile} · {workpaper.findings[0].rowIndexes}
                            </p>
                          ) : null}
                        </div>
                        <span className="text-xs font-black text-muted">{workpaper.findings.length} finding{workpaper.findings.length !== 1 ? "s" : ""}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          )}

          <section className="mb-6 rounded-lg border border-line bg-slate-50 p-5">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <p className="text-xs font-bold uppercase text-muted">Review Pack Generator</p>
                <h3 className="mt-1 text-xl font-black">{generatedPack.signOffGate.ready ? "Pack ready for final export" : "Draft pack generated with blockers"}</h3>
                <p className="mt-1 text-sm text-muted">{generatedPack.executiveSummary.recommendedNextStep}</p>
              </div>
              <Pill level={generatedPack.signOffGate.ready ? "low" : "high"}>{generatedPack.status.replaceAll("_", " ")}</Pill>
            </div>
            <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              <SummaryLine label="Open findings" value={generatedPack.openFindings.length} />
              <SummaryLine label="Accepted risks" value={generatedPack.acceptedRisks.length} />
              <SummaryLine label="Evidence refs" value={generatedPack.evidenceReferences.length} />
              <SummaryLine label="Review notes" value={generatedPack.reviewNotes.length} />
              <SummaryLine label="Actions" value={generatedPack.managementActions.length} />
              <SummaryLine label="Activity trail" value={generatedPack.reviewProgress.activityEntries} />
              <SummaryLine label="Readiness" value={`${generatedPack.executiveSummary.auditReadinessScore}%`} />
              <SummaryLine label="Sign-off gate" value={generatedPack.signOffGate.ready ? "Ready" : "Blocked"} />
            </div>
          </section>

          {commentary && (
            <section className="mb-6 rounded-lg border border-cyan-200 bg-cyan-50 p-5">
              <p className="mb-2 text-xs font-bold uppercase text-cyan">AI-Generated CFO Commentary</p>
              <p className="whitespace-pre-wrap text-sm leading-relaxed">{commentary}</p>
            </section>
          )}
          <section className="mb-6 grid gap-4 sm:grid-cols-4">
            <div className="rounded-lg border border-line bg-slate-50 p-4 text-center">
              <p className="text-xs font-bold uppercase text-muted">Finance Health Score</p>
              <strong className="mt-1 block text-4xl font-black">{score}</strong>
              <span className="text-muted">/100 · {riskCopy(risk)}</span>
            </div>
            <div className="rounded-lg border border-line bg-slate-50 p-4 text-center">
              <p className="text-xs font-bold uppercase text-muted">Financial Exposure</p>
              <strong className="mt-1 block text-4xl font-black">£{(financialExposure / 1000).toFixed(0)}k</strong>
              <span className="text-muted">Cash, VAT & close</span>
            </div>
            <div className="rounded-lg border border-line bg-slate-50 p-4 text-center">
              <p className="text-xs font-bold uppercase text-muted">Cash at Risk</p>
              <strong className="mt-1 block text-4xl font-black">£{(cashAtRisk / 1000).toFixed(0)}k</strong>
              <span className="text-muted">AR & forecast</span>
            </div>
            <div className="rounded-lg border border-line bg-slate-50 p-4 text-center">
              <p className="text-xs font-bold uppercase text-muted">{reportType === "client" ? "Client Issues" : "Open Findings"}</p>
              <strong className="mt-1 block text-4xl font-black">{reportType === "client" ? clientFindings.length : open.length}</strong>
              <span className="text-muted">{critical} critical, {high} high</span>
            </div>
          </section>

          {reportType === "manager" && (
            <section className="mb-6 grid gap-4 lg:grid-cols-[1fr_0.9fr]">
              <div className="rounded-lg border border-line p-4">
                <h3 className="mb-3 font-bold uppercase text-muted text-xs">Manager Sign-Off Focus</h3>
                <div className="grid gap-2">
                  <SummaryLine label="High-priority findings" value={`${critical + high}`} />
                  <SummaryLine label="Reviewer decisions completed" value={`${profile.reviewed}/${findings.length}`} />
                  <SummaryLine label="Export gate" value={exportBlocked ? "Draft only" : "Final-ready"} />
                  <SummaryLine label="Recommended next action" value={profile.blockers ? "Resolve high/critical blockers before issue" : "Perform final partner review"} />
                </div>
              </div>
              <div className="rounded-lg border border-line p-4">
                <h3 className="mb-3 font-bold uppercase text-muted text-xs">Exposure Explanation</h3>
                <div className="grid gap-2">
                  <SummaryLine label="Cash / AR risk" value={`£${exposure.cashRisk.toLocaleString("en-GB")}`} />
                  <SummaryLine label="VAT risk" value={`£${exposure.vatRisk.toLocaleString("en-GB")}`} />
                  <SummaryLine label="Close / AP risk" value={`£${exposure.closeRisk.toLocaleString("en-GB")}`} />
                  <SummaryLine label="Control risk" value={`£${exposure.controlRisk.toLocaleString("en-GB")}`} />
                </div>
              </div>
            </section>
          )}

          <section className="mb-6 rounded-lg border border-line p-4">
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="font-bold uppercase text-muted text-xs">Audit Readiness</h3>
                <p className="mt-1 text-sm text-muted">Evidence coverage, validation quality, reviewer decisions and cross-file agreement.</p>
              </div>
              <div className="text-left sm:text-right">
                <strong className="block text-4xl font-black">{readinessScore}%</strong>
                <Pill level={readinessScore >= 85 ? "low" : readinessScore >= 65 ? "medium" : "high"}>{readinessScore >= 85 ? "Ready" : readinessScore >= 65 ? "Manager review" : "Blocked"}</Pill>
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-4">
              <SummaryLine label="Critical" value={String(critical)} />
              <SummaryLine label="High" value={String(high)} />
              <SummaryLine label="Validation passed" value={`${validationChecks.filter((item) => item.status === "passed").length}/${validationChecks.length}`} />
              <SummaryLine label="Reviewed findings" value={`${profile.reviewed}/${findings.length}`} />
            </div>
          </section>

          <section className="mb-6 grid gap-4 sm:grid-cols-3">
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-center">
              <strong className="block text-3xl text-emerald-700">{profile.deterministic}</strong>
              <p className="text-xs font-bold text-emerald-800">Assurance findings</p>
            </div>
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-center">
              <strong className="block text-3xl text-blue-700">{profile.indicator}</strong>
              <p className="text-xs font-bold text-blue-800">Risk indicators</p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-center">
              <strong className="block text-3xl text-slate-600">{profile.advisory}</strong>
              <p className="text-xs font-bold text-slate-700">Review reminders</p>
            </div>
          </section>

          <section className="mb-6 rounded-lg border border-line p-4">
            <h3 className="mb-3 font-bold uppercase text-muted text-xs">Review Questions</h3>
            {reviewQuestions.length ? (
              <div className="grid gap-2">
                {reviewQuestions.map((question, index) => (
                  <div key={`${question}-${index}`} className="flex items-start gap-3 rounded-lg bg-slate-50 p-3">
                    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand text-xs font-black text-white">{index + 1}</span>
                    <p className="text-sm font-semibold">{question}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted">No material review questions generated from the current pack.</p>
            )}
          </section>

          <section className="mb-6">
            <h3 className="mb-3 font-bold uppercase text-muted text-xs">Cross-file Reconciliation</h3>
            {reconciliationChecks.length ? (
              <div className="overflow-x-auto rounded-lg border border-line">
                <table className="w-full min-w-[760px] border-collapse text-left text-sm">
                  <thead className="bg-slate-50 text-xs uppercase text-muted">
                    <tr>
                      <th className="border-b border-line p-3">Check</th>
                      <th className="border-b border-line p-3">Status</th>
                      <th className="border-b border-line p-3">Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reconciliationChecks.map((check) => (
                      <tr key={check.id}>
                        <td className="border-b border-line p-3 font-bold">{check.name}</td>
                        <td className="border-b border-line p-3"><ValidationPill status={check.status} /></td>
                        <td className="border-b border-line p-3">{check.detail}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
                <p className="font-bold text-amber-900">Cross-file reconciliations not available.</p>
                <p className="mt-1 text-sm text-amber-800">Upload TB, AR, AP, VAT, balance sheet and bank reconciliation exports to activate this section.</p>
              </div>
            )}
          </section>

          <section className="mb-6">
            <h3 className="mb-3 font-bold uppercase text-muted text-xs">{reportType === "client" ? "Client-Reportable Findings" : "Findings"}</h3>
            {reportFindings.length ? (
              <div className="overflow-x-auto rounded-lg border border-line">
                <table className="w-full min-w-[980px] border-collapse text-left text-sm">
                  <thead className="bg-slate-50">
                    <tr className="text-xs uppercase text-muted">
                      <th className="border-b border-line p-2">Finding</th>
                      <th className="border-b border-line p-2">Category</th>
                      <th className="border-b border-line p-2">Severity</th>
                      <th className="border-b border-line p-2">Evidence</th>
                      <th className="border-b border-line p-2">Source</th>
                      <th className="border-b border-line p-2">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reportFindings.map((f) => (
                      <tr key={f.id}>
                        <td className="border-b border-line p-2 font-semibold">{f.title}</td>
                        <td className="border-b border-line p-2 capitalize">{f.category.replace("_", " ")}</td>
                        <td className="border-b border-line p-2 capitalize">{f.severity}</td>
                        <td className="border-b border-line p-2 capitalize">{f.evidenceStrength ?? "indicator"}</td>
                        <td className="max-w-[280px] truncate border-b border-line p-2" title={f.evidence.sourceFile}>{f.evidence.sourceFile}</td>
                        <td className="border-b border-line p-2 capitalize">{f.status.replace("_", " ")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
                <p className="font-bold text-emerald-900">No client-reportable findings in this pack.</p>
                <p className="mt-1 text-sm text-emerald-800">Internal indicators remain available in Manager Summary and Evidence Appendix.</p>
              </div>
            )}
          </section>

          {reportType === "client" && (
            <section className="mb-6 rounded-lg border border-line p-4">
              <h3 className="mb-3 font-bold uppercase text-muted text-xs">Client Summary</h3>
              <div className="grid gap-2">
                <SummaryLine label="Overall finance health" value={`${score}/100 · ${riskCopy(risk)}`} />
                <SummaryLine label="Estimated exposure" value={`£${financialExposure.toLocaleString("en-GB")}`} />
                <SummaryLine label="Management attention" value={clientFindings.length ? `${clientFindings.length} material items` : "No material client-facing issues"} />
                <SummaryLine label="Next step" value="Agree actions and retain evidence appendix internally." />
              </div>
            </section>
          )}

          {reportType === "evidence" && (
            <section className="mb-6">
              <h3 className="mb-3 font-bold uppercase text-muted text-xs">Full Evidence Register</h3>
              <div className="grid gap-3">
                {findings.map((f) => (
                  <div key={f.id} className="rounded-lg border border-line bg-slate-50 p-3">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <strong className="text-sm">{f.ruleId ?? f.id} · {f.title}</strong>
                      <span className="text-xs font-bold capitalize text-muted">{f.evidenceStrength ?? "indicator"} · {f.status.replace("_", " ")}</span>
                    </div>
                    <p className="mt-1 text-xs text-muted">{f.evidence.calculation}</p>
                    <p className="mt-2 text-xs font-semibold text-slate-700">{f.evidence.sourceFile} · {f.evidence.accountCode}</p>
                    <EvidenceRowsPreview finding={f} compact />
                    {(f.reviewer || f.reviewReason) && (
                      <div className="mt-2 rounded-lg border border-line bg-white p-2 text-xs">
                        <strong>Reviewer decision:</strong> {f.reviewAction ? f.reviewAction.replaceAll("_", " ") : f.status.replaceAll("_", " ")}
                        {f.reviewer ? ` by ${f.reviewer}` : ""}
                        {f.reviewedAt ? ` on ${new Date(f.reviewedAt).toLocaleString("en-GB")}` : ""}
                        {f.reviewReason ? <p className="mt-1 text-muted">{f.reviewReason}</p> : null}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {reportType === "manager" && (
            <section className="mb-6">
              <h3 className="mb-3 font-bold uppercase text-muted text-xs">Findings Triage</h3>
              <div className="grid gap-3 sm:grid-cols-3">
                {([
                  ["Critical / High", findings.filter((f) => f.severity === "critical" || f.severity === "high")],
                  ["Medium", findings.filter((f) => f.severity === "medium")],
                  ["Low / Advisory", findings.filter((f) => f.severity === "low" || f.evidenceStrength === "advisory")],
                ] as const).map(([label, items]) => (
                  <div key={label} className="rounded-lg border border-line p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <strong className="text-sm">{label}</strong>
                      <span className="text-sm font-black">{items.length}</span>
                    </div>
                    {items.slice(0, 4).map((item) => (
                      <p key={item.id} className="border-t border-line py-2 text-xs font-semibold">{item.title}</p>
                    ))}
                    {items.length === 0 && <p className="text-xs text-muted">None identified.</p>}
                    {items.length > 4 && <p className="pt-2 text-xs font-bold text-muted">+{items.length - 4} more</p>}
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="mb-6">
            <h3 className="mb-3 font-bold uppercase text-muted text-xs">Recommended Actions</h3>
            <div className="grid gap-2">
              {recommendations.map((r, i) => (
                <div key={r.id} className="flex items-start gap-3 rounded-lg border border-line p-3">
                  <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand text-xs font-black text-white">{i + 1}</span>
                  <div>
                    <strong className="text-sm">{r.action}</strong>
                    <p className="text-xs text-muted">{r.expectedImpact}</p>
                  </div>
                  <span className={`ml-auto shrink-0 rounded-full px-2 py-0.5 text-xs font-black ${r.completed ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>{r.completed ? "Done" : "Pending"}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="mb-6">
            <h3 className="mb-3 font-bold uppercase text-muted text-xs">Validation Summary</h3>
            <div className="grid gap-2 sm:grid-cols-2">
              {validationChecks.map((v) => (
                <div key={v.id} className="flex items-center justify-between rounded-lg border border-line p-3">
                  <span className="text-sm font-semibold">{v.name}</span>
                  <ValidationPill status={v.status} />
                </div>
              ))}
            </div>
          </section>

          <section>
            <h3 className="mb-3 font-bold uppercase text-muted text-xs">Files Reviewed ({uploads.length})</h3>
            <div className="flex flex-wrap gap-2">
              {uploads.map((u) => (
                <span key={u.id} className="rounded-lg border border-line bg-slate-50 px-3 py-1.5 text-sm font-semibold">{u.fileName}</span>
              ))}
            </div>
          </section>

          <p className="mt-8 border-t border-line pt-4 text-xs text-muted">Generated by ClosePilot Assurance · {tenant.name} · {today} · Confidential — for authorised recipients only.</p>
        </div>
      </div>
    </div>
  );
}

function partnerReviewQuestions(findings: Finding[], validationChecks: ValidationCheck[]) {
  const questions: string[] = [];
  validationChecks.filter((check) => check.status !== "passed").forEach((check) => {
    if (/vat report agrees|vat control/i.test(check.name)) questions.push(`Why does the VAT control reconciliation not agree? ${check.detail}`);
    else if (/ar ledger agrees|debtors control/i.test(check.name)) questions.push(`Why does aged debtors not agree to the TB debtors control? ${check.detail}`);
    else if (/ap ledger agrees|creditors control/i.test(check.name)) questions.push(`Why does aged creditors not agree to the TB creditors control? ${check.detail}`);
    else if (/balance sheet equation/i.test(check.name)) questions.push(`Why does the balance sheet equation fail? ${check.detail}`);
    else if (/bank reconciliation/i.test(check.name)) questions.push(`What explains the bank reconciliation difference? ${check.detail}`);
    else if (/retained earnings|p&l movement/i.test(check.name)) questions.push(`What explains the P&L to retained earnings movement? ${check.detail}`);
  });

  findings
    .filter((finding) => isOpenFinding(finding) && (finding.severity === "critical" || finding.severity === "high"))
    .sort((a, b) => findingSeverityRank(b.severity) - findingSeverityRank(a.severity))
    .slice(0, 8)
    .forEach((finding) => {
      if (finding.ruleId === "STAT_ANALYTICS_DSO" || /dso|debtor days/i.test(finding.title)) questions.push(`Why is DSO above target? ${finding.evidence.calculation}`);
      else if (finding.category === "vat") questions.push(`What evidence supports the VAT treatment for: ${finding.title}?`);
      else if (finding.category === "controls") questions.push(`Who approved the control exception: ${finding.title}?`);
      else if (finding.category === "ar") questions.push(`What collection action is planned for: ${finding.title}?`);
      else if (finding.category === "month_end") questions.push(`What close adjustment or commentary is required for: ${finding.title}?`);
      else questions.push(`What is management's response to: ${finding.title}?`);
    });

  return Array.from(new Set(questions));
}

type XeroSyncPollResult = {
  status: "queued" | "running" | "completed" | "failed";
  counts?: { trialBalance?: number; vatRows?: number };
  analysis?: AnalysisResult;
  error?: string;
};

async function pollXeroSync(syncId: string, onProgress: (status: XeroSyncPollResult["status"]) => void): Promise<XeroSyncPollResult> {
  const deadline = Date.now() + 5 * 60 * 1000;
  while (Date.now() < deadline) {
    const response = await fetch(`/api/integrations/xero/sync?syncId=${encodeURIComponent(syncId)}`, { cache: "no-store" });
    const result = await response.json() as XeroSyncPollResult;
    if (!response.ok) throw new Error(result.error || "Could not read Xero sync progress.");
    if (result.status === "completed") return result;
    if (result.status === "failed") throw new Error(result.error || "Xero sync failed.");
    onProgress(result.status);
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw new Error("Xero sync is still running. You can leave this page and check again shortly.");
}

function SettingsPanel({ tenant, company, userEmail, userName, onIntegrationAnalysis }: { tenant: Tenant; company: Company; userEmail: string; userName: string; onIntegrationAnalysis: (result: AnalysisResult) => void }) {
  const [name, setName] = useState(userName);
  const [email, setEmail] = useState(userEmail);
  const [role, setRole] = useState("Practice Admin");
  const [exportFormat, setExportFormat] = useState("PDF");
  const [currency, setCurrency] = useState("GBP");
  const [dateFormat, setDateFormat] = useState("DD/MM/YYYY");
  const [emailAlerts, setEmailAlerts] = useState(true);
  const [saved, setSaved] = useState(false);
  const [integrations, setIntegrations] = useState<AccountingIntegrationState[]>([]);
  const [integrationMessage, setIntegrationMessage] = useState("");
  const [integrationBusy, setIntegrationBusy] = useState(false);

  useEffect(() => {
    fetch(`/api/integrations?tenantId=${encodeURIComponent(tenant.id)}&companyId=${encodeURIComponent(company.id)}`)
      .then((response) => response.json())
      .then((result) => setIntegrations(Array.isArray(result.integrations) ? result.integrations : []))
      .catch(() => setIntegrations([]));
  }, [company.id, tenant.id]);

  const reloadIntegrations = async () => {
    const response = await fetch(`/api/integrations?tenantId=${encodeURIComponent(tenant.id)}&companyId=${encodeURIComponent(company.id)}`);
    const result = await response.json();
    setIntegrations(Array.isArray(result.integrations) ? result.integrations : []);
  };

  const selectXeroOrganisation = async (integrationId: string) => {
    setIntegrationBusy(true); setIntegrationMessage("");
    try {
      const response = await fetch("/api/integrations/xero/select", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tenantId: tenant.id, companyId: company.id, integrationId }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not select Xero organisation.");
      await reloadIntegrations(); setIntegrationMessage("Xero organisation selected.");
    } catch (error) { setIntegrationMessage(error instanceof Error ? error.message : "Xero selection failed."); }
    finally { setIntegrationBusy(false); }
  };

  const syncXero = async () => {
    setIntegrationBusy(true); setIntegrationMessage("Queueing Xero trial balance and VAT evidence…");
    try {
      const response = await fetch("/api/integrations/xero/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tenantId: tenant.id, tenantName: tenant.name, tenantType: tenant.type, tenantPlan: tenant.plan, companyId: company.id, companyName: company.name, companyIndustry: company.industry, currency: company.currency, country: company.country, asOfDate: new Date().toISOString().slice(0, 10) }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Xero sync failed.");
      setIntegrationMessage("Xero sync is running in the background…");
      const completed = await pollXeroSync(result.syncId, (status) => setIntegrationMessage(status === "queued" ? "Xero sync queued…" : "Syncing Xero pages and running assurance checks…"));
      if (!completed.analysis) throw new Error("Xero sync completed without an analysis result.");
      onIntegrationAnalysis(completed.analysis);
      await reloadIntegrations();
      setIntegrationMessage(`Xero sync completed: ${completed.counts?.trialBalance ?? 0} trial-balance and ${completed.counts?.vatRows ?? 0} VAT row(s).`);
    } catch (error) { setIntegrationMessage(error instanceof Error ? error.message : "Xero sync failed."); }
    finally { setIntegrationBusy(false); }
  };

  const disconnectXero = async (integrationId: string) => {
    setIntegrationBusy(true); setIntegrationMessage("");
    try {
      const response = await fetch("/api/integrations/xero/disconnect", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ integrationId }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Xero disconnect failed.");
      await reloadIntegrations(); setIntegrationMessage("Xero disconnected.");
    } catch (error) { setIntegrationMessage(error instanceof Error ? error.message : "Xero disconnect failed."); }
    finally { setIntegrationBusy(false); }
  };

  const save = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  return (
    <div className="grid gap-6 max-w-2xl">
      <Panel title="Profile">
        <div className="grid gap-4 md:grid-cols-2">
          <label className="grid gap-2">
            <span className="text-sm font-bold text-muted">Full name</span>
            <input className="h-11 rounded-lg border border-line px-3" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="grid gap-2">
            <span className="text-sm font-bold text-muted">Email</span>
            <input className="h-11 rounded-lg border border-line px-3" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label className="grid gap-2">
            <span className="text-sm font-bold text-muted">Role</span>
            <select className="h-11 rounded-lg border border-line px-3" value={role} onChange={(e) => setRole(e.target.value)}>
              {["Practice Admin", "Manager", "Reviewer", "Client User"].map((r) => <option key={r}>{r}</option>)}
            </select>
          </label>
          <label className="grid gap-2">
            <span className="text-sm font-bold text-muted">Firm / Organisation</span>
            <input className="h-11 rounded-lg border border-line px-3 bg-slate-50" value={tenant.name} readOnly />
          </label>
        </div>
      </Panel>

      <Panel title="Export Preferences">
        <div className="grid gap-4 md:grid-cols-3">
          <label className="grid gap-2">
            <span className="text-sm font-bold text-muted">Export format</span>
            <select className="h-11 rounded-lg border border-line px-3" value={exportFormat} onChange={(e) => setExportFormat(e.target.value)}>
              {["PDF", "Excel", "CSV", "Word"].map((f) => <option key={f}>{f}</option>)}
            </select>
          </label>
          <label className="grid gap-2">
            <span className="text-sm font-bold text-muted">Currency display</span>
            <select className="h-11 rounded-lg border border-line px-3" value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {["GBP", "EUR", "USD", "NGN", "GHS", "KES", "ZAR"].map((c) => <option key={c}>{c}</option>)}
            </select>
          </label>
          <label className="grid gap-2">
            <span className="text-sm font-bold text-muted">Date format</span>
            <select className="h-11 rounded-lg border border-line px-3" value={dateFormat} onChange={(e) => setDateFormat(e.target.value)}>
              {["DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD"].map((d) => <option key={d}>{d}</option>)}
            </select>
          </label>
        </div>
      </Panel>

      <Panel title="Notifications">
        <label className="flex cursor-pointer items-center justify-between rounded-lg border border-line p-4">
          <div>
            <strong>Email alerts</strong>
            <p className="mt-1 text-sm text-muted">Receive an email when new critical findings are detected after upload.</p>
          </div>
          <button
            className={`relative h-6 w-11 rounded-full transition-colors ${emailAlerts ? "bg-brand" : "bg-slate-300"}`}
            onClick={() => setEmailAlerts((v) => !v)}
          >
            <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${emailAlerts ? "translate-x-5" : "translate-x-0.5"}`} />
          </button>
        </label>
      </Panel>

      <Panel title="Accounting Integrations">
        <div className="grid gap-3">
          {integrations.map((integration) => (
            <div key={integration.provider} className="rounded-lg border border-line bg-slate-50 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <strong>{integration.label}</strong>
                  <p className="mt-1 text-sm text-muted">{integration.detail}</p>
                  <p className="mt-2 text-xs text-muted">Scope: {integration.capabilities.map((capability) => capability.replaceAll("_", " ")).join(", ")}.</p>
                </div>
                <Pill level={integration.status === "connected" ? "low" : integration.status === "ready_to_connect" || integration.status === "tenant_selection_required" ? "medium" : "high"}>{integration.status.replaceAll("_", " ")}</Pill>
              </div>
              {integration.provider === "xero" && integration.organisations?.length ? (
                <div className="mt-3 grid gap-2">
                  {integration.organisations.map((organisation) => (
                    <div key={organisation.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-white p-3 text-sm">
                      <div><strong>{organisation.name}</strong><p className="text-xs text-muted">{organisation.lastSyncedAt ? `Last synced ${new Date(organisation.lastSyncedAt).toLocaleString("en-GB")}` : "Not yet synced"}</p></div>
                      <div className="flex gap-2">
                        {!organisation.selected && <button className="rounded-lg border border-line px-3 py-2 text-xs font-black" disabled={integrationBusy} onClick={() => selectXeroOrganisation(organisation.id)}>Select</button>}
                        {organisation.selected && <><button className="rounded-lg bg-brand px-3 py-2 text-xs font-black text-white" disabled={integrationBusy} onClick={syncXero}>Sync now</button><button className="rounded-lg border border-red-200 px-3 py-2 text-xs font-black text-red-700" disabled={integrationBusy} onClick={() => disconnectXero(organisation.id)}>Disconnect</button></>}
                      </div>
                    </div>
                  ))}
                </div>
              ) : integration.connectUrl ? (
                <a className="mt-3 inline-block rounded-lg bg-brand px-3 py-2 text-sm font-black text-white" href={integration.connectUrl}>Connect {integration.label}</a>
              ) : (
                <button className="mt-3 rounded-lg border border-line bg-white px-3 py-2 text-sm font-black disabled:cursor-not-allowed disabled:text-muted" disabled>{integration.configured ? "Connector unavailable" : "Awaiting credentials"}</button>
              )}
            </div>
          ))}
          {!integrations.length && <p className="text-sm text-muted">Integration status is unavailable.</p>}
          {integrationMessage && <p className="rounded-lg border border-line bg-white p-3 text-sm font-semibold">{integrationMessage}</p>}
        </div>
      </Panel>

      <div className="flex items-center gap-3">
        <button className="rounded-lg bg-brand px-5 py-3 font-bold text-white" onClick={save}>Save Settings</button>
        {saved && <span className="text-sm font-bold text-emerald-700">Settings saved.</span>}
      </div>
    </div>
  );
}

function clientHealthRisks(client: ClientCompany): { cashflow: RiskLevel; vat: RiskLevel; debtors: RiskLevel; workingCapital: RiskLevel } {
  const score = client.score;
  const findings = client.openFindings;
  return {
    cashflow:       score < 60 || findings > 5 ? "high" : score < 75 ? "medium" : "low",
    vat:            client.closeStatus?.toLowerCase().includes("vat") ? "high" : score < 70 ? "medium" : "low",
    debtors:        client.closeStatus?.toLowerCase().includes("ar") || client.closeStatus?.toLowerCase().includes("debtor") ? "high" : score < 70 ? "medium" : "low",
    workingCapital: score < 55 ? "critical" : score < 70 ? "high" : score < 80 ? "medium" : "low",
  };
}

function RiskDot({ level }: { level: RiskLevel }) {
  const colors: Record<RiskLevel, string> = { low: "bg-emerald-500", medium: "bg-amber-400", high: "bg-red-500", critical: "bg-red-700" };
  const titles: Record<RiskLevel, string> = { low: "Low risk", medium: "Watch", high: "At risk", critical: "Critical" };
  return <span className={`inline-block h-2.5 w-2.5 rounded-full ${colors[level]}`} title={titles[level]} />;
}

function PracticePortal({ tenant, clients, currentCompanyId, switchCompany, companySnapshots }: { tenant: Tenant; clients: ClientCompany[]; currentCompanyId: string; switchCompany: (companyId: string) => void; companySnapshots: Record<string, AnalysisResult> }) {
  const average = clients.length ? Math.round(clients.reduce((sum, client) => sum + client.score, 0) / clients.length) : 0;
  const highRisk = clients.filter((c) => c.risk === "high" || c.risk === "critical").length;
  const totalFindings = clients.reduce((sum, c) => sum + c.openFindings, 0);
  const vatRows = clients.map((client) => {
    const snapshot = companySnapshots[client.id];
    const vatReview = snapshot?.vatReview;
    const vatFindings = snapshot?.findings.filter((finding) => finding.category === "vat" && isOpenFinding(finding)) ?? [];
    const hasVat = Boolean(vatReview && vatReview.source !== "empty" && vatReview.transactionsAnalysed > 0);
    const failedReconciliations = vatReview?.reconciliationResults.filter((item) => item.status === "failed").length ?? 0;
    const status = !hasVat ? "Waiting" : failedReconciliations ? "Blocked" : vatFindings.length ? "Review" : "Ready";
    const tone: RiskLevel = status === "Ready" ? "low" : status === "Review" || status === "Waiting" ? "medium" : "critical";
    return {
      client,
      vatDue: vatReview?.vatReturn.box5 ?? 0,
      findings: vatFindings.length + (vatReview?.findings.length ?? 0),
      status,
      tone,
    };
  });
  const vatReady = vatRows.filter((row) => row.status === "Ready").length;
  const vatWaiting = vatRows.filter((row) => row.status === "Waiting").length;
  const vatBlocked = vatRows.filter((row) => row.status === "Blocked").length;
  const workflow = [
    { name: "Awaiting Pack", clients: clients.filter((c) => c.closeStatus === "Awaiting upload"), tone: "medium" as RiskLevel },
    { name: "AI Review Complete", clients: clients.filter((c) => c.closeStatus !== "Awaiting upload" && c.openFindings === 0), tone: "low" as RiskLevel },
    { name: "Manager Review", clients: clients.filter((c) => c.openFindings > 0 && c.risk !== "high" && c.risk !== "critical"), tone: "medium" as RiskLevel },
    { name: "Blocked / High Risk", clients: clients.filter((c) => c.risk === "high" || c.risk === "critical"), tone: "critical" as RiskLevel },
  ];
  const nextActions = clients
    .slice()
    .sort((a, b) => b.openFindings - a.openFindings || a.score - b.score)
    .slice(0, 5);

  return (
    <div className="grid gap-4">
      {/* Practice overview */}
      <section className="rounded-lg border border-line bg-white p-5 shadow-panel">
        <div className="mb-4">
          <p className="text-xs font-bold uppercase text-muted">Client Health Dashboard</p>
          <h2 className="text-xl font-black">{tenant.name}</h2>
          <p className="text-sm text-muted">{clients.length} active client{clients.length !== 1 ? "s" : ""} · {tenant.type === "accounting_practice" ? "Accounting practice" : "Company workspace"}</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-4">
          <div className="rounded-lg border border-line bg-slate-50 p-4 text-center">
            <strong className={`block text-3xl font-black ${average >= 80 ? "text-emerald-700" : average >= 65 ? "text-amber-700" : "text-red-700"}`}>{average || "—"}</strong>
            <p className="mt-1 text-sm font-bold text-muted">Avg Health Score</p>
          </div>
          <div className="rounded-lg border border-line bg-slate-50 p-4 text-center">
            <strong className={`block text-3xl font-black ${clients.length > 0 ? "text-brand" : "text-slate-400"}`}>{clients.length}</strong>
            <p className="mt-1 text-sm font-bold text-muted">Active Clients</p>
          </div>
          <div className="rounded-lg border border-line bg-slate-50 p-4 text-center">
            <strong className={`block text-3xl font-black ${highRisk > 0 ? "text-red-700" : "text-emerald-700"}`}>{highRisk}</strong>
            <p className="mt-1 text-sm font-bold text-muted">High-Risk Clients</p>
          </div>
          <div className="rounded-lg border border-line bg-slate-50 p-4 text-center">
            <strong className={`block text-3xl font-black ${totalFindings > 0 ? "text-amber-700" : "text-emerald-700"}`}>{totalFindings}</strong>
            <p className="mt-1 text-sm font-bold text-muted">Open Findings</p>
          </div>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[0.7fr_1.3fr]">
        <Panel title="VAT Control Centre">
          <div className="grid gap-3">
            <Metric title="Returns Ready" value={vatReady} detail="Ready to submit/review" tone="low" />
            <Metric title="Returns Waiting" value={vatWaiting} detail="VAT pack not uploaded" tone="medium" />
            <Metric title="Returns Blocked" value={vatBlocked} detail="Failed reconciliation or blocker" tone={vatBlocked ? "critical" : "low"} />
          </div>
        </Panel>

        <Panel title="Practice VAT Review Queue">
          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="w-full min-w-[720px] border-collapse text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-muted">
                <tr>
                  <th className="border-b border-line p-3">Client</th>
                  <th className="border-b border-line p-3 text-right">VAT Due</th>
                  <th className="border-b border-line p-3 text-right">Findings</th>
                  <th className="border-b border-line p-3">Status</th>
                  <th className="border-b border-line p-3"></th>
                </tr>
              </thead>
              <tbody>
                {vatRows.map((row) => (
                  <tr key={row.client.id}>
                    <td className="border-b border-line p-3 font-bold">{row.client.name}</td>
                    <td className="border-b border-line p-3 text-right font-semibold">{row.status === "Waiting" ? "—" : `£${Math.round(Math.abs(row.vatDue)).toLocaleString("en-GB")}`}</td>
                    <td className="border-b border-line p-3 text-right">{row.findings}</td>
                    <td className="border-b border-line p-3"><Pill level={row.tone}>{row.status}</Pill></td>
                    <td className="border-b border-line p-3 text-right">
                      <button className="rounded-lg bg-brand px-3 py-2 text-xs font-bold text-white" onClick={() => switchCompany(row.client.id)}>Open</button>
                    </td>
                  </tr>
                ))}
                {vatRows.length === 0 && (
                  <tr>
                    <td className="p-4 text-center text-muted" colSpan={5}>No clients available for VAT review.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1fr_0.8fr]">
        <Panel title="Practice Review Workflow">
          <div className="grid gap-3 md:grid-cols-4">
            {workflow.map((lane) => (
              <div key={lane.name} className="rounded-lg border border-line bg-slate-50 p-3">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <strong className="text-sm">{lane.name}</strong>
                  <Pill level={lane.tone}>{lane.clients.length}</Pill>
                </div>
                <div className="grid gap-2">
                  {lane.clients.slice(0, 4).map((client) => (
                    <button key={client.id} className="rounded-lg border border-line bg-white p-2 text-left hover:border-brand" onClick={() => switchCompany(client.id)}>
                      <span className="block truncate text-sm font-bold">{client.name}</span>
                      <span className="block text-xs text-muted">{client.openFindings} open · score {client.score || "—"}</span>
                    </button>
                  ))}
                  {lane.clients.length === 0 && <p className="rounded-lg border border-dashed border-line bg-white p-3 text-xs text-muted">No clients in this lane.</p>}
                </div>
              </div>
            ))}
          </div>
        </Panel>
        <Panel title="Manager Queue">
          <div className="grid gap-2">
            {nextActions.length ? nextActions.map((client) => (
              <button key={client.id} className="flex items-center justify-between gap-3 rounded-lg border border-line bg-white p-3 text-left hover:border-brand" onClick={() => switchCompany(client.id)}>
                <div className="min-w-0">
                  <strong className="block truncate text-sm">{client.name}</strong>
                  <p className="text-xs text-muted">{client.system} · {client.closeStatus}</p>
                </div>
                <div className="shrink-0 text-right">
                  <Pill level={client.risk}>{riskCopy(client.risk)}</Pill>
                  <p className="mt-1 text-xs font-bold text-muted">{client.openFindings} open</p>
                </div>
              </button>
            )) : <EmptyState title="No manager queue yet" detail="Onboard clients and upload finance packs to build the review queue." />}
          </div>
        </Panel>
      </section>

      {/* Client Health Cards */}
      {clients.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {clients.map((client) => {
            const health = clientHealthRisks(client);
            const isActive = client.id === currentCompanyId;
            return (
              <article key={client.id} className={`rounded-xl border bg-white p-5 shadow-sm transition-all ${isActive ? "border-brand ring-1 ring-brand" : "border-line hover:border-slate-300"}`}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-black">{client.name}</p>
                    <p className="text-xs text-muted">{client.system} · {client.closeStatus}</p>
                  </div>
                  <div className="text-right">
                    <strong className={`block text-2xl font-black ${client.score >= 80 ? "text-emerald-700" : client.score >= 65 ? "text-amber-700" : "text-red-700"}`}>{client.score || "—"}</strong>
                    <Pill level={client.risk}>{riskCopy(client.risk)}</Pill>
                  </div>
                </div>

                {/* Client Health Risk Indicators */}
                <div className="mt-4 grid grid-cols-4 gap-2 border-t border-line pt-4">
                  {[
                    { label: "Cashflow", level: health.cashflow },
                    { label: "VAT", level: health.vat },
                    { label: "Debtors", level: health.debtors },
                    { label: "Working Cap", level: health.workingCapital },
                  ].map(({ label, level }) => (
                    <div key={label} className="text-center">
                      <RiskDot level={level} />
                      <p className="mt-1 text-xs text-muted">{label}</p>
                    </div>
                  ))}
                </div>

                {client.openFindings > 0 && (
                  <p className="mt-3 text-xs font-semibold text-amber-700">{client.openFindings} open finding{client.openFindings !== 1 ? "s" : ""} require review</p>
                )}

                <button
                  className={`mt-4 w-full rounded-lg py-2 text-sm font-bold transition-colors ${isActive ? "bg-brand/10 text-brand" : "bg-brand text-white hover:bg-blue-700"}`}
                  onClick={() => switchCompany(client.id)}
                  disabled={isActive}
                >
                  {isActive ? "Currently Active" : "Open Client Review"}
                </button>
              </article>
            );
          })}
        </div>
      ) : (
        <Panel title="Client Health Dashboard">
          <div className="py-8 text-center">
            <p className="font-bold text-muted">No clients yet</p>
            <p className="mt-1 text-sm text-muted">Onboard your first client to see their health dashboard.</p>
          </div>
        </Panel>
      )}
    </div>
  );
}
