import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/api-auth";
import { evidenceGroundedResponse } from "@/lib/ask-closepilot";
import { explainFinding, explanationToPlainText, validateAnswerAgainstFindings } from "@/lib/explainability";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const session = await requireApiSession();
  if (!session.ok) return session.response;

  const { question, score, companyName, accountingSystem, findings, mode } = await request.json();
  const fallback = evidenceGroundedResponse(question, score, Array.isArray(findings) ? findings : []);

  if (mode === "deterministic" || fallback.deterministicOnly || !process.env.GEMINI_API_KEY) {
    return NextResponse.json({ ...fallback, source: "deterministic" });
  }

  const findingSummary = Array.isArray(findings) && findings.length
    ? findings.slice(0, 8).map((f) =>
        [
          `- Rule/Finding: ${f.ruleId ? `${f.ruleId}: ` : ""}${f.title}`,
          `  Severity/category: ${String(f.severity).toUpperCase()} / ${f.category}`,
          `  Description: ${f.description}`,
          `  Impact: ${f.expectedImpact ?? "Not quantified"}`,
          `  Evidence: ${f.evidence?.calculation ?? "No calculation supplied"}`,
          `  Source-of-truth explanation: ${explanationToPlainText(explainFinding(f))}`,
        ].join("\n")
      ).join("\n")
    : "No findings uploaded yet.";

  const systemPrompt = `You are ClosePilot, an expert AI finance reviewer embedded inside a finance assurance platform used by CFOs, finance managers, and accounting practices. You have reviewed the finance pack for ${companyName} (accounting system: ${accountingSystem}).

Their current Finance Health Score is ${score}/100.

Evidence-linked findings from their uploaded data:
${findingSummary}

Rules:
- Be concise and direct. CFOs don't want waffle.
- Preserve the exact rule ID, finding title, numbers and evidence facts from the source-of-truth explanation.
- If the evidence does not prove a cause, say what needs review instead of guessing.
- Do not introduce unsupported causes such as fraud, duplicate invoices, missing sales or payroll errors unless the evidence explicitly says so.
- For profit, margin or P&L questions, do not claim profit is down unless comparative P&L evidence proves movement.
- Give a clear action or recommendation at the end.
- Respond in plain text only (no markdown, no bullet characters, use numbers for lists).
- Keep answers under 200 words.`;

  try {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      systemInstruction: systemPrompt
    });
    const result = await model.generateContent(question);
    const text = result.response.text();
    const grounding = validateAnswerAgainstFindings(text, Array.isArray(findings) ? findings : []);
    if (!grounding.passed) {
      return NextResponse.json({
        ...fallback,
        source: "deterministic",
        warning: "AI response failed grounding validation and was replaced with a deterministic explanation.",
        explanationConfidence: grounding.score,
      });
    }
    return NextResponse.json({ ...fallback, answer: text, source: "ai_grounded", explanationConfidence: grounding.score });
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI request failed";
    return NextResponse.json({ ...fallback, warning: message, source: "deterministic" });
  }
}
