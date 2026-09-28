import { createClient } from "@/lib/supabase-server";
import { requireApiSession } from "@/lib/api-auth";
import { rolesForTenant } from "@/lib/membership";
import { can, isFirmRole } from "@/lib/permissions";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Who is in a firm, and who has been invited.
 *
 * Readable by any member, not just a partner: knowing who else is on the
 * engagement is ordinary context, and it is what lets a preparer see who to
 * send a finding to. Only the actions are restricted, which is why the
 * response reports the caller's own capability rather than the UI assuming it.
 */
export async function GET(request: Request) {
  const session = await requireApiSession();
  if (!session.ok) return session.response;
  if (session.authDisabled) return NextResponse.json({ members: [], invitations: [], canManage: true });
  if (!session.userId) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  const tenantId = new URL(request.url).searchParams.get("tenantId") ?? "";
  if (!UUID_RE.test(tenantId)) return NextResponse.json({ error: "A valid tenantId is required" }, { status: 400 });

  const supabase = await createClient();
  const callerRoles = await rolesForTenant(supabase, session.userId, tenantId);
  if (!callerRoles.length) return NextResponse.json({ error: "Not a member of this firm" }, { status: 403 });

  const [{ data: grants }, { data: companyGrants }, { data: invitations }] = await Promise.all([
    supabase
      .from("user_scope_access")
      .select("id, user_id, org_unit_id, role, users(email, status)")
      .eq("tenant_id", tenantId),
    // Per-company grants count as membership too. Listing only scope grants
    // meant the page said "no members yet" to a partner who plainly is one -
    // every existing firm was onboarded through user_company_access, so the
    // person reading the page was always missing from it.
    supabase
      .from("user_company_access")
      .select("user_id, role, users(email, status)")
      .eq("tenant_id", tenantId),
    supabase
      .from("firm_invitations")
      .select("id, email, role, org_unit_id, status, expires_at, created_at")
      .eq("tenant_id", tenantId)
      .eq("status", "pending")
      .order("created_at", { ascending: false })
  ]);

  // One row per grant, but a person holding a tenant-wide grant and a branch
  // grant is one member with two scopes, so they are folded together here
  // rather than listed twice.
  const members = new Map<string, { userId: string; email: string; status: string; roles: string[]; orgUnitIds: (string | null)[] }>();
  for (const grant of grants ?? []) {
    const userId = String(grant.user_id);
    const user = grant.users as { email?: unknown; status?: unknown } | null;
    const entry = members.get(userId) ?? {
      userId,
      email: String(user?.email ?? ""),
      status: String(user?.status ?? "active"),
      roles: [],
      orgUnitIds: []
    };
    if (isFirmRole(grant.role)) entry.roles.push(grant.role);
    entry.orgUnitIds.push(grant.org_unit_id ? String(grant.org_unit_id) : null);
    members.set(userId, entry);
  }

  // A per-company grant covers one company rather than a branch, so it folds
  // into the same person without adding an org unit. Someone holding both
  // kinds appears once, with both roles.
  for (const grant of companyGrants ?? []) {
    const userId = String(grant.user_id);
    const user = grant.users as { email?: unknown; status?: unknown } | null;
    const entry = members.get(userId) ?? {
      userId,
      email: String(user?.email ?? ""),
      status: String(user?.status ?? "active"),
      roles: [],
      orgUnitIds: []
    };
    if (isFirmRole(grant.role) && !entry.roles.includes(grant.role)) entry.roles.push(grant.role);
    members.set(userId, entry);
  }

  return NextResponse.json({
    members: [...members.values()],
    invitations: (invitations ?? []).map((row) => ({
      id: String(row.id),
      email: String(row.email),
      role: String(row.role),
      orgUnitId: row.org_unit_id ? String(row.org_unit_id) : null,
      status: String(row.status),
      expiresAt: String(row.expires_at),
      createdAt: String(row.created_at)
    })),
    canManage: can(callerRoles, "manage_members"),
    callerRoles
  });
}
