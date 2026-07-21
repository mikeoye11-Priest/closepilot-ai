import { requireApiSession } from "@/lib/api-auth";
import { createClient } from "@/lib/supabase-server";
import { decryptIntegrationSecret, encryptIntegrationSecret } from "@/lib/integrations/crypto";
import { exchangeCode, quickbooksApiBase, quickbooksFetch } from "@/lib/integrations/quickbooks";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const session = await requireApiSession();
  if (!session.ok) return session.response;
  if (session.authDisabled || !session.userId) return NextResponse.json({ error: "Authentication is required to complete QuickBooks connection." }, { status: 401 });

  const cookie = cookieValue(request.headers.get("cookie"), "closepilot_qbo_oauth");
  if (!cookie) return NextResponse.json({ error: "QuickBooks OAuth context is missing or expired." }, { status: 400 });

  try {
    const context = JSON.parse(decryptIntegrationSecret(cookie)) as { state: string; tenantId: string; companyId: string; userId: string; createdAt: number };
    if (context.userId !== session.userId || Date.now() - context.createdAt > 600_000) throw new Error("QuickBooks OAuth context is invalid or expired.");

    const url = new URL(request.url);
    const code = url.searchParams.get("code") ?? "";
    const realmId = url.searchParams.get("realmId") ?? "";
    const state = url.searchParams.get("state") ?? "";
    if (!code || !realmId) throw new Error("QuickBooks returned no authorisation code or realm.");
    if (state !== context.state) throw new Error("QuickBooks OAuth state mismatch.");

    const tokens = await exchangeCode(code);
    let companyName = "QuickBooks company";
    try {
      const info = await quickbooksFetch<{ CompanyInfo?: { CompanyName?: string } }>(quickbooksApiBase(), tokens.accessToken, `/v3/company/${realmId}/companyinfo/${realmId}?minorversion=70`);
      companyName = info.CompanyInfo?.CompanyName || companyName;
    } catch { /* name is cosmetic — proceed without it */ }

    const supabase = await createClient();
    const row = {
      id: crypto.randomUUID(),
      tenant_id: context.tenantId,
      company_id: context.companyId,
      user_id: session.userId,
      provider: "quickbooks",
      external_tenant_id: realmId,
      external_tenant_name: companyName,
      external_connection_id: null,
      status: "connected",
      selected: true,
      access_token_encrypted: encryptIntegrationSecret(tokens.accessToken),
      refresh_token_encrypted: encryptIntegrationSecret(tokens.refreshToken),
      id_token_encrypted: null,
      token_expires_at: tokens.expiresAt,
      scopes: tokens.scopes,
      updated_at: new Date().toISOString(),
    };
    const { error } = await supabase.from("accounting_integrations").upsert([row], { onConflict: "tenant_id,company_id,provider,external_tenant_id" });
    if (error) throw new Error(error.message);
    await supabase.from("audit_logs").insert({ id: crypto.randomUUID(), tenant_id: context.tenantId, user_id: session.userId, action: "quickbooks_connected", entity_type: "company", entity_id: context.companyId });

    const redirect = new URL("/", request.url);
    redirect.searchParams.set("integration", "quickbooks");
    redirect.searchParams.set("status", "connected");
    const response = NextResponse.redirect(redirect);
    response.cookies.delete("closepilot_qbo_oauth");
    return response;
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "QuickBooks OAuth callback failed." }, { status: 400 });
  }
}

function cookieValue(header: string | null, name: string) {
  const pair = header?.split(";").map((item) => item.trim()).find((item) => item.startsWith(`${name}=`));
  return pair ? decodeURIComponent(pair.slice(name.length + 1)) : "";
}
