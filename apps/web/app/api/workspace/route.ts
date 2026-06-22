import { createClient } from "@/lib/supabase-server";
import { requireApiSession } from "@/lib/api-auth";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET() {
  const session = await requireApiSession();
  if (!session.ok) return session.response;
  if (session.authDisabled) return NextResponse.json({ workspace: null });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  const { data, error } = await supabase
    .from("user_workspaces")
    .select("data")
    .eq("user_id", user.id)
    .single();

  if (error || !data) return NextResponse.json({ workspace: null });
  return NextResponse.json({ workspace: data.data });
}

export async function POST(request: Request) {
  const session = await requireApiSession();
  if (!session.ok) return session.response;
  if (session.authDisabled) return NextResponse.json({ success: true });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  const body = await request.json();
  await bootstrapWorkspaceScope(supabase, body);

  const { error } = await supabase
    .from("user_workspaces")
    .upsert({ user_id: user.id, data: body, updated_at: new Date().toISOString() }, { onConflict: "user_id" });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}

async function bootstrapWorkspaceScope(supabase: Awaited<ReturnType<typeof createClient>>, body: unknown) {
  if (!body || typeof body !== "object") return;

  const workspace = body as {
    tenant?: { id?: unknown; name?: unknown; type?: unknown; plan?: unknown };
    companies?: Array<{ id?: unknown; name?: unknown; industry?: unknown; accountingSystem?: unknown; currency?: unknown; country?: unknown }>;
    currentCompanyId?: unknown;
  };

  const tenantId = stringValue(workspace.tenant?.id);
  const currentCompanyId = stringValue(workspace.currentCompanyId);
  if (!UUID_RE.test(tenantId)) return;

  const companies = Array.isArray(workspace.companies) ? workspace.companies : [];
  const currentCompany = companies.find((company) => stringValue(company.id) === currentCompanyId) ?? companies[0];
  const companyId = stringValue(currentCompany?.id);
  if (!currentCompany || !UUID_RE.test(companyId)) return;

  const { error } = await supabase.rpc("bootstrap_workspace", {
    p_tenant_id: tenantId,
    p_tenant_name: stringValue(workspace.tenant?.name) || "ClosePilot Workspace",
    p_tenant_type: stringValue(workspace.tenant?.type) || "accounting_practice",
    p_plan: stringValue(workspace.tenant?.plan) || "practice",
    p_company_id: companyId,
    p_company_name: stringValue(currentCompany.name) || "Company",
    p_industry: stringValue(currentCompany.industry),
    p_accounting_system: stringValue(currentCompany.accountingSystem) || "Unknown",
    p_currency: stringValue(currentCompany.currency) || "GBP",
    p_country: stringValue(currentCompany.country) || "United Kingdom",
  });

  if (error) {
    console.warn("Workspace scope bootstrap failed", error.message);
  }
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
