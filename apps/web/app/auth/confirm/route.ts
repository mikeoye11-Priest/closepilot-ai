import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase-server";
import { logger } from "@/lib/logger";
import type { AuthErrorCode } from "@/lib/auth-errors";

/**
 * Verifies an emailed link by its token hash.
 *
 * This exists because /auth/callback uses the PKCE flow, which stores a code
 * verifier in the requesting browser's cookies. That ties the link to one
 * browser on one device — so an accountant who requests a reset at their desk
 * and opens the email on their phone gets "link expired", which is both wrong
 * and unfixable by them. Opening email on a different device from the one that
 * asked is the common case, not the edge case.
 *
 * verifyOtp needs no verifier: the token hash in the link is sufficient on its
 * own, so the link works from any browser or device.
 *
 * /auth/callback is kept for OAuth-style flows that genuinely are PKCE.
 */
const ALLOWED_TYPES: readonly EmailOtpType[] = ["recovery", "invite", "email", "magiclink", "signup", "email_change"];

function isEmailOtpType(value: string | null): value is EmailOtpType {
  return value !== null && (ALLOWED_TYPES as readonly string[]).includes(value);
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");

  // Same rule as /auth/callback: relative paths only, so a crafted link
  // cannot turn a verified session into an open redirect.
  const requestedNext = searchParams.get("next") ?? "/";
  const next = requestedNext.startsWith("/") && !requestedNext.startsWith("//") ? requestedNext : "/";

  // Only ever a fixed code — never provider text, which the sign-in page
  // would render verbatim. Detail goes to the logs.
  const bounce = (reason: AuthErrorCode, detail?: string) => {
    logger.warn("auth confirm rejected link", { reason, detail });
    return NextResponse.redirect(new URL(`/login?error=${reason}`, origin));
  };

  const linkError = searchParams.get("error_description") ?? searchParams.get("error");
  if (linkError) return bounce("link_invalid", linkError);

  const supabase = await createClient();

  if (tokenHash && isEmailOtpType(type)) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (error) return bounce("link_expired", error.message);
    return NextResponse.redirect(new URL(next, origin));
  }

  // Fallback for the stock email template, which sends {{ .ConfirmationURL }}
  // and therefore arrives with a PKCE code rather than a token hash. Without
  // this, pointing redirectTo at /auth/confirm before the template is updated
  // would break recovery entirely. Same-device only, as PKCE always is — the
  // token-hash branch above is what makes it work across devices.
  const code = searchParams.get("code");
  if (!code) {
    // Nothing in the query at all. The stock {{ .ConfirmationURL }} template
    // returns an implicit-flow session in the URL *fragment*
    // (#access_token=...), and fragments are never sent to the server — so
    // this route genuinely receives a bare path and cannot tell a verified
    // link from an empty one.
    //
    // Hand it to a client page that can read the fragment, rather than
    // bouncing. That also fixes the original symptom of this whole saga: the
    // fragment was being picked up elsewhere and silently signing the user in
    // without ever asking for a new password.
    return NextResponse.redirect(new URL(`/auth/confirm/recover?next=${encodeURIComponent(next)}`, origin));
  }
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) return bounce("link_expired", error.message);
    return NextResponse.redirect(new URL(next, origin));
  }

  return bounce("link_missing");
}
