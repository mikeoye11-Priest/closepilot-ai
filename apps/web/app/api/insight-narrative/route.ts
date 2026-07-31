import { requireApiSession } from "@/lib/api-auth";
import { enforceRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

// Reusable grounded narrator. Takes a deterministic fact sheet (built client-side
// from an engine's numbers) + a working conclusion, and returns a short prose
// briefing that narrates ONLY those figures — never new numbers. Never blocks:
// absent key / timeout / failure fall back to the caller's deterministic summary.
async function narrate(role: string, factSheet: string, headline: string): Promise<string | undefined> {
  if (!process.env.GEMINI_API_KEY) return undefined;
  const prompt = `You are ${role} briefing an owner-manager.

Use ONLY the figures in this fact sheet — do not invent, infer or add any number that is not present:
${factSheet}

Working conclusion: ${headline}

Write exactly two short paragraphs, plain prose (no markdown, no bullets, under 150 words total):
1. What the numbers mean together (the position / the risk).
2. The single most important action and why.
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

const ROLES: Record<string, string> = {
  fd: "a UK finance director",
  vat: "a UK VAT and Making Tax Digital adviser",
  findings: "a UK audit manager reviewing exceptions",
  audit: "a UK audit manager assessing audit readiness",
};

export async function POST(request: Request) {
  const session = await requireApiSession();
  if (!session.ok) return session.response;
  if (session.authDisabled || !session.userId) return NextResponse.json({ error: "Authentication is required." }, { status: 401 });

  const limited = await enforceRateLimit("ai", rateLimitKey(session.userId, request));
  if (limited) return limited;

  const body = await request.json().catch(() => ({}));
  const factSheet = typeof body.factSheet === "string" ? body.factSheet.slice(0, 6000) : "";
  const headline = typeof body.headline === "string" ? body.headline.slice(0, 400) : "";
  const role = ROLES[typeof body.role === "string" ? body.role : "fd"] ?? ROLES.fd;
  if (!factSheet.trim()) return NextResponse.json({ error: "A fact sheet is required." }, { status: 400 });

  const narrative = await narrate(role, factSheet, headline);
  return NextResponse.json({ narrative: narrative ?? headline, aiGenerated: Boolean(narrative) });
}
