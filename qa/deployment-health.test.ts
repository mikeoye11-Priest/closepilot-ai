import assert from "node:assert/strict";
import test from "node:test";
import { deploymentHealth, probeSupabase, type HealthEnvironment } from "../apps/web/lib/deployment-health";

const baseEnvironment: HealthEnvironment = {
  NODE_ENV: "production",
  NEXT_PUBLIC_SITE_URL: "https://closepilot.example",
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "service-key",
  CRON_SECRET: "cron-secret",
};

test("Supabase readiness does not treat publishable keys as bearer JWTs", async () => {
  const originalFetch = globalThis.fetch;
  let request: { url: string; init?: RequestInit } | undefined;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    request = { url: String(input), init };
    return new Response(null, { status: 200 });
  }) as typeof fetch;
  try {
    const result = await probeSupabase("https://example.supabase.co/", "sb_publishable_example");
    assert.equal(result.reachable, true);
    assert.equal(request?.url, "https://example.supabase.co/rest/v1/");
    assert.deepEqual(request?.init?.headers, { apikey: "sb_publishable_example" });
    assert.equal(request?.init?.method, "HEAD");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("readiness is ready when critical configuration and Supabase are healthy", async () => {
  const health = await deploymentHealth(baseEnvironment, async () => ({ reachable: true, latencyMs: 12 }));
  assert.equal(health.ready, true);
  assert.equal(health.status, "ready");
  assert.equal(health.checks.database, true);
  assert.equal(health.databaseLatencyMs, 12);
});

test("optional capabilities degrade without taking a healthy deployment offline", async () => {
  const { SUPABASE_SERVICE_ROLE_KEY: _serviceKey, CRON_SECRET: _cronSecret, ...environment } = baseEnvironment;
  const health = await deploymentHealth(environment, async () => ({ reachable: true, latencyMs: 8 }));
  assert.equal(health.ready, true);
  assert.equal(health.status, "degraded");
  assert.equal(health.capabilities.backgroundWorker, false);
});

test("readiness fails when Supabase is unreachable", async () => {
  const health = await deploymentHealth(baseEnvironment, async () => ({ reachable: false, latencyMs: 3_001 }));
  assert.equal(health.ready, false);
  assert.equal(health.status, "not_ready");
  assert.equal(health.checks.authentication, true);
  assert.equal(health.checks.database, false);
});

test("readiness fails without critical configuration and does not call Supabase", async () => {
  let probeCalls = 0;
  const health = await deploymentHealth(
    { NODE_ENV: "production", NEXT_PUBLIC_SITE_URL: "https://closepilot.example" },
    async () => {
      probeCalls += 1;
      return { reachable: true, latencyMs: 1 };
    },
  );
  assert.equal(health.ready, false);
  assert.equal(health.checks.authentication, false);
  assert.equal(health.checks.database, false);
  assert.equal(probeCalls, 0);
});

test("production auth bypass makes the deployment not ready", async () => {
  const health = await deploymentHealth(
    { ...baseEnvironment, CLOSEPILOT_AUTH_DISABLED: "1" },
    async () => ({ reachable: true, latencyMs: 5 }),
  );
  assert.equal(health.ready, false);
  assert.equal(health.checks.productionAuthEnforced, false);
});
