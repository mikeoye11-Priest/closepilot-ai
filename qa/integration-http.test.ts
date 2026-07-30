import test from "node:test";
import assert from "node:assert/strict";
import { resilientFetch } from "../apps/web/lib/integrations/http";

// Swap global.fetch for a scripted sequence of responses; Retry-After: 0 keeps
// the retry path instant so the tests stay fast.
function mockFetch(sequence: Array<{ status: number; body?: string; retryAfter?: string }>) {
  let calls = 0;
  const original = globalThis.fetch;
  globalThis.fetch = (async () => {
    const step = sequence[Math.min(calls, sequence.length - 1)];
    calls += 1;
    const headers: Record<string, string> = {};
    if (step.retryAfter !== undefined) headers["retry-after"] = step.retryAfter;
    return new Response(step.body ?? "", { status: step.status, headers });
  }) as typeof fetch;
  return { restore: () => { globalThis.fetch = original; }, calls: () => calls };
}

test("retries transient 5xx / 429 then returns the eventual success", async () => {
  const m = mockFetch([
    { status: 503, retryAfter: "0" },
    { status: 429, retryAfter: "0" },
    { status: 200, body: "ok" },
  ]);
  try {
    const res = await resilientFetch("https://provider.test/x", {}, { retries: 3 });
    assert.equal(res.status, 200);
    assert.equal(await res.text(), "ok");
    assert.equal(m.calls(), 3, "two retries then success");
  } finally { m.restore(); }
});

test("does NOT retry deterministic 4xx (auth / bad request)", async () => {
  for (const status of [400, 401, 403, 404]) {
    const m = mockFetch([{ status }, { status: 200 }]);
    try {
      const res = await resilientFetch("https://provider.test/x", {}, { retries: 3 });
      assert.equal(res.status, status, `${status} surfaced immediately`);
      assert.equal(m.calls(), 1, `${status} not retried`);
    } finally { m.restore(); }
  }
});

test("gives up after the retry budget and returns the last response", async () => {
  const m = mockFetch([{ status: 500, body: "down", retryAfter: "0" }]);
  try {
    const res = await resilientFetch("https://provider.test/x", {}, { retries: 2 });
    assert.equal(res.status, 500, "final response surfaced for the caller to handle");
    assert.equal(m.calls(), 3, "1 initial + 2 retries");
  } finally { m.restore(); }
});
