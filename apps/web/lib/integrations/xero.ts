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

// Strip anything that looks like a bearer token or JWT. xero-node serialises the
// whole failed request — including the Authorization header — into error fields,
// so this is a hard backstop before any error text is logged or persisted.
export function redactSecrets(text: string): string {
  return text
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/eyJ[A-Za-z0-9._-]{20,}/g, "[jwt-redacted]");
}

// xero-node throws error objects (not plain Errors) carrying the real API detail
// on .response — build a compact, safe message from known fields only. For HTTP
// errors we deliberately ignore .message: xero-node stuffs the full request
// (with the Bearer token) into it, so we surface only status + rate-limit hint +
// the response body (Xero's own error text). Everything else is redacted.
export function describeXeroError(error: unknown): string {
  if (error && typeof error === "object") {
    const e = error as { message?: string; body?: unknown; statusCode?: number; response?: { statusCode?: number; body?: unknown; headers?: Record<string, unknown> } };
    const status = e.response?.statusCode ?? e.statusCode;
    const rateProblem = e.response?.headers?.["x-rate-limit-problem"];
    const rawBody = e.response?.body ?? e.body;
    let bodyDetail = "";
    if (typeof rawBody === "string") bodyDetail = rawBody.trim();
    else if (rawBody && typeof rawBody === "object" && Object.keys(rawBody).length > 0) bodyDetail = JSON.stringify(rawBody);
    if (status) {
      const parts = [`HTTP ${status}`];
      if (typeof rateProblem === "string" && rateProblem) parts.push(`rate-limit: ${rateProblem}`);
      if (bodyDetail) parts.push(redactSecrets(bodyDetail));
      return parts.join(" — ");
    }
    if (bodyDetail) return redactSecrets(bodyDetail);
    if (typeof e.message === "string" && e.message) return redactSecrets(e.message);
  }
  return redactSecrets(error instanceof Error ? error.message : "Unknown Xero error");
}
