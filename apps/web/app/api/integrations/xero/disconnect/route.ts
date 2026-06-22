import { requireApiSession } from "@/lib/api-auth";
import { createClient } from "@/lib/supabase-server";
import { authenticatedXeroClient, type XeroIntegrationRow } from "@/lib/integrations/xero-repository";
import { NextResponse } from "next/server";

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
  const xero = await authenticatedXeroClient(supabase, connection);
  if (connection.external_connection_id) await xero.disconnect(connection.external_connection_id);
  const { error: deleteError } = await supabase.from("accounting_integrations").delete().eq("id", connection.id);
  if (deleteError) return NextResponse.json({ error: deleteError.message }, { status: 500 });
  await supabase.from("audit_logs").insert({ id: crypto.randomUUID(), tenant_id: connection.tenant_id, user_id: session.userId, action: "xero_disconnected", entity_type: "accounting_integration", entity_id: connection.id });
  return NextResponse.json({ disconnected: true });
}
