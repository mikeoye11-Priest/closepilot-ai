import assert from "node:assert/strict";
import test from "node:test";
import { authoriseWorkerRequest } from "../apps/web/lib/worker-auth";

// The background worker endpoint is triggered by an external cron service every
// minute, so its Bearer-token auth boundary is security-critical. These cover
// the exact contract the external scheduler depends on.

test("worker is closed (503) when no secret is configured", () => {
  const result = authoriseWorkerRequest("Bearer anything", undefined);
  assert.deepEqual(result, { ok: false, status: 503, error: "Worker authentication is not configured." });
});

test("worker rejects (401) a missing Authorization header", () => {
  const result = authoriseWorkerRequest(null, "s3cret-value");
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.status, 401);
});

test("worker rejects (401) a wrong bearer token", () => {
  const result = authoriseWorkerRequest("Bearer wrong-token", "s3cret-value");
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.status, 401);
});

test("worker rejects a bare token without the Bearer scheme", () => {
  const result = authoriseWorkerRequest("s3cret-value", "s3cret-value");
  assert.equal(result.ok, false);
});

test("worker accepts the correct Bearer token", () => {
  const result = authoriseWorkerRequest("Bearer s3cret-value", "s3cret-value");
  assert.deepEqual(result, { ok: true });
});
