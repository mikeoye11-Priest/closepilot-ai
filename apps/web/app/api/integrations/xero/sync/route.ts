import { requireApiSession } from "@/lib/api-auth";
import { createClient } from "@/lib/supabase-server";
import { authenticatedXeroClient, selectedXeroConnection } from "@/lib/integrations/xero-repository";
import { fetchXeroSyncData } from "@/lib/integrations/xero-sync";
import { analyseParsedFiles, createUpload, scopeAnalysisResult, type ParsedFile } from "@/lib/upload-analysis";
import type { Company, Tenant } from "@/lib/types";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const session = await requireApiSession();
  if (!session.ok) return session.response;
  if (session.authDisabled || !session.userId) return NextResponse.json({ error: "Authentication is required to sync Xero." }, { status: 401 });
  const body = await request.json();
  const tenantId = stringValue(body.tenantId);
  const companyId = stringValue(body.companyId);
  const asOfDate = dateValue(body.asOfDate) ?? new Date().toISOString().slice(0, 10);
  const modifiedSince = dateValue(body.modifiedSince);
  const syncId = crypto.randomUUID();
  const supabase = await createClient();
  const connection = await selectedXeroConnection(supabase, tenantId, companyId);
  await supabase.from("accounting_sync_runs").insert({ id: syncId, tenant_id: tenantId, company_id: companyId, integration_id: connection.id, provider: "xero", sync_type: "finance_and_vat", status: "running" });

  try {
    const xero = await authenticatedXeroClient(supabase, connection);
    const sync = await fetchXeroSyncData(xero, connection.external_tenant_id, asOfDate, modifiedSince ? new Date(modifiedSince) : undefined);
    const parsedFiles = xeroParsedFiles(sync, connection.external_tenant_name ?? "Xero", asOfDate);
    const tenant: Tenant = { id: tenantId, name: stringValue(body.tenantName) || "ClosePilot Workspace", type: body.tenantType === "company" ? "company" : "accounting_practice", plan: stringValue(body.tenantPlan) || "practice" };
    const company: Company = { id: companyId, tenantId, name: stringValue(body.companyName) || connection.external_tenant_name || "Xero Company", industry: stringValue(body.companyIndustry), accountingSystem: "Xero", currency: stringValue(body.currency) || "GBP", country: stringValue(body.country) || "United Kingdom" };
    const analysis = scopeAnalysisResult(analyseParsedFiles(parsedFiles), tenant, company);
    const completedAt = new Date().toISOString();
    await supabase.from("accounting_sync_runs").update({ status: "completed", records_imported: sync.counts.trialBalance + sync.counts.vatRows, result_summary: sync.counts, completed_at: completedAt }).eq("id", syncId);
    await supabase.from("accounting_integrations").update({ last_synced_at: completedAt, updated_at: completedAt }).eq("id", connection.id);
    await supabase.from("audit_logs").insert({ id: crypto.randomUUID(), tenant_id: tenantId, user_id: session.userId, action: "xero_sync_completed", entity_type: "accounting_sync_run", entity_id: syncId });
    return NextResponse.json({ synced: true, syncId, counts: sync.counts, analysis });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Xero sync failed.";
    await supabase.from("accounting_sync_runs").update({ status: "failed", error_message: message, completed_at: new Date().toISOString() }).eq("id", syncId);
    return NextResponse.json({ error: message, syncId }, { status: 502 });
  }
}

function xeroParsedFiles(sync: Awaited<ReturnType<typeof fetchXeroSyncData>>, organisation: string, asOfDate: string): ParsedFile[] {
  const prefix = organisation.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "xero";
  const tbHeaders = ["account_code", "account_name", "debit", "credit", "balance"];
  const vatHeaders = ["date", "type", "party", "description", "net_amount", "vat_amount", "gross_amount", "vat_code", "nominal_code", "reference", "source_system"];
  return [
    { upload: { ...createUpload(`${prefix}-xero-trial-balance-${asOfDate}.csv`, sync.trialBalanceRows.length), fileType: "trial_balance", detectedVendor: "Xero", detectionConfidence: 100, detectionBasis: "Direct Xero Accounting API sync" }, headers: tbHeaders, rows: sync.trialBalanceRows, isParsed: true },
    { upload: { ...createUpload(`${prefix}-xero-vat-transactions-${asOfDate}.csv`, sync.vatRows.length), fileType: "vat_report", detectedVendor: "Xero", detectionConfidence: 100, detectionBasis: "Direct Xero Accounting API sync" }, headers: vatHeaders, rows: sync.vatRows, isParsed: true },
  ];
}

function stringValue(value: unknown) { return typeof value === "string" ? value.trim() : ""; }
function dateValue(value: unknown) { const text = stringValue(value); return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : undefined; }
