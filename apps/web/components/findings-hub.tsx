"use client";

import { useEffect, useState } from "react";
import { FindingDetailDrawer } from "@/components/finding-detail-drawer";
import { FindingList } from "@/components/finding-cards";
import { FindingsInsightsPanel } from "@/components/findings-insights-panel";
import { FindingRegister } from "@/components/finding-workflow-panels";
import { ForecastLine, SummaryItem } from "@/components/review-metrics";
import { EmptyState, Panel } from "@/components/ui-primitives";
import { calculateAuditReadinessV2 } from "@/lib/finance";
import { isOpenFinding, lifecycleStatus, type LifecycleStatus } from "@/lib/finding-ledger";
import { readinessForecast, signOffTrafficLight, trafficLightClasses } from "@/lib/finding-readiness";
import { FINDING_LIFECYCLE_LABELS, FINDING_STATUS_CONFIG, findingLifecycleCounts, findingOwner, isReadyForManagerReview, lifecycleStatuses, managerReviewStatus, reviewedFindingStatuses } from "@/lib/finding-workflow";
import type { Evidence, EvidenceStatus, Finding, FindingActivity, FindingComment, FindingStatus, ManagerReviewStatus, PartnerSignOff, PartnerSignOffGateSnapshot, Upload, ValidationCheck } from "@/lib/types";

export function FindingsHub({ findings, findingEvidence, findingComments, findingActivities, partnerSignOff, reviewLocked, pilotWalkthroughStep, focusedFindingId, clearFocusedFinding, validationChecks, uploads, updateFindingStatus, updateFindingAssignment, updateManagerReview, recordPartnerSignOff, addFindingComment, addFindingEvidence, updateEvidenceStatus, onCreateNewReviewCycle, setActive }: {
  findings: Finding[];
  findingEvidence: Evidence[];
  findingComments: FindingComment[];
  findingActivities: FindingActivity[];
  partnerSignOff?: PartnerSignOff;
  reviewLocked: boolean;
  pilotWalkthroughStep?: number;
  focusedFindingId: string | null;
  clearFocusedFinding: () => void;
  validationChecks: ValidationCheck[];
  uploads: Upload[];
  updateFindingStatus: (findingId: string, status: FindingStatus, reason?: string) => void;
  updateFindingAssignment: (findingId: string, assignedTo: string, dueDate: string) => void;
  updateManagerReview: (findingId: string, status: ManagerReviewStatus, note?: string) => void;
  recordPartnerSignOff: (gateSnapshot: PartnerSignOffGateSnapshot, note?: string) => void;
  addFindingComment: (findingId: string, comment: string) => void;
  addFindingEvidence: (findingId: string, files: FileList | null, notes?: string) => Promise<void>;
  updateEvidenceStatus: (findingId: string, evidenceId: string, status: EvidenceStatus, note?: string) => void;
  onCreateNewReviewCycle: () => void;
  setActive: (value: string) => void;
}) {
  const [statusFilter, setStatusFilter] = useState<LifecycleStatus | "all">("all");
  const [ownerFilter, setOwnerFilter] = useState("all");
  const [selectedFindingId, setSelectedFindingId] = useState<string | null>(null);
  const [selectedFindingIds, setSelectedFindingIds] = useState<string[]>([]);
  const [bulkOwner, setBulkOwner] = useState("");
  const [bulkDueDate, setBulkDueDate] = useState("");
  const [partnerNote, setPartnerNote] = useState("");
  const counts = findingLifecycleCounts(findings);
  const readiness = calculateAuditReadinessV2(findings, validationChecks, uploads);
  const readyForManager = findings.filter(isReadyForManagerReview);
  const managerApproved = findings.filter((finding) => managerReviewStatus(finding) === "approved").length;
  const managerReturned = findings.filter((finding) => managerReviewStatus(finding) === "returned").length;
  const managerEscalated = findings.filter((finding) => managerReviewStatus(finding) === "escalated").length;
  const managerReviewComplete = uploads.length > 0 && findings.length > 0 && readyForManager.length > 0 && readyForManager.every((finding) => managerReviewStatus(finding) === "approved" || managerReviewStatus(finding) === "escalated");
  const validationBlockers = validationChecks.filter((check) => check.status === "failed").length;
  const criticalOpen = findings.filter((finding) => isOpenFinding(finding) && finding.severity === "critical").length;
  const highOpen = findings.filter((finding) => isOpenFinding(finding) && finding.severity === "high").length;
  const mediumOpen = findings.filter((finding) => isOpenFinding(finding) && finding.severity === "medium").length;
  const openEvidenceItems = findingEvidence.filter((item) => ["requested", "uploaded", "under_review", "rejected"].includes(item.status ?? "uploaded"));
  const evidenceOutstanding = findings.filter((finding) => ["evidence_requested", "needs_investigation"].includes(finding.status)).length + openEvidenceItems.length;
  const importGateBlockers = uploads.filter((upload) => upload.importGateStatus && upload.importGateStatus !== "ready").length;
  const forecastReadiness = readinessForecast(findings, validationChecks, uploads);
  const hasEvidenceCoverage = (finding: Finding) => Boolean(finding.evidenceAttached || finding.evidenceIds?.length || finding.evidence?.rows?.length || findingEvidence.some((item) => item.findingId === finding.id));
  const percentOfFindings = (count: number) => findings.length ? Math.round((count / findings.length) * 100) : 0;
  const reviewedPercent = percentOfFindings(findings.filter((finding) => reviewedFindingStatuses.includes(finding.status) || Boolean(finding.reviewedAt)).length);
  const resolvedPercent = percentOfFindings(findings.filter((finding) => !isOpenFinding(finding)).length);
  const evidenceCoveragePercent = percentOfFindings(findings.filter(hasEvidenceCoverage).length);
  const managerApprovedPercent = percentOfFindings(managerApproved);
  const workflowCoverage = findings.length ? Math.round((reviewedPercent + resolvedPercent + evidenceCoveragePercent + managerApprovedPercent) / 4) : 0;
  const workflowCoverageReady = workflowCoverage >= 80;
  const signOffEnabled = criticalOpen === 0 && highOpen === 0 && validationBlockers === 0 && evidenceOutstanding === 0 && managerReviewComplete && readiness > 70 && workflowCoverageReady && importGateBlockers === 0;
  const acceptedRiskCount = findings.filter((finding) => finding.status === "accepted_risk").length;
  const signOffSnapshot: PartnerSignOffGateSnapshot = {
    criticalOpen,
    highOpen,
    mediumOpen,
    evidenceOutstanding,
    validationBlockers,
    managerReviewComplete,
    readiness,
    findingCount: findings.length,
    uploadCount: uploads.length,
  };
  const signOffComplete = partnerSignOff?.status === "locked" || partnerSignOff?.status === "signed";
  const traffic = signOffTrafficLight({ signOffEnabled, signOffComplete: Boolean(signOffComplete), acceptedRiskCount, criticalOpen, highOpen, validationBlockers, evidenceOutstanding, managerReviewComplete });
  const trafficClasses = trafficLightClasses(traffic.state);
  const owners = Array.from(new Set(findings.map(findingOwner))).sort((a, b) => a.localeCompare(b));
  const visibleFindings = (statusFilter === "all" ? findings : findings.filter((finding) => lifecycleStatus(finding.status) === statusFilter))
    .filter((finding) => ownerFilter === "all" || findingOwner(finding) === ownerFilter);
  const evidenceQueue = findings.filter((finding) => ["evidence_requested", "needs_investigation", "evidence_received"].includes(finding.status));
  const selectedFinding = findings.find((finding) => finding.id === selectedFindingId);
  const selectedVisibleCount = visibleFindings.filter((finding) => selectedFindingIds.includes(finding.id)).length;
  const allVisibleSelected = visibleFindings.length > 0 && selectedVisibleCount === visibleFindings.length;
  const applyBulkStatus = (status: FindingStatus) => {
    selectedFindingIds.forEach((findingId) => updateFindingStatus(findingId, status));
    setSelectedFindingIds([]);
  };
  const applyBulkAssignment = () => {
    selectedFindingIds.forEach((findingId) => updateFindingAssignment(findingId, bulkOwner, bulkDueDate));
    setSelectedFindingIds([]);
    setBulkOwner("");
    setBulkDueDate("");
  };
  const toggleFindingSelection = (findingId: string) => {
    setSelectedFindingIds((ids) => ids.includes(findingId) ? ids.filter((id) => id !== findingId) : [...ids, findingId]);
  };
  const toggleAllVisibleFindings = () => {
    setSelectedFindingIds((ids) => {
      const visibleIds = visibleFindings.map((finding) => finding.id);
      if (visibleIds.every((id) => ids.includes(id))) {
        return ids.filter((id) => !visibleIds.includes(id));
      }
      return Array.from(new Set([...ids, ...visibleIds]));
    });
  };

  useEffect(() => {
    if (pilotWalkthroughStep === undefined) return;
    const targetId =
      pilotWalkthroughStep === 1 ? "find_pilot_vat_001"
        : pilotWalkthroughStep === 2 ? "find_pilot_ar_001"
          : pilotWalkthroughStep === 3 ? "find_pilot_close_001"
            : null;
    if (targetId && findings.some((finding) => finding.id === targetId)) {
      setSelectedFindingId(targetId);
    }
    if (pilotWalkthroughStep === 0) {
      setSelectedFindingId(null);
      setStatusFilter("all");
    }
  }, [findings, pilotWalkthroughStep]);

  useEffect(() => {
    if (!focusedFindingId) return;
    if (findings.some((finding) => finding.id === focusedFindingId)) {
      setSelectedFindingId(focusedFindingId);
      clearFocusedFinding();
    }
  }, [clearFocusedFinding, findings, focusedFindingId]);

  return (
    <div className="grid gap-4">
      <FindingsInsightsPanel findings={findings} />
      {reviewLocked && (
        <section className="flex flex-col gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-bold uppercase text-emerald-800">Review Pack Locked</p>
            <p className="mt-1 text-sm font-semibold text-emerald-900">Partner sign-off is complete. Workflow edits are disabled; the review pack can still be exported.</p>
          </div>
          <button className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-bold text-white" onClick={onCreateNewReviewCycle}>Create New Review Cycle</button>
        </section>
      )}
      <section className="rounded-lg border border-line bg-white p-5 shadow-panel">
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
          <div>
            <p className="text-xs font-bold uppercase text-muted">Finding Lifecycle</p>
            <h2 className="mt-1 text-2xl font-black">Review, evidence, approval and sign-off</h2>
            <p className="mt-1 text-sm text-muted">{findings.length ? `${findings.length} finding(s) tracked through the review workflow.` : "Upload a finance pack to create the first review queue."}</p>
          </div>
          <button className="rounded-lg bg-brand px-4 py-2.5 text-sm font-bold text-white" onClick={() => setActive(uploads.length ? "Review Pack" : "Upload Finance Pack")}>
            {uploads.length ? "Open Review Pack" : "Import Accounts"}
          </button>
        </div>
        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-left text-sm">
            <thead className="text-xs uppercase text-muted">
              <tr>
                <th className="border-b border-line p-2">Status</th>
                <th className="border-b border-line p-2 text-right">Count</th>
              </tr>
            </thead>
            <tbody>
              {lifecycleStatuses.map((status) => (
                <tr key={status} className={`cursor-pointer ${statusFilter === status ? "bg-cyan-50" : "hover:bg-slate-50"}`} onClick={() => setStatusFilter(status)}>
                  <td className="border-b border-line p-2 font-bold">{FINDING_LIFECYCLE_LABELS[status]}</td>
                  <td className="border-b border-line p-2 text-right text-lg font-black">{counts[status]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <SummaryItem label="Reviewed" value={`${reviewedPercent}%`} detail="findings touched" level={reviewedPercent >= 80 ? "low" : "medium"} />
          <SummaryItem label="Resolved" value={`${resolvedPercent}%`} detail="closed or approved" level={resolvedPercent >= 70 ? "low" : "medium"} />
          <SummaryItem label="Evidence Coverage" value={`${evidenceCoveragePercent}%`} detail="support linked" level={evidenceCoveragePercent >= 75 ? "low" : "high"} />
          <SummaryItem label="Manager Approved" value={`${managerApprovedPercent}%`} detail={`${managerApproved} approved`} level={managerApprovedPercent >= 70 ? "low" : "medium"} />
          <SummaryItem label="Review Completion" value={`${workflowCoverage}%`} detail="findings, evidence and decisions" level={workflowCoverageReady ? "low" : "high"} />
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
        <Panel title="Partner View">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <SummaryItem label="Critical Open" value={String(criticalOpen)} detail="must be zero" level={criticalOpen ? "critical" : "low"} />
            <SummaryItem label="High Open" value={String(highOpen)} detail="manager review" level={highOpen ? "high" : "low"} />
            <SummaryItem label="Medium Open" value={String(mediumOpen)} detail="review queue" level={mediumOpen ? "medium" : "low"} />
            <SummaryItem label="Evidence Outstanding" value={String(evidenceOutstanding)} detail="requests to close" level={evidenceOutstanding ? "high" : "low"} />
            <SummaryItem label="Workflow" value={`${workflowCoverage}%`} detail="threshold 80%" level={workflowCoverageReady ? "low" : "high"} />
          </div>
          <div className={`mt-4 rounded-lg border p-4 ${trafficClasses.box}`}>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xs font-bold uppercase text-muted">Partner Sign-Off Status</p>
                <strong className={`mt-1 block text-2xl ${trafficClasses.text}`}>{traffic.label}</strong>
                <p className="mt-1 text-sm font-semibold text-muted">{traffic.detail}</p>
              </div>
              <div className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-full ${trafficClasses.dot} text-sm font-bold text-white`}>
                {traffic.state === "green" ? "READY" : traffic.state === "amber" ? "RISK" : "STOP"}
              </div>
            </div>
            {partnerSignOff ? (
              <p className="mt-1 text-sm font-semibold text-emerald-800">
                Signed by {partnerSignOff.signedBy} on {new Date(partnerSignOff.signedAt).toLocaleString("en-GB")}.
              </p>
            ) : null}
          </div>
          <div className="mt-4 rounded-lg border border-line bg-slate-50 p-4">
            <p className="text-xs font-bold uppercase text-muted">Readiness Forecast</p>
            <div className="mt-3 grid gap-2">
              <ForecastLine label={forecastReadiness.nextFinding ? `Next: ${forecastReadiness.nextFinding.title}` : "Next finding"} from={forecastReadiness.current} to={forecastReadiness.nextResolved} />
              <ForecastLine label="All high-risk findings" from={forecastReadiness.current} to={forecastReadiness.highResolved} />
              <ForecastLine label="All open findings" from={forecastReadiness.current} to={forecastReadiness.allResolved} />
            </div>
            <p className="mt-3 text-xs font-semibold text-muted">Estimated review effort: {forecastReadiness.effortMinutes} mins.</p>
          </div>
        </Panel>

        <Panel title="Partner Sign-Off Gate">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <SignOffCheck label="Critical Findings" passed={criticalOpen === 0} detail={criticalOpen ? `${criticalOpen} critical open` : "No critical findings open"} />
            <SignOffCheck label="High Findings" passed={highOpen === 0} detail={highOpen ? `${highOpen} high open` : "No high findings open"} />
            <SignOffCheck label="Validation Blockers" passed={validationBlockers === 0} detail={validationBlockers ? `${validationBlockers} blocker(s)` : "No failed checks"} />
            <SignOffCheck label="Evidence Requests" passed={evidenceOutstanding === 0} detail={evidenceOutstanding ? `${evidenceOutstanding} outstanding` : "All evidence requests closed"} />
            <SignOffCheck label="Manager Review" passed={managerReviewComplete} detail={managerReviewComplete ? "Review complete" : "Manager review open"} />
            <SignOffCheck label="Accepted Risks" passed={acceptedRiskCount === 0} warning={acceptedRiskCount > 0} detail={acceptedRiskCount ? `${acceptedRiskCount} partner-visible risk(s)` : "No accepted risks"} />
            <SignOffCheck label="Readiness" passed={readiness > 70} detail={`${readiness}%`} />
            <SignOffCheck label="Review Completion" passed={workflowCoverageReady} detail={`${workflowCoverage}%`} />
            <SignOffCheck label="File Checks" passed={importGateBlockers === 0} detail={importGateBlockers ? `${importGateBlockers} upload(s) need mapping` : "Files checked"} />
          </div>
          <div className={`mt-4 rounded-lg border p-4 ${trafficClasses.box}`}>
            <p className="text-xs font-bold uppercase text-muted">Partner Sign-Off</p>
            <strong className={`mt-1 block text-2xl ${trafficClasses.text}`}>{traffic.headline}</strong>
            <p className="mt-1 text-sm font-semibold text-muted">{traffic.detail}</p>
            {partnerSignOff ? (
              <div className="mt-3 rounded-lg border border-emerald-200 bg-white p-3 text-sm">
                <p className="font-bold">Partner conclusion recorded</p>
                <p className="mt-1 text-muted">Readiness {partnerSignOff.gateSnapshot.readiness}% · {partnerSignOff.gateSnapshot.findingCount} finding(s) · {partnerSignOff.gateSnapshot.uploadCount} upload(s)</p>
                {partnerSignOff.note ? <p className="mt-2 text-muted">{partnerSignOff.note}</p> : null}
              </div>
            ) : (
              <div className="mt-3 grid gap-3">
                <textarea
                  className="min-h-24 rounded-lg border border-line p-3 text-sm"
                  placeholder="Partner conclusion note"
                  value={partnerNote}
                  onChange={(event) => setPartnerNote(event.target.value)}
                />
                <button
                  className={`rounded-lg px-4 py-2.5 text-sm font-bold ${signOffEnabled ? "bg-emerald-600 text-white" : "cursor-not-allowed bg-slate-200 text-muted"}`}
                  disabled={!signOffEnabled}
                  onClick={() => {
                    recordPartnerSignOff(signOffSnapshot, partnerNote);
                    setPartnerNote("");
                  }}
                >
                  Sign Off Review Pack
                </button>
              </div>
            )}
          </div>
        </Panel>

      </section>

      <section className="grid gap-4 xl:grid-cols-[1fr_0.86fr]">
        <Panel title="Manager Review Queue">
          <div className="mb-4 grid gap-3 sm:grid-cols-4">
            <SummaryItem label="Ready" value={String(readyForManager.length)} detail="awaiting manager decision" level={readyForManager.length ? "medium" : "low"} />
            <SummaryItem label="Approved" value={String(managerApproved)} detail="manager signed" level="low" />
            <SummaryItem label="Returned" value={String(managerReturned)} detail="back to reviewer" level={managerReturned ? "high" : "low"} />
            <SummaryItem label="Escalated" value={String(managerEscalated)} detail="partner attention" level={managerEscalated ? "medium" : "low"} />
          </div>
          <div className="grid gap-3">
            {readyForManager.slice(0, 5).map((finding) => {
              const reviewStatus = managerReviewStatus(finding);
              return (
                <div key={finding.id} className="rounded-lg border border-line bg-slate-50 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <strong className="block truncate text-sm">{finding.title}</strong>
                      <p className="mt-1 text-xs text-muted">{findingOwner(finding)} · {FINDING_STATUS_CONFIG[finding.status]?.label ?? finding.status}</p>
                    </div>
                    <span className="shrink-0 rounded-full bg-white px-2 py-0.5 text-xs font-bold text-slate-600">{reviewStatus.replaceAll("_", " ")}</span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300" disabled={reviewLocked} onClick={() => updateManagerReview(finding.id, "approved")}>Manager Approve</button>
                    <button className="rounded-lg border border-line bg-white px-3 py-1.5 text-xs font-bold disabled:cursor-not-allowed disabled:text-muted" disabled={reviewLocked} onClick={() => updateManagerReview(finding.id, "returned")}>Return</button>
                    <button className="rounded-lg bg-slate-700 px-3 py-1.5 text-xs font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300" disabled={reviewLocked} onClick={() => updateManagerReview(finding.id, "escalated")}>Escalate</button>
                  </div>
                </div>
              );
            })}
            {!readyForManager.length && <EmptyState title="No manager review queue" detail="Resolve, accept risk, false-positive, or receive evidence before manager review." />}
          </div>
        </Panel>

        <Panel title="Finding Register">
          <div className="mb-3 flex flex-wrap gap-2">
            <select aria-label="Filter findings by owner" className="h-10 rounded-lg border border-line bg-white px-3 text-sm font-bold" value={ownerFilter} onChange={(event) => setOwnerFilter(event.target.value)}>
              <option value="all">All Owners</option>
              {owners.map((owner) => <option key={owner} value={owner}>{owner}</option>)}
            </select>
            <button className={`rounded-lg px-3 py-2 text-sm font-bold ${statusFilter === "all" ? "bg-brand text-white" : "border border-line bg-white"}`} onClick={() => setStatusFilter("all")}>All Findings</button>
            {lifecycleStatuses.map((status) => (
              <button key={status} className={`rounded-lg px-3 py-2 text-sm font-bold ${statusFilter === status ? "bg-brand text-white" : "border border-line bg-white"}`} onClick={() => setStatusFilter(status)}>
                {FINDING_LIFECYCLE_LABELS[status]}
              </button>
            ))}
          </div>
          <div className="mb-3 grid gap-2 rounded-lg border border-line bg-slate-50 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <button className="rounded-lg border border-line bg-white px-3 py-2 text-sm font-bold" onClick={toggleAllVisibleFindings}>
                {allVisibleSelected ? "Clear Visible" : "Select Visible"} ({selectedVisibleCount})
              </button>
              <input className="h-10 min-w-44 rounded-lg border border-line bg-white px-3 text-sm" value={bulkOwner} onChange={(event) => setBulkOwner(event.target.value)} placeholder="Owner" />
              <input aria-label="Bulk due date" className="h-10 rounded-lg border border-line bg-white px-3 text-sm" type="date" value={bulkDueDate} onChange={(event) => setBulkDueDate(event.target.value)} />
              <button className="rounded-lg bg-brand px-3 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300" disabled={reviewLocked || !selectedFindingIds.length} onClick={applyBulkAssignment}>Assign Owner</button>
            </div>
            <div className="flex flex-wrap gap-2">
              <button className="rounded-lg border border-line bg-white px-3 py-2 text-sm font-bold disabled:cursor-not-allowed disabled:text-muted" disabled={reviewLocked || !selectedFindingIds.length} onClick={() => applyBulkStatus("evidence_requested")}>Request Evidence</button>
              <button className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300" disabled={reviewLocked || !selectedFindingIds.length} onClick={() => applyBulkStatus("resolved")}>Mark Resolved</button>
              <button className="rounded-lg bg-green-700 px-3 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300" disabled={reviewLocked || !selectedFindingIds.length} onClick={() => applyBulkStatus("approved")}>Approve</button>
            </div>
          </div>
          <FindingRegister findings={visibleFindings} onSelect={setSelectedFindingId} selectedIds={selectedFindingIds} onToggleSelected={toggleFindingSelection} />
        </Panel>

        <Panel title="Evidence Management">
          <div className="grid gap-3">
            {evidenceQueue.length ? evidenceQueue.slice(0, 5).map((finding) => (
              <div key={finding.id} className="rounded-lg border border-line bg-slate-50 p-3">
                {(() => {
                  const linkedEvidence = findingEvidence.filter((item) => item.findingId === finding.id);
                  const actionableEvidence = linkedEvidence.find((item) => item.status === "uploaded" || item.status === "under_review" || !item.status) ?? linkedEvidence.find((item) => item.status === "rejected" || item.status === "requested");
                  return (
                    <>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <strong className="block truncate text-sm">{finding.title}</strong>
                    <p className="mt-1 text-xs text-muted">{linkedEvidence.length || finding.evidenceIds?.length ? `${linkedEvidence.length || finding.evidenceIds?.length} evidence item(s) linked · ${linkedEvidence.filter((item) => item.status === "accepted").length} accepted · ${linkedEvidence.filter((item) => item.status === "rejected").length} rejected · ${linkedEvidence.filter((item) => item.status === "superseded").length} superseded` : finding.evidence.sourceFile}</p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-bold ${FINDING_STATUS_CONFIG[finding.status]?.color ?? FINDING_STATUS_CONFIG.open.color}`}>{FINDING_STATUS_CONFIG[finding.status]?.label ?? "Open"}</span>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button className="rounded-lg border border-line bg-white px-3 py-1.5 text-xs font-bold disabled:cursor-not-allowed disabled:text-muted" disabled={reviewLocked} onClick={() => updateFindingStatus(finding.id, "evidence_requested")}>Request Evidence</button>
                  <button className="rounded-lg border border-line bg-white px-3 py-1.5 text-xs font-bold disabled:cursor-not-allowed disabled:text-muted" disabled={reviewLocked} onClick={() => updateFindingStatus(finding.id, "evidence_received")}>Evidence Received</button>
                  <button className="rounded-lg border border-line bg-white px-3 py-1.5 text-xs font-bold disabled:cursor-not-allowed disabled:text-muted" disabled={reviewLocked || !actionableEvidence || actionableEvidence.status === "requested"} onClick={() => actionableEvidence ? updateEvidenceStatus(finding.id, actionableEvidence.id, "under_review") : undefined}>Review Evidence</button>
                  <button className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300" disabled={reviewLocked || !actionableEvidence || actionableEvidence.status === "rejected" || actionableEvidence.status === "requested"} onClick={() => actionableEvidence ? updateEvidenceStatus(finding.id, actionableEvidence.id, "accepted") : undefined}>Accept Evidence</button>
                  <button className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-bold text-red-700 disabled:cursor-not-allowed disabled:text-muted" disabled={reviewLocked || !actionableEvidence || actionableEvidence.status === "requested"} onClick={() => actionableEvidence ? updateEvidenceStatus(finding.id, actionableEvidence.id, "rejected") : undefined}>Reject Evidence</button>
                </div>
                    </>
                  );
                })()}
              </div>
            )) : (
              <EmptyState title="No evidence requests" detail="Request evidence from any finding that needs support before approval." />
            )}
          </div>
        </Panel>
      </section>

      <Panel title="Finding Detail Queue">
        <div className="mb-3 flex flex-wrap gap-2">
          <button className={`rounded-lg px-3 py-2 text-sm font-bold ${statusFilter === "all" ? "bg-brand text-white" : "border border-line bg-white"}`} onClick={() => setStatusFilter("all")}>All Findings</button>
          {lifecycleStatuses.map((status) => (
            <button key={status} className={`rounded-lg px-3 py-2 text-sm font-bold ${statusFilter === status ? "bg-brand text-white" : "border border-line bg-white"}`} onClick={() => setStatusFilter(status)}>
              {FINDING_LIFECYCLE_LABELS[status]}
            </button>
          ))}
        </div>
        <FindingList findings={visibleFindings} setActive={setActive} updateFindingStatus={updateFindingStatus} />
      </Panel>
      {selectedFinding && (
        <FindingDetailDrawer
          finding={selectedFinding}
          evidence={findingEvidence.filter((evidence) => evidence.findingId === selectedFinding.id)}
          comments={findingComments.filter((comment) => comment.findingId === selectedFinding.id)}
          activities={findingActivities.filter((activity) => activity.findingId === selectedFinding.id)}
          partnerSignOff={partnerSignOff}
          updateFindingStatus={updateFindingStatus}
          updateFindingAssignment={updateFindingAssignment}
          updateManagerReview={updateManagerReview}
          addFindingComment={addFindingComment}
          addFindingEvidence={addFindingEvidence}
          updateEvidenceStatus={updateEvidenceStatus}
          reviewLocked={reviewLocked}
          onClose={() => setSelectedFindingId(null)}
        />
      )}
    </div>
  );
}

function SignOffCheck({ label, passed, warning = false, detail }: { label: string; passed: boolean; warning?: boolean; detail: string }) {
  const state = warning ? "amber" : passed ? "green" : "red";
  const classes = trafficLightClasses(state);
  return (
    <div className={`rounded-lg border p-4 ${classes.box}`}>
      <span className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-sm font-bold ${classes.dot} text-white`}>{warning ? "!" : passed ? "✓" : "✕"}</span>
      <strong className="mt-3 block">{label}</strong>
      <p className="mt-1 text-xs text-muted">{detail}</p>
    </div>
  );
}
