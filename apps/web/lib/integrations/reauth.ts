// Re-authorisation state for accounting connections.
//
// A connection can stop authenticating for a durable reason — the practice
// revoked ClosePilot's access at the provider, or the refresh token expired —
// which no amount of retrying fixes: the only remedy is to reconnect (re-run the
// OAuth consent). That is different from a transient sync failure (a timeout, an
// empty report), which a retry can clear. We flag the durable case on the
// connection so the UI can show "Reconnect needed" instead of silently failing
// every sync.

type SupabaseClient = Awaited<ReturnType<typeof import("@/lib/supabase-server").createClient>>;

export const REAUTH_REQUIRED = "reauth_required";

// True when the error means the OAuth grant is no longer valid (revoked consent
// or an expired/invalid refresh token, or a hard 401), across Xero / QuickBooks /
// Sage error shapes.
export function isReauthError(error: unknown): boolean {
  const e = error as {
    message?: unknown; error?: unknown; error_description?: unknown; code?: unknown;
    statusCode?: unknown; status?: unknown; response?: { statusCode?: unknown; status?: unknown };
  } | null | undefined;
  const status = [e?.statusCode, e?.status, e?.response?.statusCode, e?.response?.status].find((s) => typeof s === "number");
  if (status === 401) return true;
  const bits: string[] = [];
  for (const value of [e?.message, e?.error, e?.error_description, e?.code]) if (typeof value === "string") bits.push(value);
  if (!bits.length) bits.push(String(error ?? ""));
  const text = bits.join(" ").toLowerCase();
  return /invalid_grant|invalid[_ ]?token|token (has |is )?expired|expired[_ ]token|unauthori[sz]ed|\b401\b|revoked|consent|refresh[_ ]?token/.test(text);
}

// Mark a connection as needing reconnection. Reconnecting (re-running OAuth) sets
// the status back to "connected", as does the next successful sync.
export async function markConnectionReauthRequired(supabase: SupabaseClient, integrationId: string): Promise<void> {
  await supabase.from("accounting_integrations")
    .update({ status: REAUTH_REQUIRED, updated_at: new Date().toISOString() })
    .eq("id", integrationId);
}
