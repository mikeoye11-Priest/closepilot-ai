import { requireApiSession } from "@/lib/api-auth";
import { createClient } from "@/lib/supabase-server";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  const session = await requireApiSession();
  if (!session.ok) return session.response;
  if (session.authDisabled) return NextResponse.json({ persisted: false });

  const body = await request.json();
  const tenantId = stringValue(body.tenantId);
  const companyId = stringValue(body.companyId);
  const reportType = stringValue(body.reportType);

  if (!tenantId || !companyId || !reportType) {
    return NextResponse.json({ error: "tenantId, companyId and reportType are required" }, { status: 400 });
  }

  if (!UUID_RE.test(tenantId) || !UUID_RE.test(companyId)) {
    return NextResponse.json({ persisted: false, reason: "uuid_scope_required" });
  }

  const reportId = crypto.randomUUID();
  const supabase = await createClient();
  const { error } = await supabase.from("reports").insert({
    id: reportId,
    tenant_id: tenantId,
    company_id: companyId,
    report_type: reportType,
    title: stringValue(body.title) || null,
    export_status: stringValue(body.exportStatus) || "draft",
    metadata: objectValue(body.metadata),
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await supabase.from("audit_logs").insert({
    id: crypto.randomUUID(),
    tenant_id: tenantId,
    user_id: session.userId,
    action: "report_exported",
    entity_type: "report",
    entity_id: reportId,
  });

  return NextResponse.json({ persisted: true, reportId });
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function objectValue(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
