import { requireApiSession } from "@/lib/api-auth";
import { createClient } from "@/lib/supabase-server";
import { decryptIntegrationSecret, encryptIntegrationSecret } from "@/lib/integrations/crypto";
import { exchangeCode, sageFetch, SAGE_SCOPES } from "@/lib/integrations/sage";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const session = await requireApiSession();
  if (!session.ok) return session.response;
  if (session.authDisabled || !session.userId) return NextResponse.json({ error: "Authentication is required to complete Sage connection." }, { status: 401 });

  const cookie = cookieValue(request.headers.get("cookie"), "closepilot_sage_oauth");
  if (!cookie) return NextResponse.json({ error: "Sage OAuth context is missing or expired." }, { status: 400 });

  try {
    const context = JSON.parse(decryptIntegrationSecret(cookie)) as { state: string; tenantId: string; companyId: string; userId: string; createdAt: number };
    if (context.userId !== session.userId || Date.now() - context.createdAt > 600_000) throw new Error("Sage OAuth context is invalid or expired.");

    const url = new URL(request.url);
    const code = url.searchParams.get("code") ?? "";
    const state = url.searchParams.get("state") ?? "";
    if (!code) throw new Error("Sage returned no authorisation code.");
    if (state !== context.state) throw new Error("Sage OAuth state mismatch.");

    const tokens = await exchangeCode(code);
    // Sage OAuth returns no business id — resolve it from /businesses.
    let businessId = "";
    let businessName = "Sage business";
    try {
      const businesses = await sageFetch<{ $items?: Array<{ id?: string; displayed_as?: string }> }>(tokens.accessToken, "/businesses");
      const first = businesses.$items?.[0];
      businessId = String(first?.id ?? "");
      businessName = String(first?.displayed_as ?? businessName);
    } catch { /* fall through — a missing business id will surface on first sync */ }
    if (!businessId) throw new Error("No Sage business was authorised for this account.");

    const supabase = await createClient();
    const row = {
      id: crypto.randomUUID(),
      tenant_id: context.tenantId,
      company_id: context.companyId,
      user_id: session.userId,
      provider: "sage",
      external_tenant_id: businessId,
      external_tenant_name: businessName,
      external_connection_id: null,
      status: "connected",
      selected: true,
      access_token_encrypted: encryptIntegrationSecret(tokens.accessToken),
      refresh_token_encrypted: encryptIntegrationSecret(tokens.refreshToken),
      id_token_encrypted: null,
      token_expires_at: tokens.expiresAt,
      scopes: SAGE_SCOPES,
      updated_at: new Date().toISOString(),
    };
    const { error } = await supabase.from("accounting_integrations").upsert([row], { onConflict: "tenant_id,company_id,provider,external_tenant_id" });
    if (error) throw new Error(error.message);
    await supabase.from("audit_logs").insert({ id: crypto.randomUUID(), tenant_id: context.tenantId, user_id: session.userId, action: "sage_connected", entity_type: "company", entity_id: context.companyId });

    const redirect = new URL("/", request.url);
    redirect.searchParams.set("integration", "sage");
    redirect.searchParams.set("status", "connected");
    const response = NextResponse.redirect(redirect);
    response.cookies.delete("closepilot_sage_oauth");
    return response;
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Sage OAuth callback failed." }, { status: 400 });
  }
}

function cookieValue(header: string | null, name: string) {
  const pair = header?.split(";").map((item) => item.trim()).find((item) => item.startsWith(`${name}=`));
  return pair ? decodeURIComponent(pair.slice(name.length + 1)) : "";
}
