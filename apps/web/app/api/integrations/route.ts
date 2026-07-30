import { requireApiSession } from "@/lib/api-auth";
import { createClient } from "@/lib/supabase-server";
import type { AccountingIntegrationState } from "@/lib/integrations/types";
import { xeroConfigured } from "@/lib/integrations/xero";
import { expireStaleRuns } from "@/lib/integrations/sync-runs";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// The cross-file reconciliation checks (REC_001–005 + TB balance) that prove the
// imported data is complete and accurate — surfaced per sync as data integrity.
const RECONCILIATION_RE = /trial balance balances|(ar|ap) ledger agrees|(debtors|creditors) control|vat (report agrees|control)|balance sheet equation|bank reconciliation|p&l movement|retained earnings|cash accounts ready/i;

export async function GET(request: Request) {
  const session = await requireApiSession();
  if (!session.ok) return session.response;

  const url = new URL(request.url);
  const tenantId = url.searchParams.get("tenantId") ?? "";
  const companyId = url.searchParams.get("companyId") ?? "";
  const realWorkspace = !session.authDisabled && UUID_RE.test(tenantId) && UUID_RE.test(companyId);
  const xeroOrganisations = realWorkspace ? await connectedOrganisations("xero", tenantId, companyId) : [];
  const quickbooksOrganisations = realWorkspace ? await connectedOrganisations("quickbooks", tenantId, companyId) : [];
  const sageOrganisations = realWorkspace ? await connectedOrganisations("sage", tenantId, companyId) : [];
  const quickbooksConfigured = Boolean(process.env.QUICKBOOKS_CLIENT_ID && process.env.QUICKBOOKS_CLIENT_SECRET && process.env.QUICKBOOKS_REDIRECT_URI && process.env.INTEGRATION_ENCRYPTION_KEY);
  const sageConfigured = Boolean(process.env.SAGE_CLIENT_ID && process.env.SAGE_CLIENT_SECRET && process.env.SAGE_REDIRECT_URI && process.env.INTEGRATION_ENCRYPTION_KEY);
  const integrations: AccountingIntegrationState[] = [
    integrationState("xero", "Xero", xeroConfigured(), xeroOrganisations, tenantId, companyId),
    integrationState("quickbooks", "QuickBooks Online", quickbooksConfigured, quickbooksOrganisations, tenantId, companyId),
    integrationState("sage", "Sage Business Cloud", sageConfigured, sageOrganisations, tenantId, companyId),
  ];
  const recentActivity = realWorkspace ? await recentIntegrationActivity(tenantId) : [];
  return NextResponse.json({ integrations, recentActivity });
}

export type IntegrationActivity = { action: string; at: string; entityType?: string };

// The current user's recent connect / sync / disconnect / erase events for this
// tenant, so the audit trail is visible (not just written). RLS scopes audit_logs
// to the acting user; `%connected` matches both connect and disconnect.
async function recentIntegrationActivity(tenantId: string): Promise<IntegrationActivity[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("audit_logs")
    .select("action,created_at,entity_type")
    .eq("tenant_id", tenantId)
    .or("action.ilike.%connected,action.ilike.%sync_completed,action.ilike.%erased")
    .order("created_at", { ascending: false })
    .limit(8);
  return (data ?? []).map((row) => ({ action: row.action, at: row.created_at, entityType: row.entity_type ?? undefined }));
}

function integrationState(provider: AccountingIntegrationState["provider"], label: string, configured: boolean, organisations: AccountingIntegrationState["organisations"] = [], tenantId = "", companyId = ""): AccountingIntegrationState {
  const prefix = provider.toUpperCase();
  const connected = organisations.some((organisation) => organisation.selected);
  const selectionRequired = organisations.length > 1 && !connected;
  return {
    provider,
    label,
    status: connected ? "connected" : selectionRequired ? "tenant_selection_required" : configured ? "ready_to_connect" : "configuration_required",
    configured,
    connected,
    capabilities: provider === "xero" ? ["trial_balance", "vat_transactions", "contacts"] : ["trial_balance", "vat_transactions", "vat_returns", "contacts"],
    detail: connected
      ? `Connected to ${organisations.find((organisation) => organisation.selected)?.name}.`
      : selectionRequired
        ? `Choose the ${label} organisation that belongs to this ClosePilot company.`
        : configured
      ? "OAuth application credentials detected. Ready to authorise."
      : `Set ${prefix}_CLIENT_ID, ${prefix}_CLIENT_SECRET and ${prefix}_REDIRECT_URI.`,
    // Only offer a connect link for a real (UUID) workspace. The sample/demo
    // workspace uses non-UUID ids (e.g. company_pilot_brightlane); linking it
    // would dead-end on the connect route's 400 "A UUID tenantId and companyId
    // are required." The client shows a "create a workspace first" guard instead.
    connectUrl: configured && UUID_RE.test(tenantId) && UUID_RE.test(companyId) ? `/api/integrations/${provider}/connect?tenantId=${encodeURIComponent(tenantId)}&companyId=${encodeURIComponent(companyId)}` : undefined,
    organisations,
  };
}

async function connectedOrganisations(provider: AccountingIntegrationState["provider"], tenantId: string, companyId: string): Promise<NonNullable<AccountingIntegrationState["organisations"]>> {
  const supabase = await createClient();
  const fallback = provider === "xero" ? "Xero organisation" : provider === "sage" ? "Sage business" : "QuickBooks company";
  const { data } = await supabase.from("accounting_integrations")
    .select("id,external_tenant_name,selected,status,last_synced_at")
    .eq("tenant_id", tenantId).eq("company_id", companyId).eq("provider", provider);
  const connections = data ?? [];
  if (!connections.length) return [];

  // Self-heal any stuck runs before reading, so a dead background job doesn't
  // leave the connection showing "Syncing…" forever.
  await expireStaleRuns(supabase, connections.map((connection) => connection.id));

  // Latest sync run per connection → lifecycle stage + a summary of the last sync.
  const { data: runs } = await supabase.from("accounting_sync_runs")
    .select("integration_id,status,records_imported,result_summary,error_message,completed_at,started_at")
    .in("integration_id", connections.map((connection) => connection.id))
    .order("started_at", { ascending: false });
  const latest = new Map<string, NonNullable<typeof runs>[number]>();
  const completedByIntegration = new Map<string, NonNullable<typeof runs>>();
  for (const run of runs ?? []) {
    if (!latest.has(run.integration_id)) latest.set(run.integration_id, run);
    if (run.status === "completed") {
      const list = completedByIntegration.get(run.integration_id) ?? [];
      list.push(run); // runs are ordered started_at desc, so [0] = latest completed
      completedByIntegration.set(run.integration_id, list);
    }
  }

  return connections.map((row) => {
    const run = latest.get(row.id);
    const summary = (run?.result_summary && typeof run.result_summary === "object" ? run.result_summary : {}) as {
      warnings?: unknown[];
      statements?: { periodStart?: string; asOfDate?: string; vatPeriodStart?: string; vatPeriodEnd?: string };
      analysis?: { validationChecks?: Array<{ name?: string; status?: string; detail?: string }> };
    };
    const statements = summary.statements ?? {};
    const recChecks = (summary.analysis?.validationChecks ?? []).filter((check) => RECONCILIATION_RE.test(String(check.name ?? "")));
    const integrity = run?.status === "completed" && recChecks.length
      ? {
          total: recChecks.length,
          passed: recChecks.filter((check) => check.status === "passed").length,
          issues: recChecks.filter((check) => check.status !== "passed").map((check) => ({ name: String(check.name ?? ""), status: String(check.status ?? ""), detail: check.detail })),
        }
      : undefined;
    const sync = run ? {
      status: run.status,
      recordsImported: run.records_imported ?? undefined,
      periodStart: statements.periodStart,
      periodEnd: statements.asOfDate,
      vatPeriodStart: statements.vatPeriodStart,
      vatPeriodEnd: statements.vatPeriodEnd,
      completedAt: run.completed_at ?? undefined,
      warnings: Array.isArray(summary.warnings) ? summary.warnings.length : 0,
      error: run.error_message ?? undefined,
      integrity,
    } : undefined;
    const stage = stageFor(row.selected, run?.status, row.status);
    // Change detection: how the imported record count moved between the two most
    // recent completed syncs (a drop usually flags a partial pull).
    const completed = completedByIntegration.get(row.id) ?? [];
    const change = completed.length >= 2
      ? { sinceDate: completed[1].completed_at ?? completed[1].started_at ?? undefined, recordsDelta: (completed[0].records_imported ?? 0) - (completed[1].records_imported ?? 0), previousRecords: completed[1].records_imported ?? 0 }
      : undefined;
    return { id: row.id, name: row.external_tenant_name || fallback, selected: row.selected, status: row.status, lastSyncedAt: row.last_synced_at ?? undefined, stage, sync, change };
  });
}

function stageFor(selected: boolean, runStatus?: string, connectionStatus?: string): NonNullable<NonNullable<AccountingIntegrationState["organisations"]>[number]["stage"]> {
  // A revoked/expired grant overrides everything — the connection can't sync
  // until it's reconnected, regardless of the last run's outcome.
  if (connectionStatus === "reauth_required") return "reauth_required";
  if (!selected) return "authorised";
  if (!runStatus) return "ready_to_sync";
  if (runStatus === "queued" || runStatus === "running") return "syncing";
  if (runStatus === "failed") return "needs_attention";
  return "synced"; // completed
}
