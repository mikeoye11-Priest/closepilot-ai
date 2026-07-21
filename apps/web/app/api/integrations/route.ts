import { requireApiSession } from "@/lib/api-auth";
import { createClient } from "@/lib/supabase-server";
import type { AccountingIntegrationState } from "@/lib/integrations/types";
import { xeroConfigured } from "@/lib/integrations/xero";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
  const session = await requireApiSession();
  if (!session.ok) return session.response;

  const url = new URL(request.url);
  const tenantId = url.searchParams.get("tenantId") ?? "";
  const companyId = url.searchParams.get("companyId") ?? "";
  const realWorkspace = !session.authDisabled && UUID_RE.test(tenantId) && UUID_RE.test(companyId);
  const xeroOrganisations = realWorkspace ? await connectedOrganisations("xero", tenantId, companyId) : [];
  const quickbooksOrganisations = realWorkspace ? await connectedOrganisations("quickbooks", tenantId, companyId) : [];
  const quickbooksConfigured = Boolean(process.env.QUICKBOOKS_CLIENT_ID && process.env.QUICKBOOKS_CLIENT_SECRET && process.env.QUICKBOOKS_REDIRECT_URI && process.env.INTEGRATION_ENCRYPTION_KEY);
  const integrations: AccountingIntegrationState[] = [
    integrationState("xero", "Xero", xeroConfigured(), xeroOrganisations, tenantId, companyId),
    integrationState("quickbooks", "QuickBooks Online", quickbooksConfigured, quickbooksOrganisations, tenantId, companyId),
  ];
  return NextResponse.json({ integrations });
}

function integrationState(provider: AccountingIntegrationState["provider"], label: string, configured: boolean, organisations: AccountingIntegrationState["organisations"] = [], tenantId = "", companyId = ""): AccountingIntegrationState {
  const prefix = provider === "xero" ? "XERO" : "QUICKBOOKS";
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
  const fallback = provider === "xero" ? "Xero organisation" : "QuickBooks company";
  const { data } = await supabase.from("accounting_integrations")
    .select("id,external_tenant_name,selected,status,last_synced_at")
    .eq("tenant_id", tenantId).eq("company_id", companyId).eq("provider", provider);
  return (data ?? []).map((row) => ({ id: row.id, name: row.external_tenant_name || fallback, selected: row.selected, status: row.status, lastSyncedAt: row.last_synced_at ?? undefined }));
}
