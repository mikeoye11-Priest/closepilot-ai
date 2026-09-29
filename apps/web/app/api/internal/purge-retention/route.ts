import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { withBoundedRetry } from "@/lib/retry";
import { authoriseWorkerRequest } from "@/lib/worker-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const BUCKET = process.env.CLOSEPILOT_UPLOAD_BUCKET || "finance-uploads";
const RETRY_AFTER_MS = 15 * 60 * 1000;

export async function POST(request: Request) {
  const auth = authoriseWorkerRequest(request.headers.get("authorization"), process.env.CRON_SECRET);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (process.env.RETENTION_ENFORCEMENT_ENABLED !== "1") {
    return NextResponse.json({ error: "Retention enforcement is not enabled." }, { status: 503 });
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: "Retention service credentials are not configured." }, { status: 503 });

  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const now = new Date().toISOString();
  const runId = crypto.randomUUID();
  const { error: startError } = await admin.from("retention_purge_runs").insert({ id: runId, started_at: now });
  if (startError) return NextResponse.json({ error: `Could not start purge audit: ${startError.message}` }, { status: 500 });

  const fail = async (code: string, message: string, attempts = 1, status = 500) => {
    const completedAt = new Date().toISOString();
    await admin.from("retention_purge_runs").update({
      status: "failed",
      completed_at: completedAt,
      attempt_count: attempts,
      next_retry_at: new Date(Date.now() + RETRY_AFTER_MS).toISOString(),
      error_code: code,
      error_message: message.slice(0, 2000),
    }).eq("id", runId);
    return NextResponse.json({ error: message, purgeRunId: runId, retryScheduled: true }, { status });
  };

  const { data: uploads, error: listError } = await admin.rpc("list_expired_retention_uploads", { p_now: now, p_batch_size: 500 });
  if (listError) return fail("UPLOAD_LIST_FAILED", listError.message);
  const keys = (uploads ?? []).map((row: { storage_key: string | null }) => row.storage_key).filter((value: string | null): value is string => Boolean(value));
  const ids = (uploads ?? []).map((row: { id: string }) => row.id);

  let storageAttempts = 1;
  if (keys.length) {
    try {
      const result = await withBoundedRetry(async () => {
        const { error } = await admin.storage.from(BUCKET).remove(keys);
        if (error) throw error;
      }, { attempts: 3, baseDelayMs: 200 });
      storageAttempts = result.attempts;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return fail("STORAGE_PURGE_FAILED", `Storage purge failed: ${message}`, 3, 503);
    }
  }

  if (ids.length) {
    const { error } = await admin.from("uploads").update({ deleted_at: now, ingestion_status: "retention_deleted" }).in("id", ids);
    if (error) return fail("UPLOAD_MARK_FAILED", error.message, storageAttempts);
  }
  const { data: purged, error: purgeError } = await admin.rpc("purge_expired_retention", { p_now: now, p_batch_size: 500 });
  if (purgeError) return fail("DATABASE_PURGE_FAILED", purgeError.message, storageAttempts);

  const completedAt = new Date().toISOString();
  const { error: completionError } = await admin.from("retention_purge_runs").update({
    status: "completed",
    completed_at: completedAt,
    attempt_count: storageAttempts,
    storage_objects: keys.length,
    purged_counts: purged ?? {},
  }).eq("id", runId);
  if (completionError) return NextResponse.json({ error: `Purge completed but its audit record could not be finalised: ${completionError.message}`, purgeRunId: runId }, { status: 500 });
  return NextResponse.json({ purgeRunId: runId, purged, storageObjects: keys.length, attempts: storageAttempts, completedAt });
}

export async function GET(request: Request) {
  return POST(request);
}
