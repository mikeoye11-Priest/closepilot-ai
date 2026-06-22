import type { VatFilingApproval, VatReviewResult } from "./types";

type ApprovalNames = {
  preparedBy: string;
  reviewedBy: string;
  approvedBy: string;
};

export async function approveVatFiling(vatReview: VatReviewResult, names: ApprovalNames): Promise<VatReviewResult> {
  const filingSignOff = vatReview.filingSignOff;
  if (!filingSignOff || filingSignOff.status === "not_ready") throw new Error("Resolve VAT filing blockers before approval.");
  const preparedBy = requiredName(names.preparedBy, "preparer");
  const reviewedBy = requiredName(names.reviewedBy, "reviewer");
  const approvedBy = requiredName(names.approvedBy, "approver");
  const now = new Date().toISOString();
  const snapshot = {
    vatReturn: { ...vatReview.vatReturn },
    readinessScore: vatReview.readinessScore ?? vatReview.healthScore,
    assuranceChecks: (vatReview.assuranceChecks ?? []).map((check) => ({ ...check })),
    filingSignOff: { ...filingSignOff, blockers: [...filingSignOff.blockers], risks: [...filingSignOff.risks] },
    periodComparison: vatReview.periodComparison ? { ...vatReview.periodComparison } : undefined,
  };
  const snapshotHash = await sha256(JSON.stringify(snapshot));
  const priorTrail = vatReview.filingApproval?.auditTrail ?? [];
  const status = filingSignOff.status === "ready_with_risks" ? "approved_with_risks" : "approved";
  const approval: VatFilingApproval = {
    id: vatReview.filingApproval?.id ?? crypto.randomUUID(),
    status,
    preparedBy,
    reviewedBy,
    approvedBy,
    approvedAt: now,
    acknowledgedRisks: status === "approved_with_risks" ? [...filingSignOff.risks] : [],
    locked: true,
    snapshotHash,
    snapshot,
    evidenceReferences: evidenceReferences(vatReview),
    reportMetadata: { title: "ClosePilot VAT Filing Review Pack", version: "VAT-V2", generatedAt: now },
    auditTrail: [...priorTrail, { action: status, actor: approvedBy, at: now }],
  };
  return { ...vatReview, filingApproval: approval };
}

export function reopenVatFiling(vatReview: VatReviewResult, actor: string, reason: string): VatReviewResult {
  const approval = vatReview.filingApproval;
  if (!approval?.locked) throw new Error("The VAT filing snapshot is not locked.");
  const cleanReason = reason.trim();
  if (cleanReason.length < 10) throw new Error("Provide a reopening reason of at least 10 characters.");
  const reopenedBy = requiredName(actor, "reviewer");
  const now = new Date().toISOString();
  return {
    ...vatReview,
    filingApproval: {
      ...approval,
      status: "reopened",
      locked: false,
      reopenedAt: now,
      reopenedBy,
      reopenReason: cleanReason,
      auditTrail: [...approval.auditTrail, { action: "reopened", actor: reopenedBy, at: now, reason: cleanReason }],
    },
  };
}

function evidenceReferences(vatReview: VatReviewResult) {
  const references = new Set(vatReview.workpaper?.evidenceReviewed ?? []);
  vatReview.findings.forEach((finding) => {
    if (finding.evidenceDetail?.sourceFile) references.add(finding.evidenceDetail.sourceFile);
  });
  vatReview.boxContributions.forEach((contribution) => references.add(contribution.sourceFile));
  return [...references];
}

function requiredName(value: string, role: string) {
  const name = value.trim();
  if (!name) throw new Error(`A named ${role} is required.`);
  return name;
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
