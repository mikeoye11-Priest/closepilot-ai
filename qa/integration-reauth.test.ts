import test from "node:test";
import assert from "node:assert/strict";
import { isReauthError } from "../apps/web/lib/integrations/reauth";

// Durable auth failures that mean the OAuth grant is gone — only a reconnect
// fixes these, across Xero / QuickBooks / Sage error shapes.
test("revoked / expired grant errors are classified as needing reconnect", () => {
  assert.equal(isReauthError(new Error("invalid_grant")), true, "OAuth invalid_grant");
  assert.equal(isReauthError(new Error("The refresh token is invalid or has expired")), true);
  assert.equal(isReauthError(new Error("Token has expired")), true);
  assert.equal(isReauthError(new Error("401 Unauthorized")), true);
  assert.equal(isReauthError(new Error("consent was revoked by the user")), true);
  assert.equal(isReauthError({ error: "invalid_grant", error_description: "Token revoked" }), true, "QuickBooks token endpoint shape");
  assert.equal(isReauthError({ statusCode: 401, message: "Unauthorized" }), true, "status-code shape");
  assert.equal(isReauthError({ response: { status: 401 } }), true, "nested response status");
});

// Transient / data problems must NOT be misclassified — a retry can clear these,
// and flagging them as reconnect-needed would send users on a pointless OAuth trip.
test("transient and data errors are NOT classified as needing reconnect", () => {
  assert.equal(isReauthError(new Error("QuickBooks returned no data — VAT report empty")), false);
  assert.equal(isReauthError(new Error("Network timeout while contacting Xero")), false);
  assert.equal(isReauthError(new Error("Could not persist refreshed Xero tokens: database unavailable")), false);
  assert.equal(isReauthError({ statusCode: 503, message: "Service Unavailable" }), false);
  assert.equal(isReauthError(undefined), false);
  assert.equal(isReauthError(null), false);
});
