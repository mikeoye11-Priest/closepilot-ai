import { requireApiSession } from "@/lib/api-auth";
import { enforceRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

// A one-page board/partner cover note fronting the review pack. Grounded strictly
// in the supplied brief (numbers come from the pack, never the model). Never
// blocks — absent key / timeout / failure returns undefined so the caller uses a
// deterministic fallback.
async function coverNote(company: string, brief: string): Promise<string | undefined> {
  if (!process.env.GEMINI_API_KEY) return undefined;
  const prompt = `You are a UK finance director writing the one-page cover note that fronts a board and partner review pack for ${company}.

Use ONLY the figures in this brief — do not invent, infer or add any number that is not present:
${brief}

Write a professional cover note in exactly three short paragraphs (plain prose, no markdown, no bullet points, under 200 words total):
1. Purpose of the pack and the overall position.
2. The key matters requiring the board's attention.
3. The recommendation and next steps.
Address it to "the Board". Refer to figures exactly as given. Do not add a date or letterhead.`;
  try {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    const result = await Promise.race([
      model.generateContent(prompt),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("ai-timeout")), 18_000)),
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
  const company = typeof body.company === "string" ? body.company.slice(0, 200) : "the company";
  const brief = typeof body.brief === "string" ? body.brief.slice(0, 6000) : "";
  if (!brief.trim()) return NextResponse.json({ error: "A brief is required." }, { status: 400 });

  const note = await coverNote(company, brief);
  return NextResponse.json({ note: note ?? "", aiGenerated: Boolean(note) });
}
