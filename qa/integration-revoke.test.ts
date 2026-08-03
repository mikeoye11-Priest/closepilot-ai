import test from "node:test";
import assert from "node:assert/strict";

// The provider revoke calls are best-effort external I/O we can't drive live here,
// so these lock the request CONTRACT (endpoint, method, token in body) by mocking
// global fetch. The Sage endpoint shape still needs a sandbox confirmation.

type Call = { url: string; init: RequestInit };
async function withMockedFetch(run: (calls: Call[]) => Promise<void>) {
  const calls: Call[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response("", { status: 200 });
  }) as typeof fetch;
  try { await run(calls); } finally { globalThis.fetch = original; }
}

test("QuickBooks revokeToken POSTs the token to Intuit's revoke endpoint with Basic auth", async () => {
  process.env.QUICKBOOKS_CLIENT_ID = "cid";
  process.env.QUICKBOOKS_CLIENT_SECRET = "sec";
  const { revokeToken } = await import("../apps/web/lib/integrations/quickbooks");
  await withMockedFetch(async (calls) => {
    await revokeToken("refresh-123");
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /oauth2\/tokens\/revoke/);
    assert.equal(calls[0].init.method, "POST");
    assert.match(String((calls[0].init.headers as Record<string, string>).Authorization), /^Basic /);
    assert.match(String(calls[0].init.body), /refresh-123/);
  });
});

test("Sage revokeToken POSTs the token with client credentials to the revoke endpoint", async () => {
  process.env.SAGE_CLIENT_ID = "sid";
  process.env.SAGE_CLIENT_SECRET = "ssec";
  const { revokeToken } = await import("../apps/web/lib/integrations/sage");
  await withMockedFetch(async (calls) => {
    await revokeToken("refresh-xyz");
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /token\/revoke/);
    assert.equal(calls[0].init.method, "POST");
    assert.match(String(calls[0].init.body), /refresh-xyz/);
    assert.match(String(calls[0].init.body), /client_id=sid/);
  });
});

test("a revoke HTTP failure throws (so the disconnect route's try/catch logs it, non-fatally)", async () => {
  process.env.QUICKBOOKS_CLIENT_ID = "cid";
  process.env.QUICKBOOKS_CLIENT_SECRET = "sec";
  const { revokeToken } = await import("../apps/web/lib/integrations/quickbooks");
  const original = globalThis.fetch;
  globalThis.fetch = (async () => new Response("nope", { status: 400 })) as typeof fetch;
  try {
    await assert.rejects(() => revokeToken("t"), /revoke failed: HTTP 400/);
  } finally { globalThis.fetch = original; }
});
