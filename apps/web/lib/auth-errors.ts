/**
 * Fixed sign-in error codes.
 *
 * `/auth/callback` forwards one of these codes rather than the provider's own
 * `error_description`, because whatever lands in the query string is rendered
 * on the sign-in page. Forwarding free text lets a crafted link put arbitrary
 * words ("your account is suspended, call 0800...") in front of a user on a
 * page they trust. The provider's real message is logged server-side instead.
 */
export type AuthErrorCode = "link_expired" | "link_invalid" | "link_missing";

const MESSAGES: Record<AuthErrorCode, string> = {
  link_expired: "That link has expired or has already been used. Request a new one.",
  link_invalid: "That link could not be verified. Request a new one.",
  link_missing: "That link was incomplete. Request a new one."
};

const FALLBACK = "Something went wrong with that link. Request a new one.";

/** Resolves a `?error=` code to its message. Unknown codes fall back, never echo. */
export function authErrorMessage(code: string | null | undefined): string | null {
  if (!code) return null;
  return MESSAGES[code as AuthErrorCode] ?? FALLBACK;
}
