import { hasTenantCapability } from "@/lib/api-authorization";
import { requireApiSession } from "@/lib/api-auth";
import { createClient } from "@/lib/supabase-server";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CATEGORIES = new Set(["all", "raw_uploads", "analysis_jobs", "audit_logs", "sync_runs", "integration_tokens"]);

async function authorised(tenantId: string) {
  const session = await requireApiSession();
  if (!session.ok) return { response: session.response };
  if (session.authDisabled || !session.userId) {
    return { response: NextResponse.json({ error: "Authentication is required." }, { status: 401 }) };
  }
  const supabase = await createClient();
  if (!await hasTenantCapability(supabase, session.userId, tenantId, "erase_data")) {
    return { response: NextResponse.json({ error: "Only a practice administrator can manage legal holds." }, { status: 403 }) };
  }
  return { supabase, userId: session.userId };
}

export async function GET(request: Request) {
  const tenantId = new URL(request.url).searchParams.get("tenantId") ?? "";
  if (!UUID_RE.test(tenantId)) return NextResponse.json({ error: "A valid tenantId is required." }, { status: 400 });
  const auth = await authorised(tenantId);
  if ("response" in auth) return auth.response;
  const { data, error } = await auth.supabase.from("retention_holds").select("*").eq("tenant_id", tenantId).order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ holds: data ?? [] });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const input = body as Record<string, unknown>;
  const tenantId = typeof input.tenantId === "string" ? input.tenantId : "";
  if (!UUID_RE.test(tenantId)) return NextResponse.json({ error: "A valid tenantId is required." }, { status: 400 });
  const auth = await authorised(tenantId);
  if ("response" in auth) return auth.response;

  if (input.action === "release") {
    const holdId = typeof input.holdId === "string" ? input.holdId : "";
    const reason = typeof input.reason === "string" ? input.reason.trim() : "";
    if (!UUID_RE.test(holdId) || reason.length < 3 || reason.length > 2000) {
      return NextResponse.json({ error: "A valid holdId and release reason are required." }, { status: 400 });
    }
    const { data, error } = await auth.supabase.from("retention_holds").update({
      released_by: auth.userId,
      released_at: new Date().toISOString(),
      release_reason: reason,
    }).eq("id", holdId).eq("tenant_id", tenantId).is("released_at", null).select().maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ error: "Active legal hold not found." }, { status: 404 });
    await auth.supabase.from("audit_logs").insert({ id: crypto.randomUUID(), tenant_id: tenantId, user_id: auth.userId, action: "retention_hold_released", entity_type: "retention_hold", entity_id: holdId });
    return NextResponse.json({ hold: data });
  }

  const companyId = typeof input.companyId === "string" && input.companyId ? input.companyId : null;
  const resourceId = typeof input.resourceId === "string" && input.resourceId ? input.resourceId : null;
  const category = typeof input.category === "string" ? input.category : "";
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  if (!CATEGORIES.has(category) || reason.length < 3 || reason.length > 2000
    || (companyId !== null && !UUID_RE.test(companyId))
    || (resourceId !== null && !UUID_RE.test(resourceId))
    || (resourceId !== null && companyId === null)
    || (category === "audit_logs" && companyId !== null)) {
    return NextResponse.json({ error: "Invalid legal-hold scope, category, or reason." }, { status: 400 });
  }
  if (companyId) {
    const { data: company } = await auth.supabase.from("companies").select("id").eq("id", companyId).eq("tenant_id", tenantId).maybeSingle();
    if (!company) return NextResponse.json({ error: "Company is outside this tenant." }, { status: 403 });
  }
  const { data, error } = await auth.supabase.from("retention_holds").insert({
    id: crypto.randomUUID(),
    tenant_id: tenantId,
    company_id: companyId,
    category,
    resource_id: resourceId,
    reason,
    created_by: auth.userId,
  }).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await auth.supabase.from("audit_logs").insert({ id: crypto.randomUUID(), tenant_id: tenantId, user_id: auth.userId, action: "retention_hold_created", entity_type: "retention_hold", entity_id: data.id });
  return NextResponse.json({ hold: data }, { status: 201 });
}
