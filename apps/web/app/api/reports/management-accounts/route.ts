import { requireApiSession } from "@/lib/api-auth";
import { createClient } from "@/lib/supabase-server";
import { buildManagementAccounts, renderManagementAccountsHtml, managementAccountsFactSheet } from "@/lib/management-accounts";
import { loadReportStatements, withReportingPeriod } from "@/lib/report-statements";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

function htmlPage(body: string, status = 200) {
  return new NextResponse(`<!doctype html><meta charset="utf-8"><title>Management Accounts</title><body style="font-family:system-ui;max-width:640px;margin:80px auto;padding:0 24px;color:#0f172a"><h1 style="font-size:20px">Management accounts</h1><p style="color:#475569">${body}</p></body>`, { status, headers: { "Content-Type": "text/html; charset=utf-8" } });
}
const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "company";

// Grounded, review-gated narrative. Returns undefined (deterministic observations
// still render) if the key is absent, disabled, or the call fails / times out —
// the pack must never block on AI, and the AI only narrates the fact sheet.
async function aiNarrative(factSheet: string, companyName: string, period: string): Promise<string | undefined> {
  if (!process.env.GEMINI_API_KEY) return undefined;
  const prompt = `You are a UK management accountant writing the commentary for the management accounts of ${companyName} for the period to ${period}.

Use ONLY the figures in this fact sheet — do not invent, infer or add any numbers that are not present:
${factSheet}

Write exactly three short paragraphs, plain prose (no markdown, no bullet points, under 220 words total):
1. Trading performance — revenue, gross and net profit/margin, and one clear takeaway.
2. Financial position and working capital — net assets, cash, debtor/creditor days and liquidity.
3. Matters requiring attention — the most material review points and recommended actions.
Tone: professional, concise, for an owner-manager. Refer to figures exactly as given.`;
  try {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    const result = await Promise.race([
      model.generateContent(prompt),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("ai-timeout")), 15_000)),
    ]);
    return (result as Awaited<ReturnType<typeof model.generateContent>>).response.text().trim() || undefined;
  } catch {
    return undefined;
  }
}

export async function GET(request: Request) {
  const session = await requireApiSession();
  if (!session.ok) return session.response;
  if (session.authDisabled || !session.userId) return htmlPage("Sign in to ClosePilot, then reopen the management accounts.", 401);

  const url = new URL(request.url);
  const syncId = url.searchParams.get("syncId") ?? "";
  const tenantId = url.searchParams.get("tenantId") ?? "";
  const companyId = url.searchParams.get("companyId") ?? "";
  const format = url.searchParams.get("format") ?? "html";
  const autoPrint = url.searchParams.get("print") === "1";
  const aiEnabled = url.searchParams.get("ai") !== "0";

  const supabase = await createClient();
  const loaded = await loadReportStatements(supabase, { userId: session.userId, syncId, tenantId, companyId });
  if (!loaded) return htmlPage("No accounts data found for this company. Run a Xero sync (Settings → Sync now) or upload a trial balance, P&L and balance sheet, then reopen this page.", 404);

  const statements = withReportingPeriod(loaded.statements, url.searchParams.get("asOfDate"));
  const findings = loaded.findings;
  const pack = buildManagementAccounts(statements, findings);

  if (format === "xlsx" || format === "excel") {
    const { buildManagementWorkbook } = await import("@/lib/accounts-xlsx");
    const buffer = await buildManagementWorkbook(pack).xlsx.writeBuffer();
    const filename = `${slug(pack.meta.companyName)}-management-accounts-${statements.asOfDate}.xlsx`;
    return new NextResponse(buffer as ArrayBuffer, { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${filename}"` } });
  }

  const aiCommentary = aiEnabled ? await aiNarrative(managementAccountsFactSheet(pack, findings), pack.meta.companyName, statements.asOfDate) : undefined;
  const isWord = format === "doc" || format === "word";
  const html = renderManagementAccountsHtml(pack, { autoPrint, aiCommentary, word: isWord });

  if (isWord) {
    const filename = `${slug(pack.meta.companyName)}-management-accounts-${statements.asOfDate}.doc`;
    return new NextResponse(html, { headers: { "Content-Type": "application/msword", "Content-Disposition": `attachment; filename="${filename}"` } });
  }
  return new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
