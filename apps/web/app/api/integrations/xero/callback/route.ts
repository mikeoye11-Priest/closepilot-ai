import { requireApiSession } from "@/lib/api-auth";
import { createClient } from "@/lib/supabase-server";
import { decryptIntegrationSecret, encryptIntegrationSecret } from "@/lib/integrations/crypto";
import { createXeroClient, tokenExpiry, tokenScopes, xeroCallbackUrl } from "@/lib/integrations/xero";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const session = await requireApiSession();
  if (!session.ok) return session.response;
  if (session.authDisabled || !session.userId) return NextResponse.json({ error: "Authentication is required to complete Xero connection." }, { status: 401 });

  const cookie = cookieValue(request.headers.get("cookie"), "closepilot_xero_oauth");
  if (!cookie) return NextResponse.json({ error: "Xero OAuth context is missing or expired." }, { status: 400 });

  try {
    const context = JSON.parse(decryptIntegrationSecret(cookie)) as { state: string; tenantId: string; companyId: string; userId: string; createdAt: number };
    if (context.userId !== session.userId || Date.now() - context.createdAt > 600_000) throw new Error("Xero OAuth context is invalid or expired.");
    const xero = createXeroClient(context.state);
    const tokenSet = await xero.apiCallback(xeroCallbackUrl(request.url));
    if (!tokenSet.access_token || !tokenSet.refresh_token) throw new Error("Xero returned an incomplete token set.");
    const tenants = await xero.updateTenants();
    if (!tenants.length) throw new Error("No Xero organisations were authorised.");

    const supabase = await createClient();
    const rows = tenants.map((tenant: Record<string, unknown>) => ({
      id: crypto.randomUUID(),
      tenant_id: context.tenantId,
      company_id: context.companyId,
      user_id: session.userId,
      provider: "xero",
      external_tenant_id: String(tenant.tenantId ?? ""),
      external_tenant_name: String(tenant.tenantName ?? "Xero organisation"),
      external_connection_id: String(tenant.id ?? ""),
      status: tenants.length === 1 ? "connected" : "tenant_selection_required",
      selected: tenants.length === 1,
      access_token_encrypted: encryptIntegrationSecret(tokenSet.access_token as string),
      refresh_token_encrypted: encryptIntegrationSecret(tokenSet.refresh_token as string),
      id_token_encrypted: tokenSet.id_token ? encryptIntegrationSecret(tokenSet.id_token) : null,
      token_expires_at: tokenExpiry(tokenSet),
      scopes: tokenScopes(tokenSet),
      updated_at: new Date().toISOString(),
    }));
    const { error } = await supabase.from("accounting_integrations").upsert(rows, { onConflict: "tenant_id,company_id,provider,external_tenant_id" });
    if (error) throw new Error(error.message);
    await supabase.from("audit_logs").insert({ id: crypto.randomUUID(), tenant_id: context.tenantId, user_id: session.userId, action: "xero_connected", entity_type: "company", entity_id: context.companyId });

    const redirect = new URL("/", request.url);
    redirect.searchParams.set("integration", "xero");
    redirect.searchParams.set("status", tenants.length === 1 ? "connected" : "select_tenant");
    const response = NextResponse.redirect(redirect);
    response.cookies.delete("closepilot_xero_oauth");
    return response;
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Xero OAuth callback failed." }, { status: 400 });
  }
}

function cookieValue(header: string | null, name: string) {
  const pair = header?.split(";").map((item) => item.trim()).find((item) => item.startsWith(`${name}=`));
  return pair ? decodeURIComponent(pair.slice(name.length + 1)) : "";
}
