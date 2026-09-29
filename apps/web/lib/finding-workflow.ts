import { lifecycleStatus, type LifecycleStatus } from "./finding-ledger";
import type { Finding, FindingActivity, FindingStatus, ManagerReviewStatus } from "./types";

export const lifecycleStatuses = [
  "open",
  "under_review",
  "evidence_requested",
  "evidence_received",
  "resolved",
  "approved",
  "closed",
] as const satisfies readonly LifecycleStatus[];

export const reviewedFindingStatuses: FindingStatus[] = [
  "under_review",
  "evidence_requested",
  "evidence_received",
  "resolved",
  "approved",
  "closed",
  "false_positive",
  "accepted_risk",
  "in_review",
  "accepted",
  "rejected",
  "needs_investigation",
  "not_applicable",
];

export function isReadyForManagerReview(finding: Finding) {
  return ["evidence_received", "resolved", "approved", "accepted_risk", "false_positive", "closed"].includes(finding.status);
}

export function managerReviewStatus(finding: Finding): ManagerReviewStatus {
  return finding.managerReviewStatus ?? (isReadyForManagerReview(finding) ? "ready" : "not_ready");
}

export function findingLifecycleCounts(findings: Finding[]) {
  return lifecycleStatuses.reduce<Record<LifecycleStatus, number>>((counts, status) => {
    counts[status] = findings.filter((finding) => lifecycleStatus(finding.status) === status).length;
    return counts;
  }, {
    open: 0,
    under_review: 0,
    evidence_requested: 0,
    evidence_received: 0,
    resolved: 0,
    approved: 0,
    closed: 0,
  });
}

export function defaultReviewReason(status: FindingStatus) {
  const reasons: Partial<Record<FindingStatus, string>> = {
    under_review: "Reviewer started review of the finding and supporting evidence.",
    evidence_requested: "Reviewer requested supporting evidence before approval.",
    evidence_received: "Requested evidence has been received and is ready for review.",
    false_positive: "Reviewer closed the finding as a false positive.",
    accepted_risk: "Reviewer accepted the risk and documented no further remediation.",
    approved: "Finding approved after reviewer and manager review.",
    closed: "Finding closed after review with no further action required.",
    accepted: "Reviewer accepted the finding as valid based on available evidence.",
    rejected: "Reviewer rejected the finding as a false positive.",
    needs_investigation: "Reviewer requested further evidence before final decision.",
    not_applicable: "Reviewer marked the finding as not applicable to this client or period.",
    resolved: "Finding marked resolved after review action.",
  };
  return reasons[status] ?? "Review status updated.";
}

export function findingOwner(finding: Finding) {
  return finding.assignedTo || finding.reviewer || "Unassigned";
}

export function findingDueDate(finding: Finding) {
  if (!finding.dueDate) return "—";
  return new Date(finding.dueDate).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

export function findingActivityLabel(action: FindingActivity["action"]) {
  return action.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}
