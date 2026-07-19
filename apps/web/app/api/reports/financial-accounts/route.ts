import { requireApiSession } from "@/lib/api-auth";
import { createClient } from "@/lib/supabase-server";
import { buildStatutoryAccounts, renderStatutoryAccountsHtml } from "@/lib/statutory-accounts";
import { renderIxbrl } from "@/lib/ixbrl";
import { loadReportStatements, withReportingPeriod } from "@/lib/report-statements";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

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
  const loaded = await loadReportStatements(supabase, { userId: session.userId, syncId, tenantId, companyId });
  if (!loaded) return htmlPage("No accounts data found for this company. Run a Xero sync (Settings → Sync now) or upload a trial balance, P&L and balance sheet, then reopen this page.", 404);
  const statements = withReportingPeriod(loaded.statements, url.searchParams.get("asOfDate"));

  const full = url.searchParams.get("basis") === "full";
  const pack = buildStatutoryAccounts(statements, { full });

  if (format === "xlsx" || format === "excel") {
    const { buildStatutoryWorkbook } = await import("@/lib/accounts-xlsx");
    const buffer = await buildStatutoryWorkbook(pack).xlsx.writeBuffer();
    const filename = `${slug(pack.meta.companyName)}-financial-statements-${statements.asOfDate}.xlsx`;
    return new NextResponse(buffer as ArrayBuffer, { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${filename}"` } });
  }

  if (format === "ct600" || format === "ct600-doc") {
    const companyNumber = url.searchParams.get("companyNumber") ?? "";
    const utr = url.searchParams.get("utr") ?? "";
    const { buildCT600, renderCt600Html } = await import("@/lib/ct600");
    const ct600 = buildCT600(pack, { companyNumber, utr });
    const isWord = format === "ct600-doc";
    const html = renderCt600Html(ct600, { autoPrint, word: isWord });
    if (isWord) {
      const filename = `${slug(pack.meta.companyName)}-ct600-draft-${statements.asOfDate}.doc`;
      return new NextResponse(html, { headers: { "Content-Type": "application/msword", "Content-Disposition": `attachment; filename="${filename}"` } });
    }
    return new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
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
