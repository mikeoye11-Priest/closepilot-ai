import assert from "node:assert/strict";
import test from "node:test";
import { withBoundedRetry } from "../apps/web/lib/retry";

test("bounded retry succeeds after transient failures", async () => {
  let calls = 0;
  const result = await withBoundedRetry(async () => {
    calls += 1;
    if (calls < 3) throw new Error("temporary");
    return "ok";
  }, { attempts: 3, baseDelayMs: 0 });
  assert.deepEqual(result, { value: "ok", attempts: 3 });
});

test("bounded retry stops at its attempt limit", async () => {
  let calls = 0;
  await assert.rejects(withBoundedRetry(async () => {
    calls += 1;
    throw new Error("still failing");
  }, { attempts: 3, baseDelayMs: 0 }), /still failing/);
  assert.equal(calls, 3);
});
