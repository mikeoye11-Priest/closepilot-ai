// Shared loader for the accounts-production routes. Returns the reporting
// `statements` for a company from the most recent Xero sync
// (accounting_sync_runs), or — when there is no sync — from the current user's
// workspace snapshot, where statements assembled from uploaded documents are
// persisted (see upload-statements.ts + the app-shell persist effect). This is
// what lets uploaded TB/P&L/BS files produce the same packs as a Xero sync.

import type { createClient } from "./supabase-server";
import type { SyncStatements, ManagementAccountsFinding } from "./management-accounts";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const hasRows = (s?: SyncStatements): s is SyncStatements =>
  Boolean(s && (((s.profitLoss?.length ?? 0) > 0) || ((s.balanceSheet?.length ?? 0) > 0)));

export type LoadedStatements = { statements: SyncStatements; findings: ManagementAccountsFinding[]; source: "xero" | "upload" };

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
  opts: { userId: string; syncId?: string; tenantId?: string; companyId?: string },
): Promise<LoadedStatements | null> {
  const { userId, syncId = "", tenantId = "", companyId = "" } = opts;

  // 1. Latest completed Xero sync for this company (or a specific sync run).
  let query = supabase.from("accounting_sync_runs").select("id,result_summary").order("started_at", { ascending: false }).limit(1);
  if (UUID_RE.test(syncId)) query = query.eq("id", syncId);
  else {
    query = query.eq("status", "completed");
    if (tenantId) query = query.eq("tenant_id", tenantId);
    if (companyId) query = query.eq("company_id", companyId);
  }
  const { data } = await query;
  const run = data?.[0] as { result_summary?: { statements?: SyncStatements; analysis?: { findings?: ManagementAccountsFinding[] } } } | undefined;
  if (hasRows(run?.result_summary?.statements)) {
    return { statements: run!.result_summary!.statements!, findings: run!.result_summary!.analysis?.findings ?? [], source: "xero" };
  }

  // 2. Fall back to statements assembled from uploads, held in the user's
  //    workspace snapshot for this company.
  if (companyId) {
    const { data: ws } = await supabase.from("user_workspaces").select("data").eq("user_id", userId).limit(1);
    const snapshot = (ws?.[0]?.data as { companySnapshots?: Record<string, { statements?: SyncStatements; findings?: ManagementAccountsFinding[] }> } | undefined)?.companySnapshots?.[companyId];
    if (hasRows(snapshot?.statements)) {
      return { statements: snapshot!.statements!, findings: snapshot!.findings ?? [], source: "upload" };
    }
  }

  return null;
}
