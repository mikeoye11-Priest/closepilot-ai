import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { reportError, logger } from "@/lib/logger";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Requests a password reset, server-side.
 *
 * This used to be called straight from the browser, which meant a send failure
 * was only ever seen by the person it happened to. When Supabase's SMTP config
 * broke, every reset silently failed for over an hour while the app kept
 * saying "we've sent you an email" — nothing reached Sentry, and nothing
 * reached us. Once invitations go to an accountant rather than to ourselves,
 * that failure mode lands on them and we would not know.
 *
 * Doing it here means a failure is reported where error tracking already runs.
 * The caller still gets the same neutral answer either way, so nothing about
 * whether the address exists, or whether mail is currently working, leaks to
 * an unauthenticated visitor.
 */
export async function POST(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  }

  const body = await request.json().catch(() => null);
  const email = body && typeof body === "object" ? (body as { email?: unknown }).email : undefined;

  if (typeof email !== "string" || !EMAIL_RE.test(email.trim())) {
    return NextResponse.json({ error: "Enter the email address you sign in with." }, { status: 400 });
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? new URL(request.url).origin;

  // Anon client: a reset request is an unauthenticated action and must not be
  // made with elevated rights. No query string on redirectTo — the recovery
  // email template appends its own parameters.
  const supabase = createSupabaseClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
    redirectTo: `${siteUrl}/auth/confirm`
  });

  if (error) {
    // Rate limiting is the user's situation, not a fault: expected, and noisy
    // if it pages someone. Everything else means mail is broken for everybody
    // and someone needs to know now.
    if (/rate limit/i.test(error.message ?? "")) {
      logger.warn("password reset rate limited", { message: error.message });
      return NextResponse.json(
        { error: "Too many reset emails have been requested recently. Wait a few minutes and try again." },
        { status: 429 }
      );
    }

    reportError(error, { step: "password_reset_email", message: error.message });
    return NextResponse.json(
      { error: "We could not send the email. This is a problem on our side, not with your address." },
      { status: 502 }
    );
  }

  // Identical whether or not the address has an account.
  return NextResponse.json({ sent: true });
}
