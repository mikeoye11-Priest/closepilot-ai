import { hasCompanyCapability } from "@/lib/api-authorization";
import { requireApiSession } from "@/lib/api-auth";
import { createClient } from "@/lib/supabase-server";
import type { AnalysisResult, Finding, Recommendation, Upload, ValidationCheck } from "@/lib/types";
import { NextResponse } from "next/server";
import { verifyAnalysis } from "@/lib/analysis-attestation";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type EvidenceRowInsert = {
  id: string;
  tenant_id: string;
  company_id: string;
  finding_id: string | undefined;
  upload_id: string | null;
  source_file: string;
  sheet_name: string | null;
  row_index: number | null;
  account_code: string;
  period: string;
  amount: number | null;
  source_row: Record<string, unknown>;
  calculation_input: Record<string, unknown>;
};

export async function POST(request: Request) {
  const session = await requireApiSession();
  if (!session.ok) return session.response;
  if (session.authDisabled) return NextResponse.json({ persisted: false, reason: "auth_disabled" });

  const body = await request.json();
  const tenantId = stringValue(body.tenantId);
  const companyId = stringValue(body.companyId);

  if (!UUID_RE.test(tenantId) || !UUID_RE.test(companyId)) {
    return NextResponse.json({ persisted: false, reason: "uuid_scope_required" });
  }

  const result = normaliseAnalysisResult(body.result);
  if (!result) {
    return NextResponse.json({ error: "result is required" }, { status: 400 });
  }
  const attestation = stringValue(body.attestation);
  const trusted = verifyAnalysis(attestation, result, tenantId, companyId);
  if (!trusted) return NextResponse.json({ error: "Analysis result is unsigned, expired, or was modified after server analysis." }, { status: 403 });

  const jobId = crypto.randomUUID();
  const uploadIdMap = new Map(result.uploads.map((upload) => [upload.id, crypto.randomUUID()]));
  const findingIdMap = new Map(result.findings.map((finding) => [finding.id, crypto.randomUUID()]));
  const validationCheckIdMap = new Map(result.validationChecks.map((check) => [check.id, crypto.randomUUID()]));
  const recommendationIdMap = new Map(result.recommendations.map((recommendation) => [recommendation.id, crypto.randomUUID()]));

  const supabase = await createClient();
  if (!session.userId || !await hasCompanyCapability(supabase, session.userId, companyId, "prepare")) {
    return NextResponse.json({ error: "You do not have permission to persist analysis for this company." }, { status: 403 });
  }
  const jobSummary = {
    score: trusted.score,
    risk: trusted.risk,
    upload_count: result.uploads.length,
    validation_check_count: result.validationChecks.length,
    finding_count: result.findings.length,
    recommendation_count: result.recommendations.length,
    vat_review_source: result.vatReview && typeof result.vatReview === "object" && "source" in result.vatReview ? result.vatReview.source : null,
  };

  const job = {
    id: jobId,
    tenant_id: tenantId,
    company_id: companyId,
    job_type: "upload_analysis",
    status: "completed",
    input_upload_ids: Array.from(uploadIdMap.values()),
    result_summary: jobSummary,
    started_at: new Date().toISOString(),
    completed_at: new Date().toISOString(),
    retention_until: new Date(Date.now()+365*86_400_000).toISOString(),
  };
  const recommendations = result.recommendations
      .filter((recommendation) => findingIdMap.has(recommendation.findingId))
      .map((recommendation) => recommendationRow(recommendation, tenantId, companyId, findingIdMap, recommendationIdMap));
  const { error: persistenceError } = await supabase.rpc("persist_analysis_result", { p: {
    job,
    uploads: result.uploads.map((upload) => uploadRow(upload, tenantId, companyId, uploadIdMap)),
    validation_checks: result.validationChecks.map((check) => validationCheckRow(check, tenantId, companyId, jobId, validationCheckIdMap)),
    findings: result.findings.map((finding) => findingRow(finding, result.uploads, tenantId, companyId, jobId, uploadIdMap, findingIdMap)),
    evidence: result.findings.flatMap((finding) => evidenceRows(finding, result.uploads, tenantId, companyId, uploadIdMap, findingIdMap)),
    recommendations,
    score: { id: crypto.randomUUID(), tenant_id: tenantId, company_id: companyId, score: trusted.score, risk_level: trusted.risk },
    audit: { id: crypto.randomUUID(), tenant_id: tenantId, user_id: session.userId, action: "analysis_result_persisted", entity_type: "analysis_job", entity_id: jobId },
  } });
  if (persistenceError) return NextResponse.json({ error: persistenceError.message }, { status: 500 });

  return NextResponse.json({
    persisted: true,
    jobId,
    counts: {
      uploads: result.uploads.length,
      validationChecks: result.validationChecks.length,
      findings: result.findings.length,
      recommendations: result.recommendations.length,
    }
  });
}

function uploadRow(upload: Upload, tenantId: string, companyId: string, uploadIdMap: Map<string, string>) {
  const id = uploadIdMap.get(upload.id) ?? crypto.randomUUID();
  return {
    id,
    tenant_id: tenantId,
    company_id: companyId,
    file_type: upload.fileType,
    file_url: upload.storageStatus === "stored" && upload.fileUrl ? upload.fileUrl : `pending://${encodeURIComponent(upload.fileName)}`,
    storage_key: upload.storageKey ?? `tenants/${tenantId}/companies/${companyId}/uploads/${id}/${upload.fileName}`,
    uploaded_at: dateOrNow(upload.uploadedAt),
    retention_until: new Date(Date.now()+90*86_400_000).toISOString(),
  };
}

function validationCheckRow(check: ValidationCheck, tenantId: string, companyId: string, jobId: string, idMap: Map<string, string>) {
  return {
    id: idMap.get(check.id) ?? crypto.randomUUID(),
    tenant_id: tenantId,
    company_id: companyId,
    analysis_job_id: jobId,
    name: check.name,
    status: check.status,
    detail: check.detail,
  };
}

function findingRow(finding: Finding, uploads: Upload[], tenantId: string, companyId: string, jobId: string, uploadIdMap: Map<string, string>, findingIdMap: Map<string, string>) {
  const sourceUpload = findSourceUploadId(finding, uploads, uploadIdMap);
  return {
    id: findingIdMap.get(finding.id) ?? crypto.randomUUID(),
    tenant_id: tenantId,
    company_id: companyId,
    analysis_job_id: jobId,
    upload_id: sourceUpload,
    rule_id: null,
    severity: finding.severity,
    category: finding.category,
    title: finding.title,
    description: finding.description,
    expected_impact: finding.expectedImpact,
    status: finding.status,
    confidence: finding.confidence,
    confidence_score: finding.confidenceScore ?? null,
    evidence_strength: finding.evidenceStrength ?? "indicator",
    source_file: finding.evidence.sourceFile,
    account_code: finding.evidence.accountCode,
    period: finding.evidence.period,
    calculation: finding.evidence.calculation,
    evidence: { ...finding.evidence, original_id: finding.id, rule_id: finding.ruleId ?? null },
    reviewer: finding.reviewer ?? null,
    review_action: finding.reviewAction ?? null,
    review_reason: finding.reviewReason ?? null,
    reviewed_at: finding.reviewedAt ?? null,
  };
}

function evidenceRows(finding: Finding, uploads: Upload[], tenantId: string, companyId: string, uploadIdMap: Map<string, string>, findingIdMap: Map<string, string>): EvidenceRowInsert[] {
  if (finding.evidence.rows?.length) {
    return finding.evidence.rows.map((row) => {
      const uploadId = findSourceUploadId(finding, uploads, uploadIdMap);
      return {
        id: crypto.randomUUID(),
        tenant_id: tenantId,
        company_id: companyId,
        finding_id: findingIdMap.get(finding.id),
        upload_id: uploadId,
        source_file: row.sourceFile || finding.evidence.sourceFile,
        sheet_name: row.sheetName ?? null,
        row_index: row.rowIndex ?? null,
        account_code: row.accountCode ?? finding.evidence.accountCode,
        period: row.period ?? finding.evidence.period,
        amount: row.amount ?? null,
        source_row: row.sourceRow,
        calculation_input: {
          ...(row.calculationInput ?? {}),
          calculation: finding.evidence.calculation,
          original_finding_id: finding.id,
        },
      };
    });
  }

  const uploadId = findSourceUploadId(finding, uploads, uploadIdMap);
  return [{
    id: crypto.randomUUID(),
    tenant_id: tenantId,
    company_id: companyId,
    finding_id: findingIdMap.get(finding.id),
    upload_id: uploadId,
    source_file: finding.evidence.sourceFile,
    sheet_name: null,
    row_index: null,
    account_code: finding.evidence.accountCode,
    period: finding.evidence.period,
    amount: finding.evidence.matchValue ?? null,
    source_row: {
      source_file: finding.evidence.sourceFile,
      account_code: finding.evidence.accountCode,
      match_names: (finding.evidence.matchNames ?? []).join(" / "),
      original_finding_id: finding.id,
    },
    calculation_input: {
      calculation: finding.evidence.calculation,
      match_count: finding.evidence.matchCount ?? null,
      expected_impact: finding.expectedImpact,
      rule_id: finding.ruleId ?? null,
      evidence_strength: finding.evidenceStrength ?? "indicator",
    },
  }];
}

function recommendationRow(recommendation: Recommendation, tenantId: string, companyId: string, findingIdMap: Map<string, string>, recommendationIdMap: Map<string, string>) {
  return {
    id: recommendationIdMap.get(recommendation.id) ?? crypto.randomUUID(),
    tenant_id: tenantId,
    company_id: companyId,
    finding_id: findingIdMap.get(recommendation.findingId),
    action: recommendation.action,
    expected_impact: recommendation.expectedImpact,
    priority: recommendation.priority,
    completed: recommendation.completed,
  };
}

function findSourceUploadId(finding: Finding, uploads: Upload[], uploadIdMap: Map<string, string>) {
  const sourceFile = finding.evidence.sourceFile.toLowerCase();
  const matchedUpload = uploads.find((upload) =>
    upload.fileName.toLowerCase() === sourceFile ||
    upload.originalFileName?.toLowerCase() === sourceFile
  );
  if (matchedUpload) return uploadIdMap.get(matchedUpload.id) ?? null;

  const evidenceText = `${finding.id} ${finding.evidence.sourceFile}`.toLowerCase();
  for (const upload of uploads) {
    if (evidenceText.includes(upload.id.toLowerCase()) || evidenceText.includes(upload.fileName.toLowerCase())) {
      return uploadIdMap.get(upload.id) ?? null;
    }
  }
  return null;
}

function normaliseAnalysisResult(value: unknown): AnalysisResult | null {
  if (!value || typeof value !== "object") return null;
  const result = value as Partial<AnalysisResult>;
  return {
    uploads: Array.isArray(result.uploads) ? result.uploads : [],
    validationChecks: Array.isArray(result.validationChecks) ? result.validationChecks : [],
    findings: Array.isArray(result.findings) ? result.findings : [],
    recommendations: Array.isArray(result.recommendations) ? result.recommendations : [],
    vatReview: result.vatReview,
  };
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number) : 0;
}

function dateOrNow(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}
