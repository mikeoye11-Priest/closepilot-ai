import { requireApiSession } from "@/lib/api-auth";
import { createClient } from "@/lib/supabase-server";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Right to erasure: permanently delete a client company's synced accounting data
// (the imported financials in accounting_sync_runs) and its provider connections
// (accounting_integrations). This is the destructive complement to disconnect,
// which keeps the evidence. Scoped and authorised by RLS: the acting user can
// only erase companies they have access to. The financial data (sync runs) is
// gated by has_company_access so it wipes fully; integration/token rows also
// require user_id = auth.uid(), so any connected by a different practice member
// are reported back as still present rather than silently ignored.
export async function POST(request: Request) {
  const session = await requireApiSession();
  if (!session.ok) return session.response;
  if (session.authDisabled || !session.userId) return NextResponse.json({ error: "Authentication is required." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const tenantId = typeof body.tenantId === "string" ? body.tenantId : "";
  const companyId = typeof body.companyId === "string" ? body.companyId : "";
  if (!UUID_RE.test(tenantId) || !UUID_RE.test(companyId)) {
    return NextResponse.json({ error: "A UUID tenantId and companyId are required." }, { status: 400 });
  }

  const supabase = await createClient();
  // RLS already scopes every query to the acting user's company access.
  const countRuns = async () => (await supabase.from("accounting_sync_runs").select("*", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("company_id", companyId)).count ?? 0;
  const countConnections = async () => (await supabase.from("accounting_integrations").select("*", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("company_id", companyId)).count ?? 0;

  const runsBefore = await countRuns();
  const connectionsBefore = await countConnections();
  if (runsBefore === 0 && connectionsBefore === 0) {
    return NextResponse.json({ erasedRuns: 0, erasedConnections: 0, remainingConnections: 0, message: "There is no synced accounting data to erase for this client." });
  }

  // Delete the imported financials first, then the connections. (Deleting the
  // connection cascades its runs, but sync runs are deletable independently of
  // which user connected — so this removes the sensitive data in full.)
  const { error: runsError } = await supabase.from("accounting_sync_runs").delete().eq("tenant_id", tenantId).eq("company_id", companyId);
  if (runsError) return NextResponse.json({ error: runsError.message }, { status: 500 });
  const { error: connError } = await supabase.from("accounting_integrations").delete().eq("tenant_id", tenantId).eq("company_id", companyId);
  if (connError) return NextResponse.json({ error: connError.message }, { status: 500 });

  // Re-count from the acting user's own RLS view to confirm nothing they can see
  // survived. (Sync runs — the imported financials — are gated only by company
  // access, so every one for this company is removed. Connection/token rows are
  // additionally scoped to user_id = auth.uid(), so any created by another member
  // are neither visible nor deletable here; those members disconnect their own.)
  const remainingRuns = await countRuns();
  const remainingConnections = await countConnections();
  const erasedRuns = runsBefore - remainingRuns;
  const erasedConnections = connectionsBefore - remainingConnections;

  // Retain the fact of erasure in the audit trail (the data itself is gone).
  await supabase.from("audit_logs").insert({ id: crypto.randomUUID(), tenant_id: tenantId, user_id: session.userId, action: "integration_data_erased", entity_type: "company", entity_id: companyId });

  return NextResponse.json({
    erasedRuns,
    erasedConnections,
    message: remainingRuns + remainingConnections > 0
      ? `Erased ${erasedRuns} synced record set(s) and ${erasedConnections} connection(s). Some data could not be removed and may need an administrator.`
      : `Erased ${erasedRuns} synced record set(s) and ${erasedConnections} connection(s). No synced accounting data remains for this client.`,
  });
}
