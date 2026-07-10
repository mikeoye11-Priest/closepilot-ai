import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { recogniseFinanceDocument } from "@/lib/import-engine";
import { analyseParsedFiles, parseFinanceFile, scopeAnalysisResult, type ParsedFile } from "@/lib/upload-analysis";
import { authoriseWorkerRequest } from "@/lib/worker-auth";
import type { Company, Tenant } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const UPLOAD_BUCKET = process.env.CLOSEPILOT_UPLOAD_BUCKET || "finance-uploads";
const MAX_ROWS_PER_SOURCE = 250_000;

type ClaimedJob = {
  id: string;
  tenant_id: string;
  company_id: string;
  input_upload_ids: string[];
  checkpoint?: Record<string, unknown>;
  attempt_count: number;
};

type StoredUpload = {
  id: string;
  storage_key: string;
  size_bytes: number | null;
};

export async function POST(request: Request) {
  const authorised = authoriseWorker(request);
  if (!authorised.ok) return authorised.response;

  const admin = adminClient();
  if (!admin) return NextResponse.json({ error: "Background worker storage credentials are not configured." }, { status: 503 });

  const { data: claimed, error: claimError } = await admin.rpc("claim_next_analysis_job");
  if (claimError) return NextResponse.json({ error: claimError.message }, { status: 500 });
  const job = Array.isArray(claimed) ? claimed[0] as ClaimedJob | undefined : undefined;
  if (!job) return NextResponse.json({ processed: false, reason: "queue_empty" });

  try {
    const [{ data: tenantRow, error: tenantError }, { data: companyRow, error: companyError }, { data: uploads, error: uploadsError }] = await Promise.all([
      admin.from("tenants").select("id,name,tenant_type,plan").eq("id", job.tenant_id).single(),
      admin.from("companies").select("id,tenant_id,name,industry,accounting_system,currency,country").eq("id", job.company_id).single(),
      admin.from("uploads").select("id,storage_key,size_bytes").in("id", job.input_upload_ids),
    ]);
    if (tenantError || !tenantRow) throw new Error(tenantError?.message || "Job tenant not found.");
    if (companyError || !companyRow) throw new Error(companyError?.message || "Job company not found.");
    if (uploadsError || !uploads) throw new Error(uploadsError?.message || "Job uploads not found.");

    const orderedUploads = job.input_upload_ids.map((id) => (uploads as StoredUpload[]).find((upload) => upload.id === id)).filter((upload): upload is StoredUpload => Boolean(upload));
    if (orderedUploads.length !== job.input_upload_ids.length) throw new Error("One or more queued source files are missing.");

    const parsedFiles: ParsedFile[] = [];
    let bytesProcessed = 0;
    let rowsProcessed = 0;
    for (let index = 0; index < orderedUploads.length; index += 1) {
      const source = orderedUploads[index];
      await heartbeat(admin, job.id, 8 + Math.round(index / orderedUploads.length * 55), `Reading source file ${index + 1} of ${orderedUploads.length}`, bytesProcessed, rowsProcessed, { fileIndex: index });
      const { data: blob, error: downloadError } = await admin.storage.from(UPLOAD_BUCKET).download(source.storage_key);
      if (downloadError || !blob) throw new Error(downloadError?.message || `Could not download ${source.storage_key}.`);
      const fileName = source.storage_key.split("/").pop() || `upload-${index + 1}.csv`;
      const file = new File([await blob.arrayBuffer()], fileName, { type: blob.type || "text/csv" });
      const parsed = await parseFinanceFile(file);
      if (parsed.rows.length > MAX_ROWS_PER_SOURCE) throw new Error(`${fileName} contains ${parsed.rows.length.toLocaleString("en-GB")} rows; the current worker limit is ${MAX_ROWS_PER_SOURCE.toLocaleString("en-GB")} rows per source.`);
      const detection = recogniseFinanceDocument(fileName, parsed.headers, parsed.rows);
      parsedFiles.push({ ...parsed, upload: { ...parsed.upload, ...detection, id: source.id, storageBucket: UPLOAD_BUCKET, storageKey: source.storage_key, fileUrl: `supabase-storage://${UPLOAD_BUCKET}/${source.storage_key}`, storageStatus: "stored" } });
      bytesProcessed += source.size_bytes ?? file.size;
      rowsProcessed += parsed.rows.length;
      await admin.from("uploads").update({ file_type: detection.fileType, ingestion_status: "processing" }).eq("id", source.id);
    }

    await heartbeat(admin, job.id, 68, "Running reconciliations and review rules", bytesProcessed, rowsProcessed, { fileIndex: orderedUploads.length });
    const tenant: Tenant = { id: tenantRow.id, name: tenantRow.name, type: tenantRow.tenant_type, plan: tenantRow.plan };
    const company: Company = { id: companyRow.id, tenantId: companyRow.tenant_id, name: companyRow.name, industry: companyRow.industry ?? "", accountingSystem: companyRow.accounting_system ?? "Unknown", currency: companyRow.currency ?? "GBP", country: companyRow.country ?? "United Kingdom" };
    const result = scopeAnalysisResult(analyseParsedFiles(parsedFiles), tenant, company);
    const now = new Date().toISOString();
    const resultSummary = { file_count: result.uploads.length, total_bytes: bytesProcessed, rows_processed: rowsProcessed, finding_count: result.findings.length, validation_check_count: result.validationChecks.length, analysisResult: result };

    const { error: completionError } = await admin.from("analysis_jobs").update({ status: "completed", progress_percent: 100, current_stage: "Review complete", bytes_processed: bytesProcessed, rows_processed: rowsProcessed, checkpoint: { fileIndex: orderedUploads.length, complete: true }, result_summary: resultSummary, heartbeat_at: now, completed_at: now }).eq("id", job.id);
    if (completionError) throw new Error(completionError.message);
    await admin.from("uploads").update({ ingestion_status: "processed" }).in("id", job.input_upload_ids);
    return NextResponse.json({ processed: true, jobId: job.id, files: result.uploads.length, rows: rowsProcessed, findings: result.findings.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Background processing failed.";
    const terminal = job.attempt_count >= 3;
    await admin.from("analysis_jobs").update({ status: terminal ? "failed" : "queued", current_stage: terminal ? "Background review failed" : "Retry scheduled", error_message: message, heartbeat_at: new Date().toISOString(), completed_at: terminal ? new Date().toISOString() : null }).eq("id", job.id);
    return NextResponse.json({ processed: false, jobId: job.id, retryScheduled: !terminal, error: message }, { status: terminal ? 422 : 503 });
  }
}

export async function GET(request: Request) {
  return POST(request);
}

async function heartbeat(admin: SupabaseClient, jobId: string, progress: number, stage: string, bytesProcessed: number, rowsProcessed: number, checkpoint: Record<string, unknown>) {
  const { error } = await admin.from("analysis_jobs").update({ progress_percent: progress, current_stage: stage, bytes_processed: bytesProcessed, rows_processed: rowsProcessed, checkpoint, heartbeat_at: new Date().toISOString() }).eq("id", jobId);
  if (error) throw new Error(error.message);
}

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createSupabaseClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function authoriseWorker(request: Request): { ok: true } | { ok: false; response: NextResponse } {
  const result = authoriseWorkerRequest(
    request.headers.get("authorization"),
    process.env.INGESTION_WORKER_SECRET || process.env.CRON_SECRET,
  );
  if (result.ok) return { ok: true };
  return { ok: false, response: NextResponse.json({ error: result.error }, { status: result.status }) };
}
