import { requireApiSession } from "@/lib/api-auth";
import { createClient } from "@/lib/supabase-server";
import { buildStatutoryAccounts, renderStatutoryAccountsHtml } from "@/lib/statutory-accounts";
import { renderIxbrl } from "@/lib/ixbrl";
import type { SyncStatements } from "@/lib/management-accounts";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function htmlPage(body: string, status = 200) {
  return new NextResponse(`<!doctype html><meta charset="utf-8"><title>Financial Statements</title><body style="font-family:system-ui;max-width:640px;margin:80px auto;padding:0 24px;color:#0f172a"><h1 style="font-size:20px">Financial statements</h1><p style="color:#475569">${body}</p></body>`, { status, headers: { "Content-Type": "text/html; charset=utf-8" } });
}
const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "company";

export async function GET(request: Request) {
  const session = await requireApiSession();
  if (!session.ok) return session.response;
  if (session.authDisabled || !session.userId) return htmlPage("Sign in to ClosePilot, then reopen the financial statements.", 401);

  const url = new URL(request.url);
  const syncId = url.searchParams.get("syncId") ?? "";
  const tenantId = url.searchParams.get("tenantId") ?? "";
  const companyId = url.searchParams.get("companyId") ?? "";
  const format = url.searchParams.get("format") ?? "html";
  const autoPrint = url.searchParams.get("print") === "1";

  const supabase = await createClient();
  let query = supabase.from("accounting_sync_runs").select("id,result_summary").order("started_at", { ascending: false }).limit(1);
  if (UUID_RE.test(syncId)) query = query.eq("id", syncId);
  else {
    query = query.eq("status", "completed");
    if (tenantId) query = query.eq("tenant_id", tenantId);
    if (companyId) query = query.eq("company_id", companyId);
  }

  const { data, error } = await query;
  const run = data?.[0] as { result_summary?: { statements?: SyncStatements } } | undefined;
  if (error || !run) return htmlPage("No completed Xero sync was found for this company. Run a sync first, then reopen the financial statements.", 404);

  const statements = run.result_summary?.statements;
  if (!statements?.profitLoss) return htmlPage("This review predates accounts-production support. Run a fresh Xero sync (Settings → Sync now), then reopen this page.", 409);

  const full = url.searchParams.get("basis") === "full";
  const pack = buildStatutoryAccounts(statements, { full });

  if (format === "xlsx" || format === "excel") {
    const { buildStatutoryWorkbook } = await import("@/lib/accounts-xlsx");
    const buffer = await buildStatutoryWorkbook(pack).xlsx.writeBuffer();
    const filename = `${slug(pack.meta.companyName)}-financial-statements-${statements.asOfDate}.xlsx`;
    return new NextResponse(buffer as ArrayBuffer, { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${filename}"` } });
  }

  if (format === "ixbrl" || format === "xbrl") {
    const companyNumber = url.searchParams.get("companyNumber") ?? "";
    const filename = `${slug(pack.meta.companyName)}-accounts-${statements.asOfDate}.html`;
    return new NextResponse(renderIxbrl(pack, companyNumber), { headers: { "Content-Type": "application/xhtml+xml; charset=utf-8", "Content-Disposition": `attachment; filename="${filename}"` } });
  }

  const isWord = format === "doc" || format === "word";
  const html = renderStatutoryAccountsHtml(pack, { autoPrint, word: isWord });
  if (isWord) {
    const filename = `${slug(pack.meta.companyName)}-financial-statements-${statements.asOfDate}.doc`;
    return new NextResponse(html, { headers: { "Content-Type": "application/msword", "Content-Disposition": `attachment; filename="${filename}"` } });
  }
  return new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
