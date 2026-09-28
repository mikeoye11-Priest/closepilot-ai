import { createClient } from "@/lib/supabase-server";
import { requireApiSession } from "@/lib/api-auth";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * One company's analysis snapshot.
 *
 * Snapshots used to travel inside the single workspace blob, so opening one
 * client meant loading every client's findings, evidence and statements. They
 * are fetched and saved one at a time here instead, which is what makes a
 * practice of 1,500 clients workable.
 *
 * tenant_id is always read from the companies table rather than taken from the
 * request: a caller must not be able to nominate the tenant a snapshot is
 * filed under, and RLS is enforced against that looked-up pair.
 */
async function resolveTenantId(
  supabase: Awaited<ReturnType<typeof createClient>>,
  companyId: string
): Promise<string | null> {
  const { data, error } = await supabase
    .from("companies")
    .select("tenant_id")
    .eq("id", companyId)
    .maybeSingle();

  if (error || !data) return null;
  return typeof data.tenant_id === "string" ? data.tenant_id : null;
}

export async function GET(request: Request) {
  const session = await requireApiSession();
  if (!session.ok) return session.response;

  const companyId = new URL(request.url).searchParams.get("companyId") ?? "";
  if (!UUID_RE.test(companyId)) {
    return NextResponse.json({ error: "A valid companyId is required" }, { status: 400 });
  }

  if (session.authDisabled) return NextResponse.json({ snapshot: null });

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("company_snapshots")
    .select("data")
    .eq("company_id", companyId)
    .maybeSingle();

  // As with /api/workspace: distinguish "no snapshot yet" from a query failure.
  // Returning null on error would let the client treat a transient fault as an
  // empty review and overwrite a real one on the next save.
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ snapshot: data?.data ?? null });
}

export async function POST(request: Request) {
  const session = await requireApiSession();
  if (!session.ok) return session.response;
  if (session.authDisabled) return NextResponse.json({ success: true });

  const body = await request.json().catch(() => null);
  const companyId = body && typeof body === "object" ? (body as { companyId?: unknown }).companyId : undefined;
  const snapshot = body && typeof body === "object" ? (body as { snapshot?: unknown }).snapshot : undefined;

  if (typeof companyId !== "string" || !UUID_RE.test(companyId)) {
    return NextResponse.json({ error: "A valid companyId is required" }, { status: 400 });
  }
  if (!snapshot || typeof snapshot !== "object") {
    return NextResponse.json({ error: "A snapshot object is required" }, { status: 400 });
  }

  const supabase = await createClient();
  const tenantId = await resolveTenantId(supabase, companyId);
  if (!tenantId) return NextResponse.json({ error: "Unknown company" }, { status: 404 });

  const { error } = await supabase
    .from("company_snapshots")
    .upsert(
      { tenant_id: tenantId, company_id: companyId, data: snapshot, updated_at: new Date().toISOString() },
      { onConflict: "company_id" }
    );

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
