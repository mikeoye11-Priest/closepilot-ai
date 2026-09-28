import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase-server";
import { requireApiSession } from "@/lib/api-auth";
import { rolesForTenant } from "@/lib/membership";
import { can, canGrantRole, isFirmRole } from "@/lib/permissions";
import { reportError } from "@/lib/logger";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;


type Admin = ReturnType<typeof adminClient>;

/**
 * Removes the account an invitation created, when withdrawing that invitation
 * leaves it with no purpose.
 *
 * Deliberately conservative. It only deletes an account that has never been
 * signed into and holds no grants anywhere - which is exactly the state
 * inviteUserByEmail leaves behind and nothing else. Someone who already had an
 * account, or who accepted and was later removed, is never touched: deleting
 * either would destroy a real person's access to other firms.
 */
async function deleteAccountCreatedByInvitation(admin: NonNullable<Admin>, email: string) {
  if (!email.trim()) return;

  const { data: userId } = await admin.rpc("lookup_user_id_by_email", { p_email: email.trim() });
  if (typeof userId !== "string" || !userId) return;

  const { data: account } = await admin.auth.admin.getUserById(userId);
  if (!account?.user || account.user.last_sign_in_at) return; // used: leave it alone

  const [{ count: scopeCount }, { count: companyCount }] = await Promise.all([
    admin.from("user_scope_access").select("user_id", { count: "exact", head: true }).eq("user_id", userId),
    admin.from("user_company_access").select("user_id", { count: "exact", head: true }).eq("user_id", userId)
  ]);
  if ((scopeCount ?? 0) > 0 || (companyCount ?? 0) > 0) return;

  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) reportError(error, { step: "delete_invited_account", email });
}

/**
 * Marks a removed member inactive once they hold no grants in any firm, and
 * clears a home tenant that no longer means anything.
 */
async function deactivateIfNoLongerAMember(admin: NonNullable<Admin>, userId: string, tenantId: string) {
  const [{ count: scopeCount }, { count: companyCount }] = await Promise.all([
    admin.from("user_scope_access").select("user_id", { count: "exact", head: true }).eq("user_id", userId),
    admin.from("user_company_access").select("user_id", { count: "exact", head: true }).eq("user_id", userId)
  ]);

  if ((scopeCount ?? 0) > 0 || (companyCount ?? 0) > 0) {
    // Still in another firm: only clear the home tenant if it pointed here.
    await admin.from("users").update({ tenant_id: null }).eq("id", userId).eq("tenant_id", tenantId);
    return;
  }

  const { error } = await admin
    .from("users")
    .update({ status: "inactive", tenant_id: null })
    .eq("id", userId);

  if (error) reportError(error, { step: "deactivate_removed_member", userId, tenantId });
}

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createSupabaseClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/**
 * Removing a member, revoking an invitation, changing a role.
 *
 * Removal revokes access; it never deletes the person. Findings, comments,
 * activities and sign-offs all reference users.id, so deleting the row would
 * take the audit trail with it — and an audit trail that disappears when
 * somebody leaves the firm is worse than useless to an accountant. Their
 * grants for this tenant go; the user row, and their history, stay. Because
 * membership is many-to-many, this also means removing someone from one firm
 * leaves their access to any other firm untouched.
 */
export async function POST(request: Request) {
  const session = await requireApiSession();
  if (!session.ok) return session.response;
  if (session.authDisabled) return NextResponse.json({ error: "Member management needs authentication enabled." }, { status: 400 });
  if (!session.userId) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const { action, tenantId, userId, invitationId, role, invitationEmail } = body as Record<string, unknown>;
  if (typeof tenantId !== "string" || !UUID_RE.test(tenantId)) {
    return NextResponse.json({ error: "A valid tenantId is required" }, { status: 400 });
  }

  const supabase = await createClient();
  const actorRoles = await rolesForTenant(supabase, session.userId, tenantId);
  if (!can(actorRoles, "manage_members")) {
    return NextResponse.json({ error: "You do not have permission to manage members." }, { status: 403 });
  }

  const admin = adminClient();
  if (!admin) return NextResponse.json({ error: "Member management is not configured on this deployment." }, { status: 503 });

  if (action === "revoke_invitation") {
    if (typeof invitationId !== "string" || !UUID_RE.test(invitationId)) {
      return NextResponse.json({ error: "A valid invitationId is required" }, { status: 400 });
    }
    // Scoped to this tenant so an id from another firm cannot be revoked, and
    // only while pending — revoking an accepted one would say nothing true.
    const { error } = await admin
      .from("firm_invitations")
      .update({ status: "revoked" })
      .eq("id", invitationId)
      .eq("tenant_id", tenantId)
      .eq("status", "pending");

    if (error) {
      reportError(error, { step: "revoke_invitation", tenantId, invitationId });
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // inviteUserByEmail creates the auth account immediately, before anyone
    // accepts. Revoking only marked the invitation dead and left that account
    // behind: confirmed, able to sign in, and - holding no grants - landing on
    // onboarding, where it could create a firm of its own. An invitation a
    // partner has withdrawn must not leave a usable account behind.
    await deleteAccountCreatedByInvitation(admin, typeof invitationEmail === "string" ? invitationEmail : "");

    return NextResponse.json({ success: true });
  }

  if (typeof userId !== "string" || !UUID_RE.test(userId)) {
    return NextResponse.json({ error: "A valid userId is required" }, { status: 400 });
  }

  // A firm that removes or demotes its last partner locks itself out of member
  // management entirely, with no way back through the UI. Checked for both
  // actions before either is applied.
  const targetRoles = await rolesForTenant(supabase, userId, tenantId);
  if (targetRoles.includes("practice_admin")) {
    const { count } = await admin
      .from("user_scope_access")
      .select("user_id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("role", "practice_admin");

    if ((count ?? 0) <= 1) {
      return NextResponse.json(
        { error: "This is the firm's only partner. Give someone else the partner role first." },
        { status: 409 }
      );
    }
  }

  if (action === "remove_member") {
    // Both grant tables, so a per-company grant cannot leave a removed member
    // with a way back in. The users row is deliberately left alone.
    const [scope, perCompany] = await Promise.all([
      admin.from("user_scope_access").delete().eq("tenant_id", tenantId).eq("user_id", userId),
      admin.from("user_company_access").delete().eq("tenant_id", tenantId).eq("user_id", userId)
    ]);

    const failure = scope.error ?? perCompany.error;
    if (failure) {
      reportError(failure, { step: "remove_member", tenantId, userId });
      return NextResponse.json({ error: failure.message }, { status: 500 });
    }

    // Dropping the grants is not enough on its own. The account stayed
    // 'active' and could still sign in - with no membership it lands on
    // onboarding, where a person just removed from a firm can create one of
    // their own. has_company_access and has_tenant_access both require an
    // active user, so this is the switch that actually closes the door.
    //
    // Only when they belong to no firm at all: membership is many-to-many, and
    // being removed from one must not lock them out of another.
    await deactivateIfNoLongerAMember(admin, userId, tenantId);

    return NextResponse.json({ success: true });
  }

  if (action === "set_role") {
    if (!isFirmRole(role)) return NextResponse.json({ error: "Unknown role" }, { status: 400 });
    if (!canGrantRole(actorRoles, role)) {
      return NextResponse.json({ error: "You cannot grant a role above your own." }, { status: 403 });
    }

    const { error } = await admin
      .from("user_scope_access")
      .update({ role })
      .eq("tenant_id", tenantId)
      .eq("user_id", userId);

    if (error) {
      reportError(error, { step: "set_member_role", tenantId, userId });
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
