import { requireApiSession } from "@/lib/api-auth";
import { createClient } from "@/lib/supabase-server";
import { authenticatedXeroClient, selectedXeroConnection } from "@/lib/integrations/xero-repository";
import { fetchXeroSyncData } from "@/lib/integrations/xero-sync";
import { xeroParsedFiles } from "@/lib/integrations/xero-parsed-files";
import { describeXeroError } from "@/lib/integrations/xero";
import { analyseParsedFiles, scopeAnalysisResult } from "@/lib/upload-analysis";
import type { Company, Tenant } from "@/lib/types";
import { reportError } from "@/lib/logger";
import { after, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 300;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
  const session = await requireApiSession();
  if (!session.ok) return session.response;
  if (session.authDisabled || !session.userId) return NextResponse.json({ error: "Authentication is required to read a Xero sync." }, { status: 401 });

  const syncId = new URL(request.url).searchParams.get("syncId") ?? "";
  if (!UUID_RE.test(syncId)) return NextResponse.json({ error: "A valid syncId is required." }, { status: 400 });

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("accounting_sync_runs")
    .select("id,status,records_imported,result_summary,error_message,started_at,completed_at")
    .eq("id", syncId)
    .single();
  if (error || !data) return NextResponse.json({ error: error?.message || "Xero sync not found." }, { status: 404 });

  const summary = data.result_summary && typeof data.result_summary === "object" ? data.result_summary as Record<string, unknown> : {};
  return NextResponse.json({
    syncId: data.id,
    status: data.status,
    recordsImported: data.records_imported,
    counts: summary.counts,
    warnings: summary.warnings,
    analysis: data.status === "completed" ? summary.analysis : undefined,
    error: data.error_message,
    startedAt: data.started_at,
    completedAt: data.completed_at,
  });
}

export async function POST(request: Request) {
  const session = await requireApiSession();
  if (!session.ok) return session.response;
  if (session.authDisabled || !session.userId) return NextResponse.json({ error: "Authentication is required to sync Xero." }, { status: 401 });
  const body = await request.json();
  const tenantId = stringValue(body.tenantId);
  const companyId = stringValue(body.companyId);
  const asOfDate = dateValue(body.asOfDate) ?? new Date().toISOString().slice(0, 10);
  const syncId = crypto.randomUUID();
  const supabase = await createClient();
  const connection = await selectedXeroConnection(supabase, tenantId, companyId);
  const { error: queueError } = await supabase.from("accounting_sync_runs").insert({ id: syncId, tenant_id: tenantId, company_id: companyId, integration_id: connection.id, provider: "xero", sync_type: "finance_and_vat", status: "queued" });
  if (queueError) return NextResponse.json({ error: queueError.message }, { status: 500 });

  after(() => runXeroSync({ supabase, connection, syncId, sessionUserId: session.userId!, body, tenantId, companyId, asOfDate }));
  return NextResponse.json({ queued: true, syncId, status: "queued" }, { status: 202 });
}

async function runXeroSync({ supabase, connection, syncId, sessionUserId, body, tenantId, companyId, asOfDate }: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  connection: Awaited<ReturnType<typeof selectedXeroConnection>>;
  syncId: string;
  sessionUserId: string;
  body: Record<string, unknown>;
  tenantId: string;
  companyId: string;
  asOfDate: string;
}) {
  try {
    await supabase.from("accounting_sync_runs").update({ status: "running", started_at: new Date().toISOString() }).eq("id", syncId);
    const xero = await authenticatedXeroClient(supabase, connection);
    const sync = await fetchXeroSyncData(xero, connection.external_tenant_id, asOfDate);
    const imported = sync.counts.trialBalance + sync.counts.profitLoss + sync.counts.balanceSheet + sync.counts.agedDebtors + sync.counts.agedCreditors + sync.counts.vatRows;
    // Only a total shutout is a failure; a partial sync completes with whatever
    // came through and surfaces which source(s) failed via warnings.
    if (imported === 0 && sync.warnings.length) throw new Error(`Xero returned no data — ${sync.warnings.join("; ")}`);
    if (sync.warnings.length) reportError(new Error(`Xero sync partial: ${sync.warnings.join("; ")}`), { route: "xero/sync", syncId, tenantId, companyId });
    const parsedFiles = xeroParsedFiles(sync, connection.external_tenant_name ?? "Xero", asOfDate);
    const tenant: Tenant = { id: tenantId, name: stringValue(body.tenantName) || "ClosePilot Workspace", type: body.tenantType === "company" ? "company" : "accounting_practice", plan: stringValue(body.tenantPlan) || "practice" };
    const company: Company = { id: companyId, tenantId, name: stringValue(body.companyName) || connection.external_tenant_name || "Xero Company", industry: stringValue(body.companyIndustry), accountingSystem: "Xero", currency: stringValue(body.currency) || "GBP", country: stringValue(body.country) || "United Kingdom" };
    const analysis = scopeAnalysisResult(analyseParsedFiles(parsedFiles), tenant, company);
    // Definitive VAT diagnostic: when VAT rows were synced but the engine still
    // produced an empty review, capture the actual shape of the first few rows
    // (amounts/codes/type only — no party or description) so we can see whether
    // the rows are amount-less or the engine is dropping populated rows. Surfaces
    // in the sync warnings and on the VAT Assurance empty state.
    if (analysis.vatReview?.source === "empty" && sync.vatRows.length) {
      const sample = sync.vatRows.slice(0, 4).map((row) => `{net:${row.net_amount ?? ""}, vat:${row.vat_amount ?? ""}, gross:${row.gross_amount ?? ""}, code:${row.vat_code ?? ""}, type:${row.type ?? ""}}`);
      sync.warnings.push(`vat diagnostic: ${sync.vatRows.length} VAT row(s) but the review is empty. First rows — ${sample.join(" ")}`);
    }
    const completedAt = new Date().toISOString();
    // Persist the statement line items (not just analysis metadata) so the
    // management-accounts pack can render P&L / balance sheet / aged / cash.
    const statements = { asOfDate, periodStart: sync.periodStart, currency: company.currency, companyName: company.name, companyIndustry: company.industry, profitLoss: sync.profitLossRows, priorProfitLoss: sync.priorProfitLossRows, balanceSheet: sync.balanceSheetRows, agedDebtors: sync.agedDebtorRows, agedCreditors: sync.agedCreditorRows, bank: sync.bankReconRows, trialBalance: sync.trialBalanceRows };
    await supabase.from("accounting_sync_runs").update({ status: "completed", records_imported: imported, result_summary: { counts: sync.counts, warnings: sync.warnings, statements, analysis }, completed_at: completedAt }).eq("id", syncId);
    await supabase.from("accounting_integrations").update({ last_synced_at: completedAt, updated_at: completedAt }).eq("id", connection.id);
    await supabase.from("audit_logs").insert({ id: crypto.randomUUID(), tenant_id: tenantId, user_id: sessionUserId, action: "xero_sync_completed", entity_type: "accounting_sync_run", entity_id: syncId });
  } catch (error) {
    const message = describeXeroError(error);
    reportError(error, { route: "xero/sync", syncId, tenantId, companyId });
    await supabase.from("accounting_sync_runs").update({ status: "failed", error_message: message, completed_at: new Date().toISOString() }).eq("id", syncId);
  }
}

function stringValue(value: unknown) { return typeof value === "string" ? value.trim() : ""; }
function dateValue(value: unknown) { const text = stringValue(value); return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : undefined; }
