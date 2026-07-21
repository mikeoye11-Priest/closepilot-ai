import { requireApiSession } from "@/lib/api-auth";
import { encryptIntegrationSecret } from "@/lib/integrations/crypto";
import { buildConsentUrl, quickbooksConfigured } from "@/lib/integrations/quickbooks";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
  const session = await requireApiSession();
  if (!session.ok) return session.response;
  if (session.authDisabled || !session.userId) return NextResponse.json({ error: "Authentication is required to connect QuickBooks." }, { status: 401 });
  if (!quickbooksConfigured()) return NextResponse.json({ error: "QuickBooks OAuth and encryption credentials are not configured." }, { status: 503 });

  const url = new URL(request.url);
  const tenantId = url.searchParams.get("tenantId") ?? "";
  const companyId = url.searchParams.get("companyId") ?? "";
  if (!UUID_RE.test(tenantId) || !UUID_RE.test(companyId)) return NextResponse.json({ error: "A UUID tenantId and companyId are required." }, { status: 400 });

  const state = crypto.randomUUID();
  const context = encryptIntegrationSecret(JSON.stringify({ state, tenantId, companyId, userId: session.userId, createdAt: Date.now() }));
  const response = NextResponse.redirect(buildConsentUrl(state));
  response.cookies.set("closepilot_qbo_oauth", context, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 600 });
  return response;
}
