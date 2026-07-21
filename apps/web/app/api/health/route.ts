import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  // Critical checks decide whether the app can serve requests at all.
  // If any of these fail the deployment is genuinely not ready (503).
  const checks = {
    authentication: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
    siteUrl: Boolean(process.env.NEXT_PUBLIC_SITE_URL),
    productionAuthEnforced: !(process.env.NODE_ENV === "production" && process.env.CLOSEPILOT_AUTH_DISABLED === "1"),
  };

  // Capabilities are non-blocking. When one is missing the app still serves
  // (e.g. small/immediate uploads work without the background worker), so it
  // reports "degraded" with a 200 rather than failing the whole health check.
  const capabilities = {
    backgroundWorker: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY && (process.env.INGESTION_WORKER_SECRET || process.env.CRON_SECRET)),
    aiCommentary: Boolean(process.env.GEMINI_API_KEY),
    errorTracking: Boolean(process.env.SENTRY_DSN),
    rateLimiting: Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN),
    xero: Boolean(process.env.XERO_CLIENT_ID && process.env.XERO_CLIENT_SECRET && process.env.XERO_REDIRECT_URI && process.env.INTEGRATION_ENCRYPTION_KEY),
    quickbooks: Boolean(process.env.QUICKBOOKS_CLIENT_ID && process.env.QUICKBOOKS_CLIENT_SECRET && process.env.QUICKBOOKS_REDIRECT_URI && process.env.INTEGRATION_ENCRYPTION_KEY),
  };

  const ready = Object.values(checks).every(Boolean);
  const status = !ready ? "not_ready" : capabilities.backgroundWorker ? "ready" : "degraded";

  return NextResponse.json({
    status,
    checks,
    capabilities,
    deployment: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "local",
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "unknown",
    // Which QuickBooks host the sync targets (sandbox vs production), so setup
    // can be confirmed without signing in. Only meaningful when quickbooks config
    // is present.
    quickbooksEnvironment: capabilities.quickbooks ? (process.env.QUICKBOOKS_ENVIRONMENT ?? "sandbox") : undefined,
    // Retained for backward compatibility with existing uptime monitors.
    optional: {
      aiCommentary: capabilities.aiCommentary,
      xero: capabilities.xero,
      quickbooks: capabilities.quickbooks,
    },
  }, { status: ready ? 200 : 503 });
}
