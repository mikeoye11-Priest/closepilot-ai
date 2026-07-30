// Concurrency + liveness controls for accounting sync runs.
//
// Two syncs running at once for the same connection is dangerous: QuickBooks and
// Sage rotate the refresh token on every refresh, so parallel refreshes can
// invalidate each other and brick the live connection. And because syncs run as
// best-effort serverless background work (Next `after()`), a reclaimed or
// over-running function can leave a run stuck in "running" forever — showing the
// connection as perpetually "Syncing…". These helpers guard both cases.

type SupabaseClient = Awaited<ReturnType<typeof import("@/lib/supabase-server").createClient>>;

// A run still queued/running past this age is treated as stuck and failed. Set
// well beyond the 300s route maxDuration so a legitimately long sync is never
// killed mid-flight.
export const STALE_RUN_MS = 10 * 60 * 1000;

// Self-healing watchdog: mark runs that have been queued/running too long as
// failed, so a dead background job doesn't leave the connection stuck "Syncing…".
export async function expireStaleRuns(supabase: SupabaseClient, integrationIds: string[]): Promise<void> {
  const ids = integrationIds.filter(Boolean);
  if (!ids.length) return;
  const cutoff = new Date(Date.now() - STALE_RUN_MS).toISOString();
  await supabase.from("accounting_sync_runs")
    .update({ status: "failed", error_message: "Sync timed out — the background run did not complete in time. Try syncing again.", completed_at: new Date().toISOString() })
    .in("integration_id", ids)
    .in("status", ["queued", "running"])
    .lt("started_at", cutoff);
}

// The current in-flight (non-stale) run for a connection, if any. Callers expire
// stale runs first, so a result here is a genuinely active sync — used to refuse
// starting a second concurrent sync on the same connection.
export async function activeRunFor(supabase: SupabaseClient, integrationId: string): Promise<{ id: string; status: string } | null> {
  const { data } = await supabase.from("accounting_sync_runs")
    .select("id,status")
    .eq("integration_id", integrationId)
    .in("status", ["queued", "running"])
    .order("started_at", { ascending: false })
    .limit(1);
  const run = data?.[0];
  return run ? { id: run.id, status: String(run.status) } : null;
}
