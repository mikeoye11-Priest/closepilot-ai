import type { Finding } from "./types";
import { explainFinding } from "./explainability";

type AskFinding = Pick<
  Finding,
  | "id"
  | "severity"
  | "category"
  | "title"
  | "description"
  | "expectedImpact"
  | "evidence"
  | "ruleId"
  | "status"
  | "confidence"
  | "confidenceScore"
  | "amount"
  | "recommendation"
  | "evidenceStrength"
>;

export type GroundedAnswerSections = {
  executiveSummary: string;
  mainDriver: string;
  whyItMatters: string;
  evidence: string;
  recommendedAction: string;
  relatedFinding: string;
  confidence: string;
};

export type GroundedAnswerResponse = {
  answer: string;
  findingId?: string;
  relatedFindingId?: string;
  followUps: string[];
  sections?: GroundedAnswerSections;
  deterministicOnly?: boolean;
};

export function evidenceGroundedAnswer(question: string, score: number, findings: AskFinding[]) {
  return evidenceGroundedResponse(question, score, findings).answer;
}

export function evidenceGroundedResponse(question: string, score: number, findings: AskFinding[]): GroundedAnswerResponse {
  const normalized = question.toLowerCase();
  const open = findings.filter((finding) => !["resolved", "closed", "false_positive", "accepted_risk", "accepted", "rejected", "not_applicable"].includes(finding.status));

  if (isNextActionRequest(normalized)) {
    return nextActionPlanResponse(open);
  }

  if (isVatReviewPlanRequest(normalized)) {
    return vatReviewPlanResponse(open);
  }

  const relevant = selectRelevantFindings(normalized, open);
  const top = relevant[0] ?? sortFindings(open)[0];

  if (!top) {
    return {
      answer: "I do not have enough uploaded evidence to answer that yet. Upload the finance pack first, then ask about cash, VAT, debtors, creditors, controls or close readiness.",
      followUps: [],
    };
  }

  const explanation = explainFinding(top);
  const sections: GroundedAnswerSections = {
    executiveSummary: executiveSummaryForQuestion(normalized, score, open, top),
    mainDriver: findingLabel(top),
    whyItMatters: explanation.whyItMatters,
    evidence: top.evidence?.calculation || top.description,
    recommendedAction: actionForQuestion(normalized, top).replace(/^Action:\s*/i, ""),
    relatedFinding: relevant[1] ? findingLabel(relevant[1]) : "None identified from the current question.",
    confidence: `${explanation.confidenceScore}%`,
  };

  return {
    answer: sectionsToText(sections),
    findingId: top.id,
    relatedFindingId: relevant[1]?.id,
    followUps: followUpsForQuestion(normalized),
    sections,
  };
}

function isNextActionRequest(question: string) {
  return /\b(what|which|show|give|recommend|recommended|next)\b/.test(question)
    && /\b(next|do|action|actions|priority|priorities|focus|now)\b/.test(question);
}

function nextActionPlanResponse(findings: AskFinding[]): GroundedAnswerResponse {
  const open = sortFindings(findings);
  const topActions = open.slice(0, 4);
  const highRisk = open.filter((finding) => finding.severity === "critical" || finding.severity === "high");
  const estimatedEffort = topActions.reduce((sum, finding) => sum + (finding.severity === "critical" ? 12 : finding.severity === "high" ? 9 : finding.severity === "medium" ? 6 : 3), 0);
  const readinessGain = topActions.reduce((sum, finding) => sum + readinessImpactForFinding(finding), 0);
  const topFinding = topActions[0];
  const actionLines = topActions.length
    ? topActions.map((finding, index) => `${index + 1}. ${actionVerbForFinding(finding)} ${findingLabel(finding)}. Impact +${readinessImpactForFinding(finding)} readiness. Evidence: ${finding.evidence?.calculation || finding.description}`).join(" ")
    : "1. No open findings require action. Prepare the review pack and partner sign-off.";

  const sections: GroundedAnswerSections = {
    executiveSummary: topActions.length
      ? `Recommended next actions generated from ${open.length} open finding(s). Start with ${topFinding ? findingLabel(topFinding) : "the highest-risk item"} because it has the greatest sign-off impact.`
      : "No open finding actions remain. Move to review pack preparation and partner sign-off.",
    mainDriver: topFinding ? findingLabel(topFinding) : "Review pack sign-off",
    whyItMatters: "Prioritising the queue by sign-off impact helps managers clear blockers faster and shows partners how each action improves readiness.",
    evidence: topFinding ? (topFinding.evidence?.calculation || topFinding.description) : "All findings are resolved, accepted, closed or not applicable.",
    recommendedAction: `${actionLines} Estimated review effort: ${estimatedEffort || 5} mins. Potential readiness uplift from these actions: +${Math.min(65, readinessGain)}.`,
    relatedFinding: topActions[1] ? findingLabel(topActions[1]) : highRisk.length ? `${highRisk.length} high-risk item(s) remain.` : "No second priority identified.",
    confidence: "Deterministic workflow",
  };

  return {
    answer: sectionsToText(sections),
    findingId: topFinding?.id,
    relatedFindingId: topActions[1]?.id,
    followUps: ["Show supporting evidence", "Generate manager review note", "Explain audit readiness impact", "Create action plan"],
    sections,
    deterministicOnly: true,
  };
}

function readinessImpactForFinding(finding: AskFinding) {
  if (finding.severity === "critical") return 15;
  if (finding.severity === "high") return 10;
  if (finding.category === "vat") return 9;
  if (finding.category === "month_end" || finding.category === "financial_statements") return 8;
  if (finding.severity === "medium") return 6;
  return 3;
}

function actionVerbForFinding(finding: AskFinding) {
  if (finding.status === "evidence_requested" || finding.status === "evidence_received") return "Review evidence for";
  if (finding.category === "vat") return "Reconcile VAT evidence for";
  if (finding.category === "ar") return "Assign collection owner for";
  if (finding.category === "ap") return "Review supplier evidence for";
  if (finding.category === "controls") return "Document control response for";
  if (finding.severity === "critical" || finding.severity === "high") return "Resolve or accept risk for";
  return "Clear review item for";
}

function isVatReviewPlanRequest(question: string) {
  return /\b(generate|create|prepare|give|show|draft)\b/.test(question)
    && /\bvat\b/.test(question)
    && /\b(step|steps|plan|checklist|procedure|review)\b/.test(question);
}

function vatReviewPlanResponse(findings: AskFinding[]): GroundedAnswerResponse {
  const vatFindings = sortFindings(findings.filter((finding) => finding.category === "vat" || /\b(vat|tax|hmrc|box|return)\b/i.test(findingText(finding))));
  const topVatFinding = vatFindings[0];
  const openHighVat = vatFindings.filter((finding) => finding.severity === "critical" || finding.severity === "high").length;
  const sections: GroundedAnswerSections = {
    executiveSummary: `VAT review plan generated for return sign-off. ${vatFindings.length ? `${vatFindings.length} VAT-related finding(s) require review before filing.` : "No open VAT-specific finding is currently linked, so run the standard VAT sign-off checklist against the uploaded VAT report and TB."}`,
    mainDriver: "VAT Review Plan",
    whyItMatters: "VAT sign-off requires box arithmetic, control account agreement, coding review and evidence for unusual VAT treatments before the return is filed.",
    evidence: topVatFinding
      ? `${findingLabel(topVatFinding)}. ${topVatFinding.evidence?.calculation || topVatFinding.description}`
      : "Use the uploaded VAT report, trial balance VAT control accounts, purchase VAT accounts, sales VAT accounts and any manual VAT journals as the evidence base.",
    recommendedAction: [
      "1. Reconcile Box 1 to sales VAT output accounts and the VAT control account.",
      "2. Reconcile Box 4 to purchase VAT input accounts.",
      "3. Confirm Box 5 agrees to the VAT liability or reclaim balance in the TB.",
      "4. Review reverse charge, import VAT, PVA, exempt and outside-scope transactions.",
      "5. Investigate manual VAT journals and coding overrides.",
      "6. Review exceptions above £5,000 or materiality threshold.",
      "7. Compare the current VAT return to prior periods for unusual movement.",
      "8. Resolve high-risk VAT findings or document accepted risk.",
      "9. Attach supporting VAT evidence.",
      "10. Generate the VAT filing sign-off note."
    ].join(" "),
    relatedFinding: topVatFinding ? findingLabel(topVatFinding) : "No VAT-specific open finding identified.",
    confidence: vatFindings.length ? `${Math.max(72, 92 - openHighVat * 6)}%` : "Deterministic workflow",
  };

  return {
    answer: sectionsToText(sections),
    findingId: topVatFinding?.id,
    relatedFindingId: vatFindings[1]?.id,
    followUps: ["Show VAT evidence", "Explain VAT readiness blockers", "Generate VAT sign-off note", "Create VAT action plan"],
    sections,
    deterministicOnly: true,
  };
}

function selectRelevantFindings(question: string, findings: AskFinding[]) {
  if (/profit|margin|p&l|pnl|loss|revenue|cogs|overhead/.test(question)) {
    const profitFindings = findings.filter((finding) => /profit|margin|p&l|pnl|loss|revenue|cogs|overhead|payroll|salary|wages|cost/i.test(findingText(finding)));
    return sortFindings(profitFindings.length ? profitFindings : findings).slice(0, 3);
  }

  const category = questionCategory(question);
  const filtered = category ? findings.filter((finding) => finding.category === category || matchesQuestionKeywords(question, finding)) : findings;
  return sortFindings(filtered.length ? filtered : findings).slice(0, 3);
}

function questionCategory(question: string) {
  if (/cash|debtor|ar|collect|customer|chase/.test(question)) return "ar";
  if (/vat|tax|hmrc|return|box/.test(question)) return "vat";
  if (/supplier|creditor|ap|payable/.test(question)) return "ap";
  if (/control|fraud|approval|bank|recon/.test(question)) return "controls";
  if (/close|month|sign.?off|ready|readiness|payroll|depreciation/.test(question)) return "month_end";
  return "";
}

function matchesQuestionKeywords(question: string, finding: AskFinding) {
  const text = findingText(finding);
  if (/cash|debtor|ar|collect|customer|chase/.test(question)) return /\b(debtor|customer|receivable|invoice|collection|overdue)\b/i.test(text);
  if (/vat|tax|hmrc|return|box/.test(question)) return /\b(vat|tax|hmrc|return|box)\b/i.test(text);
  if (/supplier|creditor|ap|payable/.test(question)) return /\b(supplier|creditor|payable|ap|invoice)\b/i.test(text);
  if (/control|fraud|approval|bank|recon/.test(question)) return /\b(control|approval|bank|recon|journal|authori[sz]ation)\b/i.test(text);
  if (/close|month|sign.?off|ready|readiness|payroll|depreciation/.test(question)) return /\b(close|month|payroll|salary|wages|depreciation|accrual|suspense)\b/i.test(text);
  return false;
}

function sortFindings(findings: AskFinding[]) {
  return [...findings].sort((a, b) => severityRank(b.severity) - severityRank(a.severity));
}

function severityRank(severity: AskFinding["severity"]) {
  return { critical: 4, high: 3, medium: 2, low: 1 }[severity] ?? 0;
}

function findingLabel(finding: AskFinding) {
  const rule = finding.ruleId ? `${finding.ruleId}: ` : "";
  return `${rule}${finding.title}`;
}

function findingText(finding: AskFinding) {
  return `${finding.title} ${finding.description} ${finding.expectedImpact ?? ""}`.toLowerCase();
}

function executiveSummaryForQuestion(question: string, score: number, findings: AskFinding[], top: AskFinding) {
  if (/profit|margin|p&l|pnl|loss|revenue|cogs|overhead/.test(question)) {
    return `Profit movement is not proven from the question alone; ${findings.length} finding(s) require review, led by ${findingLabel(top)}.`;
  }
  if (/cash|debtor|ar|collect|customer|chase/.test(question)) {
    return `Cash review should start with the highest-priority debtor evidence, led by ${findingLabel(top)}.`;
  }
  if (/vat|tax|hmrc|return|box/.test(question)) {
    return "VAT review should start with evidence-linked VAT exceptions before return sign-off.";
  }
  if (/close|month|sign.?off|ready|readiness|block/.test(question)) {
    return `${findings.length} open finding(s) remain before month-end sign-off, led by ${findingLabel(top)}.`;
  }
  if (/score|health|why.*low|rating/.test(question)) {
    return `Finance Health Score is ${score}/100. The main score driver is ${findingLabel(top)}.`;
  }
  return `Start with ${findingLabel(top)} because it is the highest-priority relevant finding.`;
}

function actionForQuestion(question: string, finding: AskFinding) {
  if (/profit|margin|p&l|pnl|loss|revenue|cogs|overhead/.test(question)) {
    return "Action: review the P&L evidence, confirm revenue and cost completeness, and document variance commentary before relying on profit movement.";
  }
  if (/cash|debtor|ar|collect|customer|chase/.test(question)) {
    return "Action: assign collection ownership, confirm recoverability, and update the provision or cash forecast before review.";
  }
  if (/vat|tax|hmrc|return|box/.test(question)) {
    return "Action: reconcile the VAT evidence to the VAT control account and resolve high-risk coding exceptions before filing.";
  }
  if (/close|month|sign.?off|ready|readiness|block/.test(question)) {
    return "Action: clear this item or document reviewer acceptance before manager sign-off.";
  }
  if (/control|fraud|approval|bank|recon/.test(question)) {
    return "Action: obtain supporting evidence, reviewer approval, and a documented management response.";
  }
  return finding.category === "vat"
    ? "Action: reconcile and document the VAT treatment before submission."
    : "Action: assign an owner, document the evidence, and resolve or accept the finding before sign-off.";
}

function followUpsForQuestion(question: string) {
  if (/vat|tax|hmrc|return|box/.test(question)) {
    return ["Show supporting evidence", "Generate VAT review steps", "Explain impact on audit readiness", "Create action plan"];
  }
  if (/cash|debtor|ar|collect|customer|chase/.test(question)) {
    return ["Show debtor evidence", "Draft collection note", "Explain cash impact", "Assign owner"];
  }
  if (/close|month|sign.?off|ready|readiness|block/.test(question)) {
    return ["Show blockers", "Generate manager review note", "Explain audit readiness impact", "Create action plan"];
  }
  return ["Show supporting evidence", "Generate manager review note", "Explain impact on audit readiness", "Create action plan"];
}

function sectionsToText(sections: GroundedAnswerSections) {
  return [
    `Executive Summary: ${sections.executiveSummary}`,
    `Main Driver: ${sections.mainDriver}`,
    `Why It Matters: ${sections.whyItMatters}`,
    `Evidence: ${sections.evidence}`,
    `Recommended Action: ${sections.recommendedAction}`,
    `Related Finding: ${sections.relatedFinding}`,
    `Confidence: ${sections.confidence}`,
  ].join("\n");
}
