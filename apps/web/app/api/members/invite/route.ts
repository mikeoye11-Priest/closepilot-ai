import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase-server";
import { requireApiSession } from "@/lib/api-auth";
import { rolesForTenant } from "@/lib/membership";
import { canGrantRole, isFirmRole } from "@/lib/permissions";
import { reportError } from "@/lib/logger";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// Deliberately permissive: the invite is only usable by whoever can read the
// mail sent to it, so the address is proven by delivery rather than by regex.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Issues an invitation and asks Supabase to email it.
 *
 * Writes go through the service-role client because both sides of this act on
 * rows the caller cannot yet touch: the invitee is not a member of anything
 * until they accept, so there is no RLS policy that could let them in. Every
 * check that RLS would normally perform is therefore done explicitly here.
 */
function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createSupabaseClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function POST(request: Request) {
  const session = await requireApiSession();
  if (!session.ok) return session.response;
  if (session.authDisabled) return NextResponse.json({ error: "Invitations need authentication enabled." }, { status: 400 });
  if (!session.userId) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const { tenantId, email, role, orgUnitId } = body as Record<string, unknown>;

  if (typeof tenantId !== "string" || !UUID_RE.test(tenantId)) {
    return NextResponse.json({ error: "A valid tenantId is required" }, { status: 400 });
  }
  if (typeof email !== "string" || !EMAIL_RE.test(email.trim())) {
    return NextResponse.json({ error: "A valid email address is required" }, { status: 400 });
  }
  if (!isFirmRole(role)) {
    return NextResponse.json({ error: "Unknown role" }, { status: 400 });
  }
  if (orgUnitId !== undefined && orgUnitId !== null && (typeof orgUnitId !== "string" || !UUID_RE.test(orgUnitId))) {
    return NextResponse.json({ error: "Invalid orgUnitId" }, { status: 400 });
  }

  // Authorisation is against the caller's own grants, read with their session
  // rather than the service role, so RLS still applies to the lookup itself.
  const supabase = await createClient();
  const actorRoles = await rolesForTenant(supabase, session.userId, tenantId);

  // canGrantRole covers both halves: may this person invite at all, and may
  // they hand out a role at least as high as the one requested.
  if (!canGrantRole(actorRoles, role)) {
    return NextResponse.json({ error: "You do not have permission to invite this role." }, { status: 403 });
  }

  const admin = adminClient();
  if (!admin) {
    return NextResponse.json({ error: "Invitations are not configured on this deployment." }, { status: 503 });
  }

  const normalisedEmail = email.trim().toLowerCase();

  // Record the invitation first. If the email then fails to send it can be
  // resent from the People page; if the order were reversed, a delivered
  // invitation could have no row to accept against.
  // Somebody who already has a ClosePilot account cannot be "invited" —
  // inviteUserByEmail refuses the address. That is not an error case: with
  // many-to-many membership, an accountant who uses ClosePilot at one firm and
  // is added to a second has an account already. Grant them access directly
  // rather than recording an invitation that can never be delivered or
  // accepted, which is what happened before and left the invitee with nothing.
  const { data: existingUserId } = await admin.rpc("lookup_user_id_by_email", { p_email: normalisedEmail });

  if (typeof existingUserId === "string" && existingUserId) {
    const { error: grantError } = await admin
      .from("user_scope_access")
      .upsert(
        {
          user_id: existingUserId,
          tenant_id: tenantId,
          org_unit_id: typeof orgUnitId === "string" ? orgUnitId : null,
          role
        },
        // Re-adding someone who is already a member updates their role rather
        // than failing on the partial unique index.
        { onConflict: typeof orgUnitId === "string" ? "user_id,org_unit_id" : "user_id,tenant_id" }
      );

    if (grantError) {
      reportError(grantError, { step: "grant_existing_user", tenantId, role });
      return NextResponse.json({ error: grantError.message }, { status: 500 });
    }

    // A public.users row is what the People page joins against for names, and
    // what both access checks read `status` from. Granting scope access alone
    // left neither: the member rendered as a bare UUID, and a previously
    // removed person stayed inactive, holding a grant that granted nothing.
    //
    // Upsert on id rather than update, because a directly granted user may
    // never have had a row - only invitation acceptance created one.
    const { error: profileError } = await admin
      .from("users")
      .upsert(
        { id: existingUserId, email: normalisedEmail, role, status: "active" },
        { onConflict: "id" }
      );

    if (profileError) reportError(profileError, { step: "upsert_member_profile", tenantId });

    return NextResponse.json({ added: true, existingAccount: true });
  }

  const { data: invitation, error: insertError } = await admin
    .from("firm_invitations")
    .insert({
      tenant_id: tenantId,
      email: normalisedEmail,
      role,
      org_unit_id: typeof orgUnitId === "string" ? orgUnitId : null,
      invited_by: session.userId
    })
    .select("id, email, role, org_unit_id, status, expires_at, created_at")
    .single();

  if (insertError) {
    // The partial unique index means a live invitation already exists.
    if (insertError.code === "23505") {
      return NextResponse.json({ error: "That address already has a pending invitation." }, { status: 409 });
    }
    reportError(insertError, { step: "create_invitation", tenantId });
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3004";
  const { error: inviteError } = await admin.auth.admin.inviteUserByEmail(normalisedEmail, {
    // /auth/confirm, not /auth/callback. The invite email uses Supabase's stock
    // {{ .ConfirmationURL }}, which returns the session in the URL fragment —
    // and /auth/callback only understands a PKCE code, so it saw a bare path
    // and bounced every invitation to /login?error=link_missing. /auth/confirm
    // verifies a token hash and falls back to reading the fragment, which is
    // the same fix already made for password reset.
    redirectTo: `${siteUrl}/auth/confirm?next=${encodeURIComponent(`/join?invitation=${invitation.id}`)}`
  });

  if (inviteError) {
    // Already having an account is not a failure: they can accept from the
    // People page link or by signing in, so the invitation row stands.
    reportError(inviteError, { step: "send_invitation_email", tenantId, invitationId: invitation.id });
    return NextResponse.json({ invitation, emailed: false, warning: inviteError.message });
  }

  return NextResponse.json({ invitation, emailed: true });
}
