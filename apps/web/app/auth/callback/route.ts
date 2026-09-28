import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { logger } from "@/lib/logger";
import type { AuthErrorCode } from "@/lib/auth-errors";

/**
 * Consumes the one-time code on a Supabase recovery / confirmation link and
 * exchanges it for a session, then forwards to `next`. Without this the emailed
 * link lands on a page with nothing to read the token and the reset dead-ends.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");

  // Only same-origin relative paths, so a crafted link can't turn this into an
  // open redirect. "//host" is protocol-relative and would leave the site.
  const requestedNext = searchParams.get("next") ?? "/";
  const next = requestedNext.startsWith("/") && !requestedNext.startsWith("//") ? requestedNext : "/";

  // Only ever a fixed code — never provider or caller text, which would be
  // rendered verbatim on the sign-in page. Detail goes to the logs instead.
  const bounce = (reason: AuthErrorCode, detail?: string) => {
    logger.warn("auth callback rejected link", { reason, detail });
    return NextResponse.redirect(new URL(`/login?error=${reason}`, origin));
  };

  const linkError = searchParams.get("error_description") ?? searchParams.get("error");
  if (linkError) return bounce("link_invalid", linkError);

  if (!code) return bounce("link_missing");

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) return bounce("link_expired", error.message);

  return NextResponse.redirect(new URL(next, origin));
}
