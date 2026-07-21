// QuickBooks Online (Intuit) connector — OAuth 2.0 + Accounting API over plain
// fetch (no SDK). Mirrors the Xero connector's role: config detection, consent
// URL, token exchange/refresh, and a small authenticated GET helper. Tokens are
// stored (encrypted) in accounting_integrations exactly like Xero.

import { redactSecrets } from "./xero";

export const QUICKBOOKS_SCOPES = ["com.intuit.quickbooks.accounting", "openid", "profile", "email"];

const AUTH_URL = "https://appcenter.intuit.com/connect/oauth2";
const TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";

export function quickbooksConfigured() {
  return Boolean(process.env.QUICKBOOKS_CLIENT_ID && process.env.QUICKBOOKS_CLIENT_SECRET && process.env.QUICKBOOKS_REDIRECT_URI && process.env.INTEGRATION_ENCRYPTION_KEY);
}

// Sandbox until QUICKBOOKS_ENVIRONMENT=production. The OAuth endpoints above are
// the same for both; only the Accounting API host differs.
export function quickbooksApiBase() {
  return (process.env.QUICKBOOKS_ENVIRONMENT || "sandbox").toLowerCase() === "production"
    ? "https://quickbooks.api.intuit.com"
    : "https://sandbox-quickbooks.api.intuit.com";
}

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

export function buildConsentUrl(state: string) {
  const params = new URLSearchParams({
    client_id: required("QUICKBOOKS_CLIENT_ID"),
    redirect_uri: required("QUICKBOOKS_REDIRECT_URI"),
    response_type: "code",
    scope: QUICKBOOKS_SCOPES.join(" "),
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

export type QuickBooksTokens = { accessToken: string; refreshToken: string; expiresAt: string; scopes: string[] };

type TokenResponse = { access_token: string; refresh_token: string; expires_in: number; token_type: string; scope?: string };

async function tokenRequest(form: URLSearchParams): Promise<QuickBooksTokens> {
  const auth = Buffer.from(`${required("QUICKBOOKS_CLIENT_ID")}:${required("QUICKBOOKS_CLIENT_SECRET")}`).toString("base64");
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: form.toString(),
  });
  if (!response.ok) throw new Error(`QuickBooks token request failed: HTTP ${response.status} — ${redactSecrets((await response.text()).slice(0, 300))}`);
  const json = (await response.json()) as TokenResponse;
  if (!json.access_token || !json.refresh_token) throw new Error("QuickBooks returned an incomplete token set.");
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: new Date(Date.now() + (Number(json.expires_in) || 3600) * 1000).toISOString(),
    scopes: typeof json.scope === "string" ? json.scope.split(" ").filter(Boolean) : QUICKBOOKS_SCOPES,
  };
}

export function exchangeCode(code: string) {
  return tokenRequest(new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: required("QUICKBOOKS_REDIRECT_URI") }));
}

export function refreshTokens(refreshToken: string) {
  return tokenRequest(new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }));
}

// Authenticated Accounting API GET → JSON. Used for reports, entity queries and
// company info during the callback.
export async function quickbooksFetch<T>(baseUrl: string, accessToken: string, path: string): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`QuickBooks API ${path.split("?")[0]} failed: HTTP ${response.status} — ${redactSecrets((await response.text()).slice(0, 300))}`);
  return (await response.json()) as T;
}

export function describeQuickBooksError(error: unknown): string {
  return redactSecrets(error instanceof Error ? error.message : "Unknown QuickBooks error");
}
