import { decryptIntegrationSecret, encryptIntegrationSecret } from "./crypto";
import { quickbooksApiBase, refreshTokens } from "./quickbooks";

export type QuickBooksIntegrationRow = {
  id: string;
  tenant_id: string;
  company_id: string;
  user_id: string;
  external_tenant_id: string; // Intuit realmId
  external_tenant_name: string | null;
  status: string;
  selected: boolean;
  access_token_encrypted: string;
  refresh_token_encrypted: string;
  token_expires_at: string | null;
  scopes: string[];
  last_synced_at: string | null;
};

type SupabaseClient = Awaited<ReturnType<typeof import("@/lib/supabase-server").createClient>>;

export async function selectedQuickBooksConnection(supabase: SupabaseClient, tenantId: string, companyId: string) {
  const { data, error } = await supabase
    .from("accounting_integrations")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("company_id", companyId)
    .eq("provider", "quickbooks")
    .eq("selected", true)
    .single();
  if (error || !data) throw new Error(error?.message || "Connect QuickBooks before syncing.");
  return data as QuickBooksIntegrationRow;
}

// Returns a ready-to-use access token + realm + API host, refreshing (and
// persisting the rolled refresh token) when the access token is near expiry.
// Intuit access tokens last ~1 hour; refresh tokens roll on each refresh.
export async function authenticatedQuickBooks(supabase: SupabaseClient, connection: QuickBooksIntegrationRow) {
  let accessToken = decryptIntegrationSecret(connection.access_token_encrypted);
  const expiresSoon = !connection.token_expires_at || new Date(connection.token_expires_at).getTime() <= Date.now() + 60_000;
  if (expiresSoon) {
    const refreshed = await refreshTokens(decryptIntegrationSecret(connection.refresh_token_encrypted));
    accessToken = refreshed.accessToken;
    const { error } = await supabase.from("accounting_integrations").update({
      access_token_encrypted: encryptIntegrationSecret(refreshed.accessToken),
      refresh_token_encrypted: encryptIntegrationSecret(refreshed.refreshToken),
      token_expires_at: refreshed.expiresAt,
      scopes: refreshed.scopes,
      updated_at: new Date().toISOString(),
    }).eq("id", connection.id);
    if (error) throw new Error(`Could not persist refreshed QuickBooks tokens: ${error.message}`);
  }
  return { accessToken, realmId: connection.external_tenant_id, baseUrl: quickbooksApiBase() };
}
