import { requireApiSession } from "@/lib/api-auth";
import { createClient } from "@/lib/supabase-server";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const session = await requireApiSession();
  if (!session.ok) return session.response;
  if (session.authDisabled || !session.userId) return NextResponse.json({ error: "Authentication is required." }, { status: 401 });
  const body = await request.json();
  const integrationId = typeof body.integrationId === "string" ? body.integrationId : "";
  const supabase = await createClient();
  const { data, error } = await supabase.from("accounting_integrations").select("id,tenant_id").eq("id", integrationId).eq("provider", "quickbooks").eq("user_id", session.userId).single();
  if (error || !data) return NextResponse.json({ error: error?.message || "QuickBooks connection not found." }, { status: 404 });
  const { error: deleteError } = await supabase.from("accounting_integrations").delete().eq("id", data.id);
  if (deleteError) return NextResponse.json({ error: deleteError.message }, { status: 500 });
  await supabase.from("audit_logs").insert({ id: crypto.randomUUID(), tenant_id: data.tenant_id, user_id: session.userId, action: "quickbooks_disconnected", entity_type: "accounting_integration", entity_id: data.id });
  return NextResponse.json({ disconnected: true });
}
