import { decryptIntegrationSecret, encryptIntegrationSecret } from "./crypto";
import { createXeroClient, tokenExpiry, tokenScopes } from "./xero";
import type { TokenSetParameters } from "xero-node";

export type XeroIntegrationRow = {
  id: string;
  tenant_id: string;
  company_id: string;
  user_id: string;
  external_tenant_id: string;
  external_tenant_name: string | null;
  external_connection_id: string | null;
  status: string;
  selected: boolean;
  access_token_encrypted: string;
  refresh_token_encrypted: string;
  id_token_encrypted: string | null;
  token_expires_at: string | null;
  scopes: string[];
  last_synced_at: string | null;
};

type SupabaseClient = Awaited<ReturnType<typeof import("@/lib/supabase-server").createClient>>;

export async function selectedXeroConnection(supabase: SupabaseClient, tenantId: string, companyId: string) {
  const { data, error } = await supabase
    .from("accounting_integrations")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("company_id", companyId)
    .eq("provider", "xero")
    .eq("selected", true)
    .single();
  if (error || !data) throw new Error(error?.message || "Select a Xero organisation before syncing.");
  return data as XeroIntegrationRow;
}

export async function authenticatedXeroClient(supabase: SupabaseClient, connection: XeroIntegrationRow) {
  const xero = createXeroClient();
  const tokenSet: TokenSetParameters = {
    access_token: decryptIntegrationSecret(connection.access_token_encrypted),
    refresh_token: decryptIntegrationSecret(connection.refresh_token_encrypted),
    id_token: connection.id_token_encrypted ? decryptIntegrationSecret(connection.id_token_encrypted) : undefined,
    expires_at: connection.token_expires_at ? Math.floor(new Date(connection.token_expires_at).getTime() / 1000) : undefined,
    scope: connection.scopes.join(" "),
    token_type: "Bearer",
  };
  xero.setTokenSet(tokenSet);

  const expiresSoon = !tokenSet.expires_at || tokenSet.expires_at * 1000 <= Date.now() + 60_000;
  if (expiresSoon) {
    // refreshToken() needs the OpenID client set up via initialize() and fails
    // with "reading 'refresh'" otherwise; refreshWithRefreshToken uses explicit
    // credentials + the stored refresh token, which is the correct server flow.
    await xero.initialize();
    const refreshed = await xero.refreshWithRefreshToken(
      process.env.XERO_CLIENT_ID as string,
      process.env.XERO_CLIENT_SECRET as string,
      tokenSet.refresh_token as string,
    );
    if (!refreshed.access_token || !refreshed.refresh_token) throw new Error("Xero returned an incomplete refreshed token set.");
    xero.setTokenSet(refreshed);
    const { error } = await supabase.from("accounting_integrations").update({
      access_token_encrypted: encryptIntegrationSecret(refreshed.access_token),
      refresh_token_encrypted: encryptIntegrationSecret(refreshed.refresh_token),
      id_token_encrypted: refreshed.id_token ? encryptIntegrationSecret(refreshed.id_token) : connection.id_token_encrypted,
      token_expires_at: tokenExpiry(refreshed),
      scopes: tokenScopes(refreshed),
      updated_at: new Date().toISOString(),
    }).eq("id", connection.id);
    if (error) throw new Error(`Could not persist refreshed Xero tokens: ${error.message}`);
  }
  return xero;
}
