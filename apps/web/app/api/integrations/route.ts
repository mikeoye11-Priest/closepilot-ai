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
  const xeroOrganisations = !session.authDisabled && UUID_RE.test(tenantId) && UUID_RE.test(companyId)
    ? await connectedXeroOrganisations(tenantId, companyId)
    : [];
  const integrations: AccountingIntegrationState[] = [
    integrationState("xero", "Xero", xeroConfigured(), xeroOrganisations, tenantId, companyId),
    integrationState("quickbooks", "QuickBooks Online", Boolean(process.env.QUICKBOOKS_CLIENT_ID && process.env.QUICKBOOKS_CLIENT_SECRET && process.env.QUICKBOOKS_REDIRECT_URI && process.env.INTEGRATION_ENCRYPTION_KEY)),
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
        ? "Choose the Xero organisation that belongs to this ClosePilot company."
        : configured
      ? "OAuth application credentials detected. Ready to authorise."
      : `Set ${prefix}_CLIENT_ID, ${prefix}_CLIENT_SECRET and ${prefix}_REDIRECT_URI.`,
    connectUrl: configured && provider === "xero" && tenantId && companyId ? `/api/integrations/xero/connect?tenantId=${encodeURIComponent(tenantId)}&companyId=${encodeURIComponent(companyId)}` : undefined,
    organisations,
  };
}

async function connectedXeroOrganisations(tenantId: string, companyId: string): Promise<NonNullable<AccountingIntegrationState["organisations"]>> {
  const supabase = await createClient();
  const { data } = await supabase.from("accounting_integrations")
    .select("id,external_tenant_name,selected,status,last_synced_at")
    .eq("tenant_id", tenantId).eq("company_id", companyId).eq("provider", "xero");
  return (data ?? []).map((row) => ({ id: row.id, name: row.external_tenant_name || "Xero organisation", selected: row.selected, status: row.status, lastSyncedAt: row.last_synced_at ?? undefined }));
}
