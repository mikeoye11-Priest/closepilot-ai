import type { Finding } from "./types";

export type ExplanationConfidence = "high" | "medium" | "low";

export type ExplanationResult = {
  findingId: string;
  ruleId?: string;
  title: string;
  explanation: string;
  whyItMatters: string;
  suggestedInvestigation: string;
  recommendedNextStep: string;
  confidence: ExplanationConfidence;
  confidenceScore: number;
  requiredGroundingTerms: string[];
};

export type ExplanationValidationResult = {
  passed: boolean;
  score: number;
  missingGrounding: string[];
  unsupportedClaims: string[];
  warnings: string[];
};

type ExplainableFinding = Pick<
  Finding,
  | "id"
  | "title"
  | "description"
  | "expectedImpact"
  | "category"
  | "severity"
  | "status"
  | "ruleId"
  | "amount"
  | "confidence"
  | "confidenceScore"
  | "recommendation"
  | "evidence"
  | "evidenceStrength"
>;

type ExplanationTemplate = {
  category: Finding["category"];
  base: (finding: ExplainableFinding, amountText: string) => string;
  why: string;
  investigation: string;
  nextStep: string;
  requiredTerms: string[];
};

const templates: Record<string, ExplanationTemplate> = {
  VAT_CONTROL_RECONCILIATION: {
    category: "vat",
    base: (_finding, amountText) => `The VAT control account differs from the VAT return${amountText ? ` by ${amountText}` : ""}. This is a reconciliation issue and should be cleared before the VAT return is treated as ready.`,
    why: "A VAT control difference can indicate a timing difference, late journal, posting error, or VAT report extraction issue.",
    investigation: "Reconcile the VAT report total to the trial balance VAT control account and inspect VAT journals posted after the first export.",
    nextStep: "Upload the reconciliation, explain the difference, and manager-approve the finding before partner sign-off.",
    requiredTerms: ["vat control", "vat return"],
  },
  AR_OVERDUE: {
    category: "ar",
    base: (_finding, amountText) => `The aged debtor review shows overdue receivables${amountText ? ` of ${amountText}` : ""}. This affects cash recoverability and expected credit loss assessment.`,
    why: "Older debtor balances reduce cash confidence and should be supported by recoverability evidence.",
    investigation: "Review post-period receipts, customer correspondence, disputes, and agreed collection actions for the overdue balances.",
    nextStep: "Assign collection ownership and document recoverability evidence or accepted risk rationale.",
    requiredTerms: ["aged debtor", "overdue"],
  },
  AP_DUPLICATE: {
    category: "ap",
    base: (_finding, amountText) => `The AP review identified a possible duplicate supplier invoice${amountText ? ` with exposure of ${amountText}` : ""}. This should be checked before the next payment run.`,
    why: "Duplicate AP items can cause cash leakage if both invoices are paid.",
    investigation: "Compare supplier, invoice reference, invoice date, amount, credit notes, and payment status.",
    nextStep: "Hold duplicate candidates pending supplier statement evidence or mark false positive with support.",
    requiredTerms: ["supplier", "invoice"],
  },
  CONTROL_REVIEW: {
    category: "controls",
    base: (_finding, amountText) => `The controls review identified a control exception${amountText ? ` involving ${amountText}` : ""}. The issue needs evidence of authorisation and business purpose.`,
    why: "Control exceptions weaken audit trail quality and reduce confidence in the close process.",
    investigation: "Review approval evidence, posting date, user history, narration, and supporting documents.",
    nextStep: "Attach evidence and record reviewer approval, escalation, or management response.",
    requiredTerms: ["control"],
  },
  MONTH_END_REVIEW: {
    category: "month_end",
    base: (_finding, amountText) => `The month-end review identified a close issue${amountText ? ` involving ${amountText}` : ""}. This should be resolved or accepted before sign-off.`,
    why: "Open close issues can affect the completeness and accuracy of the reporting pack.",
    investigation: "Review journals, reconciliations, account support, and evidence that the balance has been cleared or explained.",
    nextStep: "Resolve the issue, upload support, or document partner-visible accepted risk.",
    requiredTerms: ["month-end"],
  },
  DEFAULT: {
    category: "data_quality",
    base: (_finding, amountText) => `ClosePilot identified this finding${amountText ? ` with an estimated exposure of ${amountText}` : ""}. The explanation is limited to the uploaded evidence and rule output.`,
    why: "Findings should be reviewed against source evidence before they affect sign-off.",
    investigation: "Inspect the source rows, calculation, validation checks, and reviewer notes linked to the finding.",
    nextStep: "Assign an owner, attach evidence, and resolve, reject, or accept the risk with a documented reason.",
    requiredTerms: [],
  },
};

const unsupportedCausePatterns = [
  { label: "duplicate invoices", pattern: /\bduplicate (sales )?invoices?\b/i },
  { label: "fraud", pattern: /\bfraud|fraudulent\b/i },
  { label: "missing sales", pattern: /\bmissing sales|omitted sales|unrecorded sales\b/i },
  { label: "payroll errors", pattern: /\bpayroll|paye|nic\b/i },
  { label: "bad debts", pattern: /\bbad debts?|write-?off\b/i },
  { label: "supplier overpayment", pattern: /\boverpaid supplier|supplier overpayment\b/i },
];

export function explainFinding(finding: ExplainableFinding): ExplanationResult {
  const template = templateForFinding(finding);
  const amountText = amountForFinding(finding);
  const factText = compactText([
    `${finding.ruleId ? `${finding.ruleId}: ` : ""}${finding.title}.`,
    template.base(finding, amountText),
    finding.description,
    finding.evidence?.calculation ? `Evidence: ${finding.evidence.calculation}` : "",
  ]);
  const confidenceScore = explanationConfidenceScore(finding);
  const requiredGroundingTerms = groundingTermsForFinding(finding, template, amountText);

  return {
    findingId: finding.id,
    ruleId: finding.ruleId,
    title: finding.title,
    explanation: factText,
    whyItMatters: template.why,
    suggestedInvestigation: template.investigation,
    recommendedNextStep: finding.recommendation || template.nextStep,
    confidence: confidenceScore >= 90 ? "high" : confidenceScore >= 75 ? "medium" : "low",
    confidenceScore,
    requiredGroundingTerms,
  };
}

export function explanationToPlainText(result: ExplanationResult) {
  return compactText([
    result.explanation,
    `Why this matters: ${result.whyItMatters}`,
    `Suggested investigation: ${result.suggestedInvestigation}`,
    `Next step: ${result.recommendedNextStep}`,
    `Explanation confidence: ${result.confidenceScore}%.`,
  ]);
}

export function validateExplanationGrounding(explanation: string, finding: ExplainableFinding): ExplanationValidationResult {
  const expected = explainFinding(finding);
  const evidenceText = findingEvidenceText(finding);
  const haystack = normalize(explanation);
  const missingGrounding = expected.requiredGroundingTerms.filter((term) => !haystack.includes(normalize(term)));
  const unsupportedClaims = unsupportedCausePatterns
    .filter((item) => item.pattern.test(explanation) && !item.pattern.test(evidenceText))
    .map((item) => item.label);
  const warnings: string[] = [];

  if (finding.category === "vat" && !/\bvat\b/i.test(explanation)) warnings.push("VAT finding explanation does not mention VAT.");
  if (finding.evidenceStrength === "advisory" && !/indicator|advisory|review/i.test(explanation)) warnings.push("Advisory finding should be framed as review, not conclusion.");

  const score = Math.max(0, 100 - missingGrounding.length * 20 - unsupportedClaims.length * 35 - warnings.length * 5);
  return {
    passed: missingGrounding.length === 0 && unsupportedClaims.length === 0 && score >= 80,
    score,
    missingGrounding,
    unsupportedClaims,
    warnings,
  };
}

export function validateAnswerAgainstFindings(answer: string, findings: ExplainableFinding[]) {
  const relevant = findings.filter((finding) => findingTextMatch(answer, finding));
  const checked = relevant.length ? relevant : findings.slice(0, 3);
  const results = checked.map((finding) => validateExplanationGrounding(answer, finding));
  const failed = results.filter((result) => !result.passed);
  return {
    passed: failed.length === 0,
    score: results.length ? Math.round(results.reduce((sum, result) => sum + result.score, 0) / results.length) : 100,
    results,
  };
}

function templateForFinding(finding: ExplainableFinding) {
  const text = normalize(`${finding.id} ${finding.ruleId ?? ""} ${finding.title} ${finding.description}`);
  if (finding.ruleId === "REC_003" || finding.ruleId === "VAT_051" || /vat.*control|control.*vat|vat.*return/.test(text)) return templates.VAT_CONTROL_RECONCILIATION;
  if (finding.category === "ar" || /aged debtor|overdue|receivable/.test(text)) return templates.AR_OVERDUE;
  if (finding.category === "ap" || /duplicate.*invoice|supplier invoice|creditor/.test(text)) return templates.AP_DUPLICATE;
  if (finding.category === "controls" || /control|journal|approval|authori/.test(text)) return templates.CONTROL_REVIEW;
  if (finding.category === "month_end" || /month.?end|close|suspense|accrual/.test(text)) return templates.MONTH_END_REVIEW;
  return templates.DEFAULT;
}

function groundingTermsForFinding(finding: ExplainableFinding, template: ExplanationTemplate, amountText: string) {
  const terms = new Set<string>([finding.title, ...template.requiredTerms]);
  if (finding.ruleId) terms.add(finding.ruleId);
  if (amountText) terms.add(amountText);
  if (finding.category === "vat") terms.add("VAT");
  return Array.from(terms).filter(Boolean);
}

function amountForFinding(finding: ExplainableFinding) {
  const amount = finding.amount ?? parseImpactAmount(finding.expectedImpact);
  return amount > 0 ? `£${Math.round(amount).toLocaleString("en-GB")}` : "";
}

function parseImpactAmount(impact: string | undefined) {
  if (!impact) return 0;
  const match = impact.match(/(?:£|GBP\s*)([\d,]+)([km]?)/i);
  if (!match) return 0;
  const multiplier = match[2].toLowerCase() === "k" ? 1000 : match[2].toLowerCase() === "m" ? 1_000_000 : 1;
  return Number(match[1].replace(/,/g, "")) * multiplier;
}

function explanationConfidenceScore(finding: ExplainableFinding) {
  const source = finding.confidenceScore ?? ({ high: 92, medium: 78, low: 62 }[finding.confidence] ?? 70);
  const evidenceBonus = finding.evidenceStrength === "deterministic" ? 6 : finding.evidenceStrength === "indicator" ? 0 : -10;
  const hasEvidence = finding.evidence?.calculation || finding.evidence?.rows?.length ? 4 : -8;
  return Math.max(35, Math.min(99, Math.round(source + evidenceBonus + hasEvidence)));
}

function findingEvidenceText(finding: ExplainableFinding) {
  return compactText([
    finding.title,
    finding.description,
    finding.expectedImpact,
    finding.recommendation,
    finding.evidence?.calculation,
    ...(finding.evidence?.rows ?? []).map((row) => Object.values(row.sourceRow ?? {}).join(" ")),
  ]);
}

function findingTextMatch(answer: string, finding: ExplainableFinding) {
  const haystack = normalize(answer);
  return [finding.title, finding.ruleId, finding.category].filter(Boolean).some((term) => haystack.includes(normalize(String(term))));
}

function compactText(parts: Array<string | undefined>) {
  return parts.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

function normalize(value: string) {
  return value.toLowerCase().replace(/,/g, "").replace(/\s+/g, " ").trim();
}
