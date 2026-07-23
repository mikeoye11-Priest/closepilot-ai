// Sage Business Cloud Accounting connector — OAuth 2.0 + Accounting API (v3.1)
// over plain fetch. Mirrors the Xero/QuickBooks connectors: config detection,
// consent URL, token exchange/refresh, and an authenticated GET helper. Tokens
// are stored (encrypted) in accounting_integrations like the other providers.

import { redactSecrets } from "./xero";

export const SAGE_SCOPES = ["full_access"];

const AUTH_URL = "https://www.sageone.com/oauth2/auth/central";
const TOKEN_URL = "https://oauth.accounting.sage.com/token";
export const SAGE_API_BASE = "https://api.accounting.sage.com/v3.1";

export function sageConfigured() {
  return Boolean(process.env.SAGE_CLIENT_ID && process.env.SAGE_CLIENT_SECRET && process.env.SAGE_REDIRECT_URI && process.env.INTEGRATION_ENCRYPTION_KEY);
}

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

export function buildConsentUrl(state: string) {
  const params = new URLSearchParams({
    client_id: required("SAGE_CLIENT_ID"),
    redirect_uri: required("SAGE_REDIRECT_URI"),
    response_type: "code",
    scope: SAGE_SCOPES.join(" "),
    state,
    country: (process.env.SAGE_COUNTRY || "gb").toLowerCase(),
    filter: "apiv3.1",
  });
  return `${AUTH_URL}?${params.toString()}`;
}

export type SageTokens = { accessToken: string; refreshToken: string; expiresAt: string };

type TokenResponse = { access_token: string; refresh_token: string; expires_in: number; token_type: string };

async function tokenRequest(form: URLSearchParams): Promise<SageTokens> {
  form.set("client_id", required("SAGE_CLIENT_ID"));
  form.set("client_secret", required("SAGE_CLIENT_SECRET"));
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: form.toString(),
  });
  if (!response.ok) throw new Error(`Sage token request failed: HTTP ${response.status} — ${redactSecrets((await response.text()).slice(0, 300))}`);
  const json = (await response.json()) as TokenResponse;
  if (!json.access_token || !json.refresh_token) throw new Error("Sage returned an incomplete token set.");
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: new Date(Date.now() + (Number(json.expires_in) || 300) * 1000).toISOString(),
  };
}

export function exchangeCode(code: string) {
  return tokenRequest(new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: required("SAGE_REDIRECT_URI") }));
}

export function refreshTokens(refreshToken: string) {
  return tokenRequest(new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }));
}

// Authenticated Accounting API GET → JSON. `businessId` scopes the request when
// the user has more than one Sage business.
export async function sageFetch<T>(accessToken: string, path: string, businessId?: string): Promise<T> {
  const response = await fetch(`${SAGE_API_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      ...(businessId ? { "X-Business": businessId } : {}),
    },
  });
  if (!response.ok) throw new Error(`Sage API ${path.split("?")[0]} failed: HTTP ${response.status} — ${redactSecrets((await response.text()).slice(0, 300))}`);
  return (await response.json()) as T;
}

export function describeSageError(error: unknown): string {
  return redactSecrets(error instanceof Error ? error.message : "Unknown Sage error");
}
