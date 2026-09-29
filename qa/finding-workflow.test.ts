import assert from "node:assert/strict";
import test from "node:test";
import type { Finding } from "../apps/web/lib/types";
import { defaultReviewReason, evidenceRowIndexes, findingActivityLabel, findingDetectionConfidence, findingEvidenceReference, findingEvidenceStrengthScore, findingEvidenceTier, findingLifecycleCounts, findingOwner, findingSeverityRank, findingTriggeredReason, isReadyForManagerReview, managerReviewStatus } from "../apps/web/lib/finding-workflow";

const finding = (status: Finding["status"], extra: Partial<Finding> = {}) => ({ status, ...extra } as Finding);

test("manager readiness derives from lifecycle unless explicitly recorded", () => {
  assert.equal(isReadyForManagerReview(finding("evidence_received")), true);
  assert.equal(managerReviewStatus(finding("open")), "not_ready");
  assert.equal(managerReviewStatus(finding("open", { managerReviewStatus: "returned" })), "returned");
});

test("lifecycle counts normalize legacy finding statuses", () => {
  const counts = findingLifecycleCounts([finding("open"), finding("in_review"), finding("accepted"), finding("false_positive")]);
  assert.equal(counts.open, 1);
  assert.equal(counts.under_review, 1);
  assert.equal(counts.approved + counts.closed, 2);
});

test("workflow copy and ownership remain audit-friendly", () => {
  assert.match(defaultReviewReason("evidence_requested"), /requested supporting evidence/i);
  assert.equal(findingOwner(finding("open", { assignedTo: "Manager A", reviewer: "Reviewer B" })), "Manager A");
  assert.equal(findingActivityLabel("manager_review_returned"), "Manager Review Returned");
});

test("evidence presentation derives stable references and quality signals", () => {
  const item = finding("open", {
    severity: "high",
    confidence: "medium",
    evidenceStrength: "deterministic",
    description: "Duplicate supplier payment detected",
    expectedImpact: "£1,250",
    evidence: {
      sourceFile: "ledger.csv",
      accountCode: "SUP-42",
      calculation: "Two invoices share the same reference",
      rows: [
        { sheetName: "AP", rowIndex: 12 },
        { sheetName: "AP", rowIndex: 19 },
      ],
    },
  });

  assert.equal(evidenceRowIndexes(item.evidence.rows), "AP:12 / AP:19");
  assert.deepEqual(findingEvidenceReference(item), {
    sourceFile: "ledger.csv",
    rowIndexes: "AP:12 / AP:19",
    rowCount: 2,
    accountOrParty: "SUP-42",
    calculation: "Two invoices share the same reference",
  });
  assert.equal(findingDetectionConfidence(item), 75);
  assert.equal(findingEvidenceStrengthScore(item, 1), 99);
  assert.equal(findingEvidenceTier(item), "Deterministic");
  assert.equal(findingSeverityRank(item.severity), 3);
  assert.equal(findingTriggeredReason(item), "Two invoices share the same reference.");
});
