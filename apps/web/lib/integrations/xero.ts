import { XeroClient, type TokenSet, type TokenSetParameters } from "xero-node";

// Granular scopes (required for apps created on/after 2 March 2026, when Xero
// deprecated the broad accounting.transactions and accounting.reports.read
// scopes). These map exactly to the endpoints the sync calls: trial balance
// report, invoices, bank transactions, and manual journals (see xero-sync.ts).
export const XERO_SCOPES = [
  "openid",
  "profile",
  "email",
  "offline_access",
  "accounting.reports.trialbalance.read",
  "accounting.reports.profitandloss.read",
  "accounting.reports.balancesheet.read",
  "accounting.invoices.read",
  "accounting.banktransactions.read",
  "accounting.manualjournals.read",
  "accounting.contacts.read",
  "accounting.settings.read",
];

export function xeroConfigured() {
  return Boolean(process.env.XERO_CLIENT_ID && process.env.XERO_CLIENT_SECRET && process.env.XERO_REDIRECT_URI && process.env.INTEGRATION_ENCRYPTION_KEY);
}

export function createXeroClient(state?: string) {
  const clientId = required("XERO_CLIENT_ID");
  const clientSecret = required("XERO_CLIENT_SECRET");
  const redirectUri = required("XERO_REDIRECT_URI");
  return new XeroClient({
    clientId,
    clientSecret,
    redirectUris: [redirectUri],
    scopes: XERO_SCOPES,
    state,
    httpTimeout: 15_000,
    clockTolerance: 10,
  });
}

export function xeroCallbackUrl(requestUrl: string) {
  const callback = new URL(required("XERO_REDIRECT_URI"));
  callback.search = new URL(requestUrl).search;
  return callback.toString();
}

export function tokenSetParameters(tokenSet: TokenSet): TokenSetParameters {
  return {
    access_token: tokenSet.access_token,
    refresh_token: tokenSet.refresh_token,
    id_token: tokenSet.id_token,
    token_type: tokenSet.token_type,
    scope: tokenSet.scope,
    expires_at: tokenSet.expires_at,
  };
}

export function tokenExpiry(tokenSet: TokenSet | TokenSetParameters) {
  const expiresAt = tokenSet.expires_at ?? Math.floor(Date.now() / 1000) + 1800;
  return new Date(expiresAt * 1000).toISOString();
}

export function tokenScopes(tokenSet: TokenSet | TokenSetParameters) {
  const scope = tokenSet.scope;
  return Array.isArray(scope) ? scope : typeof scope === "string" ? scope.split(" ").filter(Boolean) : [];
}

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

// xero-node throws error objects (not plain Errors) carrying the real API detail
// on .response.body / .body — pull it out so failures are diagnosable instead of
// a generic message. Falls back to .message, then the stringified error.
export function describeXeroError(error: unknown): string {
  if (error && typeof error === "object") {
    const e = error as { message?: string; body?: unknown; response?: { statusCode?: number; body?: unknown } };
    const body = e.response?.body ?? e.body;
    if (body && (typeof body !== "object" || Object.keys(body).length > 0)) {
      const detail = typeof body === "string" ? body : JSON.stringify(body);
      return e.response?.statusCode ? `HTTP ${e.response.statusCode}: ${detail}` : detail;
    }
    if (typeof e.message === "string" && e.message) return e.message;
  }
  return error instanceof Error ? error.message : String(error);
}
