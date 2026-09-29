import { calculateAuditReadinessV2 } from "./finance";
import { isOpenFinding } from "./finding-ledger";
import type { Finding, FindingStatus, Upload, ValidationCheck } from "./types";

export function readinessForecast(findings: Finding[], validationChecks: ValidationCheck[], uploads: Upload[]) {
  const current = calculateAuditReadinessV2(findings, validationChecks, uploads);
  const simulated = (predicate: (finding: Finding) => boolean) => calculateAuditReadinessV2(
    findings.map((finding) => predicate(finding) ? { ...finding, status: "resolved" as FindingStatus } : finding),
    validationChecks,
    uploads,
  );
  const open = findings.filter(isOpenFinding);
  const highRiskOpen = open.filter((finding) => finding.severity === "critical" || finding.severity === "high");
  const allResolved = simulated(isOpenFinding);
  const highResolved = simulated((finding) => isOpenFinding(finding) && (finding.severity === "critical" || finding.severity === "high"));
  const nextFinding = highRiskOpen[0] ?? open[0];
  const nextResolved = nextFinding ? simulated((finding) => finding.id === nextFinding.id) : current;
  const effortMinutes = open.reduce((sum, finding) => {
    const effort = finding.severity === "critical" ? 12 : finding.severity === "high" ? 9 : finding.severity === "medium" ? 6 : 3;
    return sum + effort;
  }, validationChecks.filter((check) => check.status === "failed").length * 5);

  return {
    current,
    nextFinding,
    nextResolved,
    highResolved,
    allResolved,
    effortMinutes,
    highRiskOpen: highRiskOpen.length,
    open: open.length,
  };
}

export type SignOffTrafficState = "green" | "amber" | "red";

export function signOffTrafficLight({
  signOffEnabled,
  signOffComplete,
  acceptedRiskCount,
  criticalOpen,
  highOpen,
  validationBlockers,
  evidenceOutstanding,
  managerReviewComplete,
}: {
  signOffEnabled: boolean;
  signOffComplete: boolean;
  acceptedRiskCount: number;
  criticalOpen: number;
  highOpen: number;
  validationBlockers: number;
  evidenceOutstanding: number;
  managerReviewComplete: boolean;
}) {
  if (signOffComplete) {
    return {
      label: acceptedRiskCount ? "Signed With Accepted Risks" : "Signed Off",
      state: (acceptedRiskCount ? "amber" : "green") as SignOffTrafficState,
      headline: acceptedRiskCount ? "Locked with accepted risks" : "Locked and clean",
      detail: acceptedRiskCount ? `${acceptedRiskCount} accepted risk(s) retained in the review pack.` : "No accepted risks recorded at sign-off.",
    };
  }

  if (signOffEnabled && acceptedRiskCount > 0) {
    return {
      label: "Ready With Accepted Risks",
      state: "amber" as SignOffTrafficState,
      headline: "Partner judgement required",
      detail: `${acceptedRiskCount} accepted risk(s) must remain visible in the sign-off certificate.`,
    };
  }

  if (signOffEnabled) {
    return {
      label: "Ready",
      state: "green" as SignOffTrafficState,
      headline: "Ready for sign-off",
      detail: "No critical/high findings, evidence requests, validation blockers or manager approvals remain.",
    };
  }

  const blockers = [
    criticalOpen ? `${criticalOpen} critical open` : "",
    highOpen ? `${highOpen} high open` : "",
    validationBlockers ? `${validationBlockers} validation blocker(s)` : "",
    evidenceOutstanding ? `${evidenceOutstanding} evidence request(s)` : "",
    !managerReviewComplete ? "manager review outstanding" : "",
  ].filter(Boolean);

  return {
    label: "Not Ready",
    state: "red" as SignOffTrafficState,
    headline: "Sign-off blocked",
    detail: blockers.length ? blockers.join(" · ") : "Sign-off gate conditions are not yet satisfied.",
  };
}

export function trafficLightClasses(state: SignOffTrafficState) {
  if (state === "green") return { box: "border-emerald-200 bg-emerald-50", text: "text-emerald-800", dot: "bg-emerald-600" };
  if (state === "amber") return { box: "border-amber-200 bg-amber-50", text: "text-amber-800", dot: "bg-amber-500" };
  return { box: "border-red-200 bg-red-50", text: "text-red-800", dot: "bg-red-600" };
}
