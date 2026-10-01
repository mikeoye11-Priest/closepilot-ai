export type HealthEnvironment = Record<string, string | undefined>;

export type DatabaseProbeResult = {
  reachable: boolean;
  latencyMs: number;
};

export type DatabaseProbe = (url: string, anonKey: string) => Promise<DatabaseProbeResult>;

export async function probeSupabase(url: string, anonKey: string): Promise<DatabaseProbeResult> {
  const startedAt = performance.now();
  try {
    const response = await fetch(`${url.replace(/\/$/, "")}/rest/v1/`, {
      method: "HEAD",
      // Supabase publishable keys are API keys, not JWT bearer tokens.
      // The apikey header supports both publishable keys and legacy anon JWTs.
      headers: { apikey: anonKey },
      cache: "no-store",
      signal: AbortSignal.timeout(3_000),
    });
    return { reachable: response.ok, latencyMs: Math.round(performance.now() - startedAt) };
  } catch {
    return { reachable: false, latencyMs: Math.round(performance.now() - startedAt) };
  }
}

export async function deploymentHealth(env: HealthEnvironment = process.env, databaseProbe: DatabaseProbe = probeSupabase) {
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const supabaseAnonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? "";
  const configured = Boolean(supabaseUrl && supabaseAnonKey);
  const database = configured
    ? await databaseProbe(supabaseUrl, supabaseAnonKey)
    : { reachable: false, latencyMs: 0 };

  const checks = {
    authentication: configured,
    database: database.reachable,
    siteUrl: Boolean(env.NEXT_PUBLIC_SITE_URL),
    productionAuthEnforced: !(env.NODE_ENV === "production" && env.CLOSEPILOT_AUTH_DISABLED === "1"),
  };
  const capabilities = {
    backgroundWorker: Boolean(env.SUPABASE_SERVICE_ROLE_KEY && (env.INGESTION_WORKER_SECRET || env.CRON_SECRET)),
    aiCommentary: Boolean(env.GEMINI_API_KEY),
    errorTracking: Boolean(env.SENTRY_DSN),
    rateLimiting: Boolean(env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN),
    xero: Boolean(env.XERO_CLIENT_ID && env.XERO_CLIENT_SECRET && env.XERO_REDIRECT_URI && env.INTEGRATION_ENCRYPTION_KEY),
    quickbooks: Boolean(env.QUICKBOOKS_CLIENT_ID && env.QUICKBOOKS_CLIENT_SECRET && env.QUICKBOOKS_REDIRECT_URI && env.INTEGRATION_ENCRYPTION_KEY),
    sage: Boolean(env.SAGE_CLIENT_ID && env.SAGE_CLIENT_SECRET && env.SAGE_REDIRECT_URI && env.INTEGRATION_ENCRYPTION_KEY),
  };
  const ready = Object.values(checks).every(Boolean);

  return {
    ready,
    status: !ready ? "not_ready" : capabilities.backgroundWorker ? "ready" : "degraded",
    checks,
    capabilities,
    databaseLatencyMs: database.latencyMs,
    deployment: env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "local",
    environment: env.VERCEL_ENV ?? env.NODE_ENV ?? "unknown",
    quickbooksEnvironment: capabilities.quickbooks ? (env.QUICKBOOKS_ENVIRONMENT ?? "sandbox") : undefined,
  };
}
