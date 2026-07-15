import { createClient } from "@/lib/supabase-server";
import { requireApiSession } from "@/lib/api-auth";
import { reportError } from "@/lib/logger";
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
    .maybeSingle();

  // Distinguish "no workspace yet" (authoritative empty → null) from a query
  // failure (500). Returning null on error made the client treat a transient
  // failure as "no workspace", wipe its local backup and force onboarding — the
  // disappearing-workspace bug. maybeSingle() returns null data without error
  // when there is no row, so only a real error reaches the 500 branch.
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ workspace: data?.data ?? null });
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
  if (!UUID_RE.test(tenantId)) return;

  const companies = Array.isArray(workspace.companies) ? workspace.companies : [];
  // Persist every real company so background uploads (which write tenant/company
  // rows and depend on the FKs) work for any of them. Skip non-UUID placeholders
  // such as the "company_pilot_brightlane" pilot-demo remnant left by loadPilotDemo.
  const realCompanies = companies.filter((company) => UUID_RE.test(stringValue(company?.id)));
  if (!realCompanies.length) return;

  for (const company of realCompanies) {
    const { error } = await supabase.rpc("bootstrap_workspace", {
      p_tenant_id: tenantId,
      p_tenant_name: stringValue(workspace.tenant?.name) || "ClosePilot Workspace",
      p_tenant_type: stringValue(workspace.tenant?.type) || "accounting_practice",
      p_plan: stringValue(workspace.tenant?.plan) || "practice",
      p_company_id: stringValue(company.id),
      p_company_name: stringValue(company.name) || "Company",
      p_industry: stringValue(company.industry),
      p_accounting_system: stringValue(company.accountingSystem) || "Unknown",
      p_currency: stringValue(company.currency) || "GBP",
      p_country: stringValue(company.country) || "United Kingdom",
    });

    // Surface instead of swallowing: a silent failure here leaves tenant/company
    // rows uncreated, which then breaks background uploads with an opaque 500.
    if (error) {
      reportError(error, { step: "bootstrap_workspace", route: "workspace", tenantId, companyId: stringValue(company.id) });
    }
  }
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
