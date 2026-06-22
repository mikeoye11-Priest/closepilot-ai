import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const checks = {
    authentication: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
    siteUrl: Boolean(process.env.NEXT_PUBLIC_SITE_URL),
    productionAuthEnforced: !(process.env.NODE_ENV === "production" && process.env.CLOSEPILOT_AUTH_DISABLED === "1"),
  };
  const ready = Object.values(checks).every(Boolean);

  return NextResponse.json({
    status: ready ? "ready" : "not_ready",
    checks,
    deployment: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "local",
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "unknown",
    optional: {
      aiCommentary: Boolean(process.env.GEMINI_API_KEY),
      xero: Boolean(process.env.XERO_CLIENT_ID && process.env.XERO_CLIENT_SECRET && process.env.XERO_REDIRECT_URI && process.env.INTEGRATION_ENCRYPTION_KEY),
    },
  }, { status: ready ? 200 : 503 });
}
