import { requireApiSession } from "@/lib/api-auth";
import { createClient } from "@/lib/supabase-server";
import { enforceRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { loadReportStatements } from "@/lib/report-statements";
import { buildFinanceInsights } from "@/lib/finance-insights";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Grounded FD commentary: narrates ONLY the fact sheet, never invents numbers,
// and never blocks — returns undefined on absent key / timeout / failure so the
// deterministic headline + signals still stand.
async function aiNarrative(factSheet: string, headline: string): Promise<string | undefined> {
  if (!process.env.GEMINI_API_KEY) return undefined;
  const prompt = `You are a UK finance director briefing an owner-manager on their cash position.

Use ONLY the figures in this fact sheet — do not invent, infer or add any number that is not present:
${factSheet}

Working conclusion: ${headline}

Write exactly two short paragraphs, plain prose (no markdown, no bullets, under 150 words total):
1. The cash and performance position — what the numbers mean together (profit vs cash, liquidity, the cycle).
2. The single most important action this month and why.
Tone: direct, practical, for a busy owner-manager. Refer to figures exactly as given.`;
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

export async function POST(request: Request) {
  const session = await requireApiSession();
  if (!session.ok) return session.response;
  if (session.authDisabled || !session.userId) return NextResponse.json({ error: "Authentication is required." }, { status: 401 });

  const limited = await enforceRateLimit("ai", rateLimitKey(session.userId, request));
  if (limited) return limited;

  const body = await request.json().catch(() => ({}));
  const tenantId = typeof body.tenantId === "string" ? body.tenantId : "";
  const companyId = typeof body.companyId === "string" ? body.companyId : "";
  if (!UUID_RE.test(tenantId) || !UUID_RE.test(companyId)) {
    return NextResponse.json({ error: "A UUID tenantId and companyId are required." }, { status: 400 });
  }

  const supabase = await createClient();
  const loaded = await loadReportStatements(supabase, { userId: session.userId, tenantId, companyId });
  if (!loaded) {
    return NextResponse.json({ error: "No accounts data found for this company. Run a sync or upload a trial balance, aged debtors/creditors and bank first." }, { status: 404 });
  }

  const insights = buildFinanceInsights(loaded.statements);
  const ai = await aiNarrative(insights.factSheet, insights.headline);
  // Deterministic fallback narrative when AI is unavailable.
  const fallback = `${insights.headline} ${insights.signals[0] ? `Priority: ${insights.signals[0].action}` : ""}`.trim();

  return NextResponse.json({
    headline: insights.headline,
    signals: insights.signals,
    narrative: ai ?? fallback,
    aiGenerated: Boolean(ai),
  });
}
