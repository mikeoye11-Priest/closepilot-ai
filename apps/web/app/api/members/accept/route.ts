import { createClient } from "@/lib/supabase-server";
import { requireApiSession } from "@/lib/api-auth";
import { reportError } from "@/lib/logger";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Accepts an invitation for the signed-in user.
 *
 * The work is done by accept_firm_invitation, a security-definer function, not
 * here: creating the user row, the scope grant and marking the invitation
 * accepted must be one transaction. Split across three statements from the
 * API, a failure between them leaves someone either locked out or silently
 * privileged, and two clicks on the emailed link could produce two grants.
 *
 * The caller does not say who they are. The function reads the email from
 * auth.users for auth.uid() and matches that against the invitation, so an
 * invitation can only be redeemed by someone who has proved control of the
 * address it was sent to.
 */
export async function POST(request: Request) {
  const session = await requireApiSession();
  if (!session.ok) return session.response;
  if (session.authDisabled) return NextResponse.json({ error: "Invitations need authentication enabled." }, { status: 400 });
  if (!session.userId) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const invitationId = body && typeof body === "object" ? (body as { invitationId?: unknown }).invitationId : undefined;

  if (typeof invitationId !== "string" || !UUID_RE.test(invitationId)) {
    return NextResponse.json({ error: "A valid invitationId is required" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("accept_firm_invitation", { p_invitation_id: invitationId });

  if (error) {
    // The function raises for expired, revoked, already-accepted and
    // wrong-address. These are all the user's situation rather than a fault,
    // so they come back as 400 with the reason rather than a 500.
    const message = error.message ?? "That invitation could not be accepted.";
    const isUserError = /expired|no longer pending|different address|not found/i.test(message);
    if (!isUserError) reportError(error, { step: "accept_invitation", invitationId });
    return NextResponse.json({ error: message }, { status: isUserError ? 400 : 500 });
  }

  return NextResponse.json({ tenantId: data });
}
