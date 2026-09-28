import { createClient } from "@/lib/supabase-server";
import { requireApiSession } from "@/lib/api-auth";
import { reportError } from "@/lib/logger";
import { NextResponse } from "next/server";
import { rolesForTenant } from "@/lib/membership";

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

  const stored = data?.data ?? null;
  if (!stored) {
    // No personal workspace row, but the user may already be a member of a
    // firm through user_company_access. Without this they were sent to
    // onboarding and would create a second, parallel tenant alongside the one
    // they belong to. Build their shell from the shared tables instead.
    const shared = await buildSharedShell(supabase, user.id);
    if (!shared) return NextResponse.json({ workspace: null });
    return NextResponse.json({
      workspace: {
        ...shared,
        orgUnits: await readOrgUnits(supabase, shared),
        // The client gates controls on these. They are advisory only: every
        // privileged write is checked again server-side.
        callerRoles: await callerRolesFor(supabase, user.id, shared)
      }
    });
  }

  // Existing rows still carry every company's snapshot inline. Move them to
  // company_snapshots on first read and slim the row, so nobody has to be
  // migrated by hand and no snapshot is lost in the changeover.
  const migrated = await drainInlineSnapshots(supabase, stored);
  if (migrated) {
    await supabase
      .from("user_workspaces")
      .upsert({ user_id: user.id, data: migrated, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
  }

  const shell = (migrated ?? stored) as Record<string, unknown>;
  return NextResponse.json({
    workspace: {
      ...shell,
      orgUnits: await readOrgUnits(supabase, shell),
      callerRoles: await callerRolesFor(supabase, user.id, shell)
    }
  });
}

/** The roles the signed-in user holds over this workspace's tenant. */
async function callerRolesFor(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  shell: Record<string, unknown>
) {
  const tenantId = stringValue((shell.tenant as { id?: unknown } | undefined)?.id);
  if (!UUID_RE.test(tenantId)) return [];
  return rolesForTenant(supabase, userId, tenantId);
}

/**
 * The tenant's org units, read from the shared table rather than the per-user
 * blob so every member of a firm sees the same structure.
 *
 * Returns [] rather than failing when the table is not there yet: 0004 may not
 * have been applied, and a practice with no branches is the normal case for a
 * single entity. Neither should stop the workspace loading.
 */
async function readOrgUnits(
  supabase: Awaited<ReturnType<typeof createClient>>,
  shell: Record<string, unknown>
): Promise<Array<{ id: string; tenantId: string; name: string; kind: string }>> {
  const tenantId = stringValue((shell.tenant as { id?: unknown } | undefined)?.id);
  if (!UUID_RE.test(tenantId)) return [];

  const { data, error } = await supabase
    .from("org_units")
    .select("id, tenant_id, name, kind")
    .eq("tenant_id", tenantId)
    .order("name");

  if (error || !data) return [];
  return data.map((row) => ({
    id: String(row.id),
    tenantId: String(row.tenant_id),
    name: String(row.name),
    kind: String(row.kind)
  }));
}

/**
 * Builds a workspace shell for a user who has no row of their own, from the
 * companies they have been granted access to.
 *
 * The workspace row is per user, so a second member of a firm previously
 * loaded nothing and was pushed into onboarding — creating a parallel tenant
 * rather than joining the one they already had access to. Reading the shared
 * tables makes membership work: whoever holds an access row sees the firm.
 *
 * Returns null when there is genuinely no access, which is a real first-time
 * user and correctly lands on onboarding.
 */
async function buildSharedShell(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string
): Promise<Record<string, unknown> | null> {
  const { data: access, error: accessError } = await supabase
    .from("user_company_access")
    .select("tenant_id, company_id")
    .eq("user_id", userId);

  if (accessError || !access?.length) return null;

  // Membership is many-to-many, so holding grants in several firms is normal,
  // not a corner case — this account already holds six. Taking access[0] from
  // an unordered query meant whichever row Postgres happened to return first,
  // so the same person could land in a different firm on consecutive loads.
  //
  // Pick the firm they have the most access to, breaking ties on tenant id so
  // the choice is at least stable. This is a default, not a answer: switching
  // firms needs a picker, which is a separate piece of work.
  const byTenant = new Map<string, number>();
  for (const row of access) {
    const id = stringValue(row.tenant_id);
    if (UUID_RE.test(id)) byTenant.set(id, (byTenant.get(id) ?? 0) + 1);
  }
  if (!byTenant.size) return null;

  const tenantId = [...byTenant.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];

  const companyIds = access
    .filter((row) => stringValue(row.tenant_id) === tenantId)
    .map((row) => stringValue(row.company_id))
    .filter((id) => UUID_RE.test(id));
  if (!companyIds.length) return null;

  const [{ data: tenantRow }, { data: companyRows }] = await Promise.all([
    supabase.from("tenants").select("*").eq("id", tenantId).maybeSingle(),
    supabase.from("companies").select("*").in("id", companyIds).order("name")
  ]);

  if (!tenantRow || !companyRows?.length) return null;

  const companies = companyRows.map((row) => ({
    id: String(row.id),
    tenantId: String(row.tenant_id),
    name: String(row.name ?? "Company"),
    industry: String(row.industry ?? ""),
    accountingSystem: String(row.accounting_system ?? "Unknown"),
    currency: String(row.currency ?? "GBP"),
    country: String(row.country ?? "United Kingdom"),
    // Absent until 0004 is applied; null simply means "no branch".
    orgUnitId: row.org_unit_id ? String(row.org_unit_id) : null
  }));

  return {
    tenant: {
      id: String(tenantRow.id),
      name: String(tenantRow.name ?? "ClosePilot Workspace"),
      type: String(tenantRow.tenant_type ?? "accounting_practice"),
      plan: String(tenantRow.plan ?? "practice")
    },
    companies,
    currentCompanyId: companies[0].id,
    // Derived client-side from each snapshot as it loads; a shell built from
    // the shared tables has no reviews in it yet.
    portfolioClients: [],
    reportSchedules: [],
    scheduledReports: []
  };
}

/**
 * Lifts any inline companySnapshots into company_snapshots and returns the
 * slimmed workspace, or null when there was nothing to move.
 *
 * Snapshots are written before the blob is slimmed, and a failed write aborts
 * the whole drain: losing a client's review to make a payload smaller would be
 * a far worse bug than the one this is fixing.
 */
async function drainInlineSnapshots(
  supabase: Awaited<ReturnType<typeof createClient>>,
  stored: unknown
): Promise<Record<string, unknown> | null> {
  if (!stored || typeof stored !== "object") return null;

  const workspace = stored as Record<string, unknown>;
  const snapshots = workspace.companySnapshots;
  if (!snapshots || typeof snapshots !== "object") return null;

  const entries = Object.entries(snapshots as Record<string, unknown>)
    .filter(([companyId, snapshot]) => UUID_RE.test(companyId) && snapshot && typeof snapshot === "object");
  if (!entries.length) {
    // Nothing worth keeping (an empty map, or pilot-demo placeholders that are
    // not real companies). Drop the key so it stops travelling.
    if (!Object.keys(snapshots as Record<string, unknown>).length) return null;
    const { companySnapshots: _dropped, ...rest } = workspace;
    return rest;
  }

  const tenantId = stringValue((workspace.tenant as { id?: unknown } | undefined)?.id);
  if (!UUID_RE.test(tenantId)) return null;

  const rows = entries.map(([companyId, snapshot]) => ({
    tenant_id: tenantId,
    company_id: companyId,
    data: snapshot,
    updated_at: new Date().toISOString()
  }));

  const { error } = await supabase.from("company_snapshots").upsert(rows, { onConflict: "company_id" });
  if (error) {
    reportError(error, { step: "drain_inline_snapshots", route: "workspace", tenantId });
    return null; // keep the blob intact; try again on the next read
  }

  const { companySnapshots: _moved, ...rest } = workspace;
  return rest;
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

  // A client still sending snapshots inline - an old tab left open across the
  // deploy - must not put them back into the row. Move them across first and
  // store only the shell. Falls back to the body untouched if the move fails,
  // so a snapshot is never dropped on the floor.
  const slimmed = await drainInlineSnapshots(supabase, body);

  const { error } = await supabase
    .from("user_workspaces")
    .upsert({ user_id: user.id, data: slimmed ?? body, updated_at: new Date().toISOString() }, { onConflict: "user_id" });

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
