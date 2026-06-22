import { requireApiSession } from "@/lib/api-auth";
import { createClient } from "@/lib/supabase-server";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  const session = await requireApiSession();
  if (!session.ok) return session.response;

  const body = await request.json();
  const tenantId = stringValue(body.tenantId);
  const companyId = stringValue(body.companyId);
  const approval = objectValue(body.approval);
  const approvalId = stringValue(approval.id);
  const status = stringValue(approval.status);

  if (!approvalId || !["approved", "approved_with_risks", "reopened"].includes(status)) {
    return NextResponse.json({ error: "A valid VAT filing approval is required" }, { status: 400 });
  }
  if (session.authDisabled) return NextResponse.json({ persisted: false, reason: "auth_disabled", approvalId });
  if (!UUID_RE.test(tenantId) || !UUID_RE.test(companyId) || !UUID_RE.test(approvalId)) {
    return NextResponse.json({ persisted: false, reason: "uuid_scope_required", approvalId });
  }

  const supabase = await createClient();
  const reportId = crypto.randomUUID();
  const { error: reportError } = await supabase.from("reports").insert({
    id: reportId,
    tenant_id: tenantId,
    company_id: companyId,
    report_type: "vat_filing_signoff",
    title: "ClosePilot VAT Filing Review Pack",
    export_status: status === "reopened" ? "reopened" : "approved",
    metadata: { approval },
  });
  if (reportError) return NextResponse.json({ error: reportError.message }, { status: 500 });

  const { error: auditError } = await supabase.from("audit_logs").insert({
    id: crypto.randomUUID(),
    tenant_id: tenantId,
    user_id: session.userId,
    action: status === "reopened" ? "vat_filing_reopened" : "vat_filing_approved",
    entity_type: "vat_filing_approval",
    entity_id: approvalId,
  });
  if (auditError) return NextResponse.json({ error: auditError.message }, { status: 500 });

  return NextResponse.json({ persisted: true, approvalId, reportId });
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
