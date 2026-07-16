import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/api-auth";
import { enforceRateLimit, rateLimitKey } from "@/lib/rate-limit";

export const runtime = "nodejs";

// Grounded, per-finding explanation. The model narrates why the finding matters
// and how to fix it, strictly from the facts supplied — it must not introduce
// figures of its own. Numbers stay deterministic; the AI only writes prose.
export async function POST(request: Request) {
  const session = await requireApiSession();
  if (!session.ok) return session.response;

  const limited = await enforceRateLimit("ai", rateLimitKey(session.userId, request));
  if (limited) return limited;

  if (!process.env.GEMINI_API_KEY) {
    return NextResponse.json({ error: "GEMINI_API_KEY not configured" }, { status: 500 });
  }

  const { title, description, severity, category, expectedImpact, recommendation, standard, evidence } = await request.json();

  const prompt = `You are a UK accounting reviewer. Explain a single review finding to the engagement partner.

Finding: ${title ?? "Untitled finding"}
Severity: ${severity ?? "unknown"}
Category: ${category ?? "general"}
What was detected: ${description ?? "n/a"}
Estimated impact: ${expectedImpact ?? "not quantified"}
Suggested fix: ${recommendation ?? "n/a"}
Relevant standard: ${standard ?? "n/a"}
Evidence/calculation: ${evidence ?? "n/a"}

Write 2-3 short sentences covering: why this matters (financial, compliance and audit impact) and what to do about it.
STRICT RULES: Use only the figures given above — do not invent or estimate any numbers, amounts or percentages. Reference the standard only if one is supplied. Plain prose, no markdown, no bullet points, under 90 words. Direct and professional.`;

  try {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    const result = await model.generateContent(prompt);
    return NextResponse.json({ explanation: result.response.text() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI request failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
