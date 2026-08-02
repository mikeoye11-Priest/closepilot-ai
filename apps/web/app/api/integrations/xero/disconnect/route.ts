import { requireApiSession } from "@/lib/api-auth";
import { createClient } from "@/lib/supabase-server";
import { authenticatedXeroClient, type XeroIntegrationRow } from "@/lib/integrations/xero-repository";
import { reportError } from "@/lib/logger";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const session = await requireApiSession();
  if (!session.ok) return session.response;
  if (session.authDisabled || !session.userId) return NextResponse.json({ error: "Authentication is required." }, { status: 401 });
  const body = await request.json();
  const integrationId = typeof body.integrationId === "string" ? body.integrationId : "";
  const supabase = await createClient();
  const { data, error } = await supabase.from("accounting_integrations").select("*").eq("id", integrationId).eq("provider", "xero").eq("user_id", session.userId).single();
  if (error || !data) return NextResponse.json({ error: error?.message || "Xero connection not found." }, { status: 404 });
  const connection = data as XeroIntegrationRow;

  // Revoking the token at Xero is best-effort: a disconnect must always succeed so
  // a broken/expired connection can be removed. Previously this ran the token
  // refresh + remote revoke unguarded, so a dead refresh token (exactly the state
  // a "needs attention" connection is in) threw and returned 500 — leaving the
  // user unable to disconnect. Now the local row is deleted regardless.
  if (connection.external_connection_id) {
    try {
      const xero = await authenticatedXeroClient(supabase, connection);
      await xero.disconnect(connection.external_connection_id);
    } catch (revokeError) {
      reportError(revokeError, { route: "xero/disconnect", integrationId: connection.id, note: "remote revoke failed; removing local connection anyway" });
    }
  }

  const { error: deleteError } = await supabase.from("accounting_integrations").delete().eq("id", connection.id);
  if (deleteError) return NextResponse.json({ error: deleteError.message }, { status: 500 });
  await supabase.from("audit_logs").insert({ id: crypto.randomUUID(), tenant_id: connection.tenant_id, user_id: session.userId, action: "xero_disconnected", entity_type: "accounting_integration", entity_id: connection.id });
  return NextResponse.json({ disconnected: true });
}
