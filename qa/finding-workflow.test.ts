import assert from "node:assert/strict";
import test from "node:test";
import type { Finding } from "../apps/web/lib/types";
import { defaultReviewReason, findingActivityLabel, findingLifecycleCounts, findingOwner, isReadyForManagerReview, managerReviewStatus } from "../apps/web/lib/finding-workflow";

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
