import assert from "node:assert/strict";
import test from "node:test";
import { scrubSentryBreadcrumb, scrubSentryEvent } from "../apps/web/lib/sentry-privacy";

test("Sentry events discard identity, request payloads, credentials, and query strings", () => {
  const event = scrubSentryEvent({
    user: { id: "user-1", email: "partner@example.com", ip_address: "127.0.0.1" },
    request: {
      method: "POST",
      url: "https://closepilot.example/api/reports?token=secret&company=acme",
      headers: { authorization: "Bearer secret", cookie: "session=secret" },
      cookies: { session: "secret" },
      query_string: "token=secret",
      data: { trialBalance: [{ account: "1000", amount: 99 }] },
    },
    extra: {
      tenantId: "tenant-1",
      evidence: { customer: "Jane", amount: 99 },
      note: "Contact partner@example.com",
      nested: { accessToken: "secret" },
    },
  });

  assert.equal(event.user, undefined);
  assert.deepEqual(event.request, { method: "POST", url: "https://closepilot.example/api/reports" });
  assert.equal((event.extra as Record<string, unknown>).evidence, "[redacted]");
  assert.equal((event.extra as Record<string, unknown>).note, "Contact [redacted-email]");
  assert.deepEqual((event.extra as Record<string, unknown>).nested, { accessToken: "[redacted]" });
  assert.equal((event.extra as Record<string, unknown>).tenantId, "tenant-1");
});

test("Sentry breadcrumbs preserve useful paths while removing signed parameters", () => {
  const breadcrumb = scrubSentryBreadcrumb({
    message: "Failed for reviewer@example.com",
    data: { url: "/storage/object?token=secret&signature=private", status_code: 403 },
  });

  assert.equal(breadcrumb.message, "Failed for [redacted-email]");
  assert.deepEqual(breadcrumb.data, { url: "/storage/object", status_code: 403 });
});
