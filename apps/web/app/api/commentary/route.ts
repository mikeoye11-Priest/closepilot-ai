import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/api-auth";
import { enforceRateLimit, rateLimitKey } from "@/lib/rate-limit";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const session = await requireApiSession();
  if (!session.ok) return session.response;

  const limited = await enforceRateLimit("ai", rateLimitKey(session.userId, request));
  if (limited) return limited;

  const { companyName, score, risk, findings, recommendations, cashAtRisk, financialExposure, period } = await request.json();

  if (!process.env.GEMINI_API_KEY) {
    return NextResponse.json({ error: "GEMINI_API_KEY not configured" }, { status: 500 });
  }

  const findingSummary = Array.isArray(findings) && findings.length
    ? findings.map((f: { severity: string; title: string; description: string; expectedImpact: string }) =>
        `[${f.severity.toUpperCase()}] ${f.title} — ${f.description} (impact: ${f.expectedImpact})`
      ).join("\n")
    : "No findings uploaded.";

  const recSummary = Array.isArray(recommendations) && recommendations.length
    ? recommendations.filter((r: { completed: boolean }) => !r.completed)
        .map((r: { action: string; expectedImpact: string }) => `- ${r.action} (${r.expectedImpact})`)
        .join("\n")
    : "No pending recommendations.";

  const prompt = `Write a concise, board-ready CFO commentary for the finance review of ${companyName} for ${period ?? "the current period"}.

Finance Health Score: ${score}/100 (${risk})
Financial Exposure: £${Number(financialExposure).toLocaleString()}
Cash at Risk: £${Number(cashAtRisk).toLocaleString()}

Findings:
${findingSummary}

Pending Recommendations:
${recSummary}

Write exactly 3 paragraphs:
1. Overall position — what the score means, the headline risk, and one positive.
2. Key findings — the 2-3 most material items and their financial impact.
3. Actions required — what must happen before sign-off, in order of priority.

Tone: direct, professional, suitable for a board pack. No bullet points. No markdown. Plain paragraphs only. Under 250 words total.`;

  try {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    const result = await model.generateContent(prompt);
    const text = result.response.text();
    return NextResponse.json({ commentary: text });
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI request failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
