// Shared loader for the accounts-production routes. Returns the reporting
// `statements` for a company from the most recent Xero sync
// (accounting_sync_runs), or — when there is no sync — from the current user's
// workspace snapshot, where statements assembled from uploaded documents are
// persisted (see upload-statements.ts + the app-shell persist effect). This is
// what lets uploaded TB/P&L/BS files produce the same packs as a Xero sync.

import type { createClient } from "./supabase-server";
import type { SyncStatements, ManagementAccountsFinding, SourceProvider } from "./management-accounts";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SYNC_PROVIDERS = new Set<SourceProvider>(["xero", "quickbooks", "sage"]);
const hasRows = (s?: SyncStatements): s is SyncStatements =>
  Boolean(s && (((s.profitLoss?.length ?? 0) > 0) || ((s.balanceSheet?.length ?? 0) > 0)));

export type LoadedStatements = { statements: SyncStatements; findings: ManagementAccountsFinding[]; source: SourceProvider };

// Override the reporting period end (year-to-date basis) from a route query
// param. For uploaded documents the figures are fixed by the file, so this sets
// the pack's reporting period — its dated headings and the CT period-days —
// without re-running any analysis. Ignored unless `asOf` is a valid ISO date.
export function withReportingPeriod(statements: SyncStatements, asOf: string | null): SyncStatements {
  if (!asOf || !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) return statements;
  return { ...statements, asOfDate: asOf, periodStart: `${asOf.slice(0, 4)}-01-01` };
}

export async function loadReportStatements(
  supabase: SupabaseServerClient,
  opts: { userId: string; syncId?: string; tenantId?: string; companyId?: string; provider?: string },
): Promise<LoadedStatements | null> {
  const { userId, syncId = "", tenantId = "", companyId = "", provider = "" } = opts;
  // When a connector provider is named, the report is STRICTLY scoped to that
  // provider's sync runs — a company connected to more than one ledger (e.g. Xero
  // and QuickBooks) must never surface the wrong provider's data in its accounts.
  const scopedProvider = SYNC_PROVIDERS.has(provider as SourceProvider) ? (provider as SourceProvider) : undefined;
  const explicitRun = UUID_RE.test(syncId);

  // The user's workspace snapshot reflects their CURRENT review. Read it once so it
  // can (a) act as a TOMBSTONE — a snapshot that exists but carries no statements
  // means the review was cleared or erased, so the preview must NOT resurrect a
  // stale sync run that survived disconnect — and (b) supply the fallback statements
  // for an uploaded review. A specific syncId is an explicit request and bypasses this.
  let snapshot: { statements?: SyncStatements; findings?: ManagementAccountsFinding[] } | undefined;
  let snapshotCleared = false;
  if (companyId && !explicitRun) {
    const { data: ws } = await supabase.from("user_workspaces").select("data").eq("user_id", userId).limit(1);
    const snapshots = (ws?.[0]?.data as { companySnapshots?: Record<string, { statements?: SyncStatements; findings?: ManagementAccountsFinding[] }> } | undefined)?.companySnapshots;
    if (snapshots && Object.prototype.hasOwnProperty.call(snapshots, companyId)) {
      snapshot = snapshots[companyId];
      snapshotCleared = !hasRows(snapshot?.statements);
    }
  }
  if (snapshotCleared) return null;

  // 1. Latest completed sync for this company (or a specific sync run), scoped to
  //    the requested provider when one is given.
  let query = supabase.from("accounting_sync_runs").select("id,provider,result_summary").order("started_at", { ascending: false }).limit(1);
  if (explicitRun) query = query.eq("id", syncId);
  else {
    query = query.eq("status", "completed");
    if (tenantId) query = query.eq("tenant_id", tenantId);
    if (companyId) query = query.eq("company_id", companyId);
    if (scopedProvider) query = query.eq("provider", scopedProvider);
  }
  const { data } = await query;
  const run = data?.[0] as { provider?: string; result_summary?: { statements?: SyncStatements; analysis?: { findings?: ManagementAccountsFinding[] } } } | undefined;
  if (hasRows(run?.result_summary?.statements)) {
    const statements = run!.result_summary!.statements!;
    // The source is the run's actual provider (never hardcoded), preferring the
    // provenance bound onto the statements at sync time.
    const source = (statements.sourceProvider ?? (SYNC_PROVIDERS.has(run!.provider as SourceProvider) ? (run!.provider as SourceProvider) : "xero"));
    return { statements, findings: run!.result_summary!.analysis?.findings ?? [], source };
  }

  // 2. Fall back to the review held in the workspace snapshot (typically uploaded).
  if (hasRows(snapshot?.statements)) {
    return { statements: snapshot!.statements!, findings: snapshot!.findings ?? [], source: (snapshot!.statements!.sourceProvider ?? "upload") };
  }

  return null;
}
