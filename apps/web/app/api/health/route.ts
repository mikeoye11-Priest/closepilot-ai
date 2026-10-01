import { NextResponse } from "next/server";
import { deploymentHealth } from "@/lib/deployment-health";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const health = await deploymentHealth();
  if (!health.ready) logger.warn("deployment readiness check failed", { route: "/api/health", checks: health.checks });

  return NextResponse.json({
    ...health,
    optional: {
      aiCommentary: health.capabilities.aiCommentary,
      xero: health.capabilities.xero,
      quickbooks: health.capabilities.quickbooks,
      sage: health.capabilities.sage,
    },
  }, { status: health.ready ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
