import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/api-auth";
import { createClient } from "@/lib/supabase-server";
import { decideUploadMode, formatUploadBytes, type UploadCapacityFile } from "@/lib/upload-capacity";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UPLOAD_BUCKET = process.env.CLOSEPILOT_UPLOAD_BUCKET || "finance-uploads";

type UploadManifestItem = UploadCapacityFile & { contentType?: string };

export async function POST(request: Request) {
  const session = await requireApiSession();
  if (!session.ok) return session.response;

  const body = await request.json().catch(() => null) as { tenantId?: unknown; companyId?: unknown; files?: unknown } | null;
  const tenantId = stringValue(body?.tenantId);
  const companyId = stringValue(body?.companyId);
  const files = normaliseManifest(body?.files);

  if (!UUID_RE.test(tenantId) || !UUID_RE.test(companyId)) {
    return NextResponse.json({ error: "A valid tenant and company are required for background uploads." }, { status: 400 });
  }
  if (!files.length) return NextResponse.json({ error: "No files supplied." }, { status: 400 });

  const capacity = decideUploadMode(files);
  if (capacity.mode === "rejected") return NextResponse.json({ error: capacity.message }, { status: 413 });
  if (capacity.mode !== "background") {
    return NextResponse.json({ error: "This pack is small enough for immediate review." }, { status: 409 });
  }
  if (session.authDisabled) {
    return NextResponse.json({ error: "Background uploads require authenticated storage. Use a signed-in pilot workspace." }, { status: 503 });
  }

  const jobId = crypto.randomUUID();
  const uploadRows = files.map((file) => {
    const id = crypto.randomUUID();
    const storageKey = `tenants/${tenantId}/companies/${companyId}/uploads/${id}/${safeStorageName(file.name)}`;
    return {
      id,
      tenant_id: tenantId,
      company_id: companyId,
      file_type: "pending",
      file_url: `supabase-storage://${UPLOAD_BUCKET}/${storageKey}`,
      storage_key: storageKey,
      size_bytes: file.size,
      ingestion_status: "awaiting_upload",
      retention_until: retentionDate(),
      uploaded_at: new Date().toISOString(),
      manifest: { id, name: file.name, size: file.size, contentType: file.contentType || "application/octet-stream", storageKey },
    };
  });
  const manifest = uploadRows.map((row) => row.manifest);
  const supabase = await createClient();

  const { error: uploadError } = await supabase.from("uploads").insert(uploadRows.map(({ manifest: _manifest, ...row }) => row));
  if (uploadError) return NextResponse.json({ error: uploadError.message }, { status: 500 });

  const { error: jobError } = await supabase.from("analysis_jobs").insert({
    id: jobId,
    tenant_id: tenantId,
    company_id: companyId,
    job_type: "large_upload_analysis",
    source_type: "upload",
    status: "uploading",
    input_upload_ids: uploadRows.map((row) => row.id),
    result_summary: { file_count: files.length, total_bytes: capacity.totalBytes },
    progress_percent: 0,
    current_stage: "Uploading source files",
    checkpoint: { manifest, uploadedKeys: [] },
    bytes_processed: 0,
    rows_processed: 0,
    attempt_count: 0,
    heartbeat_at: new Date().toISOString(),
    retention_until: retentionDate(),
  });
  if (jobError) {
    await supabase.from("uploads").delete().in("id", uploadRows.map((row) => row.id));
    return NextResponse.json({ error: jobError.message }, { status: 500 });
  }

  return NextResponse.json({
    job: jobResponse({ id: jobId, status: "uploading", progress_percent: 0, current_stage: "Uploading source files", result_summary: { file_count: files.length, total_bytes: capacity.totalBytes } }),
    bucket: UPLOAD_BUCKET,
    files: manifest,
    message: `${files.length} files (${formatUploadBytes(capacity.totalBytes)}) prepared for secure background upload.`,
  }, { status: 201 });
}

export async function GET(request: Request) {
  const session = await requireApiSession();
  if (!session.ok) return session.response;
  if (session.authDisabled) return NextResponse.json({ error: "Background job status requires authentication." }, { status: 503 });

  const jobId = new URL(request.url).searchParams.get("jobId") ?? "";
  if (!UUID_RE.test(jobId)) return NextResponse.json({ error: "A valid jobId is required." }, { status: 400 });
  const supabase = await createClient();
  const { data, error } = await supabase.from("analysis_jobs").select("id,status,progress_percent,current_stage,bytes_processed,rows_processed,result_summary,error_message,created_at,started_at,completed_at,heartbeat_at").eq("id", jobId).single();
  if (error || !data) return NextResponse.json({ error: error?.message || "Upload job not found." }, { status: 404 });
  return NextResponse.json({ job: jobResponse(data) });
}

export async function PATCH(request: Request) {
  const session = await requireApiSession();
  if (!session.ok) return session.response;
  if (session.authDisabled) return NextResponse.json({ error: "Background jobs require authentication." }, { status: 503 });

  const body = await request.json().catch(() => null) as { jobId?: unknown; action?: unknown; uploadedKeys?: unknown; error?: unknown } | null;
  const jobId = stringValue(body?.jobId);
  const action = stringValue(body?.action);
  if (!UUID_RE.test(jobId)) return NextResponse.json({ error: "A valid jobId is required." }, { status: 400 });
  if (!["start", "cancel", "fail"].includes(action)) return NextResponse.json({ error: "Unsupported job action." }, { status: 400 });

  const supabase = await createClient();
  const { data: job, error: readError } = await supabase.from("analysis_jobs").select("id,status,input_upload_ids,checkpoint,result_summary").eq("id", jobId).single();
  if (readError || !job) return NextResponse.json({ error: readError?.message || "Upload job not found." }, { status: 404 });

  const now = new Date().toISOString();
  if (action === "start") {
    const uploadedKeys = stringArray(body?.uploadedKeys);
    const expectedKeys = manifestKeys(job.checkpoint);
    if (uploadedKeys.length !== expectedKeys.length || expectedKeys.some((key) => !uploadedKeys.includes(key))) {
      return NextResponse.json({ error: "The uploaded file manifest is incomplete." }, { status: 409 });
    }
    const { error: uploadUpdateError } = await supabase.from("uploads").update({ ingestion_status: "stored" }).in("id", job.input_upload_ids ?? []);
    if (uploadUpdateError) return NextResponse.json({ error: uploadUpdateError.message }, { status: 500 });
    const { data, error } = await supabase.from("analysis_jobs").update({ status: "queued", progress_percent: 5, current_stage: "Queued for background processing", checkpoint: { ...(job.checkpoint ?? {}), uploadedKeys }, heartbeat_at: now }).eq("id", jobId).select("id,status,progress_percent,current_stage,result_summary").single();
    if (error || !data) return NextResponse.json({ error: error?.message || "Could not queue upload job." }, { status: 500 });
    return NextResponse.json({ job: jobResponse(data) });
  }

  const failed = action === "fail";
  const status = failed ? "failed" : "cancelled";
  const errorMessage = failed ? stringValue(body?.error) || "Source-file upload failed." : null;
  const { error: uploadUpdateError } = await supabase.from("uploads").update({ ingestion_status: status }).in("id", job.input_upload_ids ?? []);
  if (uploadUpdateError) return NextResponse.json({ error: uploadUpdateError.message }, { status: 500 });
  const { data, error } = await supabase.from("analysis_jobs").update({ status, current_stage: failed ? "Upload failed" : "Cancelled", error_message: errorMessage, completed_at: now, heartbeat_at: now }).eq("id", jobId).select("id,status,progress_percent,current_stage,result_summary,error_message").single();
  if (error || !data) return NextResponse.json({ error: error?.message || "Could not update upload job." }, { status: 500 });
  return NextResponse.json({ job: jobResponse(data) });
}

function normaliseManifest(value: unknown): UploadManifestItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const name = stringValue(row.name);
    const size = typeof row.size === "number" && Number.isFinite(row.size) ? Math.max(0, Math.round(row.size)) : -1;
    if (!name || size < 0) return [];
    return [{ name, size, contentType: stringValue(row.contentType) }];
  });
}

function stringValue(value: unknown) { return typeof value === "string" ? value.trim() : ""; }
function stringArray(value: unknown) { return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.length > 0) : []; }
function safeStorageName(name: string) { return name.trim().replace(/[/\\]+/g, "_").replace(/[^a-zA-Z0-9._ -]+/g, "_").slice(0, 180) || "upload"; }
function retentionDate() { return new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(); }
function manifestKeys(checkpoint: unknown) {
  if (!checkpoint || typeof checkpoint !== "object" || !("manifest" in checkpoint) || !Array.isArray((checkpoint as { manifest?: unknown }).manifest)) return [];
  return ((checkpoint as { manifest: unknown[] }).manifest).flatMap((item) => item && typeof item === "object" && "storageKey" in item && typeof item.storageKey === "string" ? [item.storageKey] : []);
}
function jobResponse(row: Record<string, unknown>) {
  return {
    id: row.id,
    status: row.status,
    progressPercent: row.progress_percent ?? 0,
    currentStage: row.current_stage ?? "Queued",
    bytesProcessed: row.bytes_processed ?? 0,
    rowsProcessed: row.rows_processed ?? 0,
    resultSummary: row.result_summary ?? {},
    error: row.error_message ?? null,
    createdAt: row.created_at ?? null,
    startedAt: row.started_at ?? null,
    completedAt: row.completed_at ?? null,
    heartbeatAt: row.heartbeat_at ?? null,
  };
}
