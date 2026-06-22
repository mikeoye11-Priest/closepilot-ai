import { requireApiSession } from "@/lib/api-auth";
import { createClient } from "@/lib/supabase-server";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const session = await requireApiSession();
  if (!session.ok) return session.response;
  if (session.authDisabled || !session.userId) return NextResponse.json({ error: "Authentication is required." }, { status: 401 });
  const body = await request.json();
  const tenantId = stringValue(body.tenantId);
  const companyId = stringValue(body.companyId);
  const integrationId = stringValue(body.integrationId);
  const supabase = await createClient();
  const { error: clearError } = await supabase.from("accounting_integrations").update({ selected: false, status: "tenant_selection_required", updated_at: new Date().toISOString() }).eq("tenant_id", tenantId).eq("company_id", companyId).eq("provider", "xero");
  if (clearError) return NextResponse.json({ error: clearError.message }, { status: 500 });
  const { error } = await supabase.from("accounting_integrations").update({ selected: true, status: "connected", updated_at: new Date().toISOString() }).eq("id", integrationId).eq("tenant_id", tenantId).eq("company_id", companyId).eq("user_id", session.userId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ selected: true, integrationId });
}

function stringValue(value: unknown) { return typeof value === "string" ? value.trim() : ""; }
