"use client";

import { useEffect, useState } from "react";
import { EvidenceDecisionTrace } from "@/components/evidence-decision-trace";
import { EvidenceRowsPreview } from "@/components/evidence-rows-preview";
import { DrawerField } from "@/components/finding-workflow-panels";
import { Pill } from "@/components/ui-primitives";
import { parseImpactAmount } from "@/lib/finance";
import { isOpenFinding } from "@/lib/finding-ledger";
import { FINDING_STATUS_CONFIG, findingActivityLabel, findingDetectionConfidence, findingDueDate, findingEvidenceReference, findingEvidenceStrengthScore, findingEvidenceTier, findingOwner, findingSeverityRank, findingTriggeredReason, managerReviewStatus } from "@/lib/finding-workflow";
import type { Evidence, EvidenceStatus, Finding, FindingActivity, FindingComment, FindingStatus, ManagerReviewStatus, PartnerSignOff } from "@/lib/types";

export function FindingDetailDrawer({
  finding,
  evidence,
  comments,
  activities,
  partnerSignOff,
  updateFindingStatus,
  updateFindingAssignment,
  updateManagerReview,
  addFindingComment,
  addFindingEvidence,
  updateEvidenceStatus,
  reviewLocked,
  onClose,
  responsive = false,
}: {
  finding: Finding;
  evidence: Evidence[];
  comments: FindingComment[];
  activities: FindingActivity[];
  partnerSignOff?: PartnerSignOff;
  updateFindingStatus: (findingId: string, status: FindingStatus, reason?: string) => void;
  updateFindingAssignment: (findingId: string, assignedTo: string, dueDate: string) => void;
  updateManagerReview: (findingId: string, status: ManagerReviewStatus, note?: string) => void;
  addFindingComment: (findingId: string, comment: string) => void;
  addFindingEvidence: (findingId: string, files: FileList | null, notes?: string) => Promise<void>;
  updateEvidenceStatus: (findingId: string, evidenceId: string, status: EvidenceStatus, note?: string) => void;
  reviewLocked: boolean;
  onClose: () => void;
  responsive?: boolean;
}) {
  const [note, setNote] = useState("");
  const [managerNote, setManagerNote] = useState("");
  const [comment, setComment] = useState("");
  const [assignee, setAssignee] = useState(finding.assignedTo ?? "");
  const [assignmentDueDate, setAssignmentDueDate] = useState(finding.dueDate ?? "");
  const [evidenceNotes, setEvidenceNotes] = useState("");
  const [isUploadingEvidence, setIsUploadingEvidence] = useState(false);
  const statusCfg = FINDING_STATUS_CONFIG[finding.status] ?? FINDING_STATUS_CONFIG.open;
  const confidencePct = findingDetectionConfidence(finding);
  const evidenceStrengthPct = findingEvidenceStrengthScore(finding, evidence.length);
  const primaryRow = finding.evidence.rows?.[0];
  const evidenceRef = findingEvidenceReference(finding);
  const impactAmount = finding.amount ?? parseImpactAmount(finding.expectedImpact);
  const sortedActivities = activities.slice().sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  const sortedComments = comments.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const managerStatus = managerReviewStatus(finding);
  const evidenceItemCount = evidence.length || finding.evidenceIds?.length || finding.evidence.rows?.length || 0;
  const formatDateTime = (value?: string) => value ? new Date(value).toLocaleString("en-GB") : "-";

  useEffect(() => {
    setAssignee(finding.assignedTo ?? "");
    setAssignmentDueDate(finding.dueDate ?? "");
  }, [finding.assignedTo, finding.dueDate, finding.id]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  const act = (status: FindingStatus, fallback = "") => {
    updateFindingStatus(finding.id, status, note || fallback);
    setNote("");
  };

  const submitComment = () => {
    addFindingComment(finding.id, comment);
    setComment("");
  };

  const managerAct = (status: ManagerReviewStatus) => {
    updateManagerReview(finding.id, status, managerNote);
    setManagerNote("");
  };

  const uploadEvidence = async (files: FileList | null) => {
    setIsUploadingEvidence(true);
    try {
      await addFindingEvidence(finding.id, files, evidenceNotes);
      setEvidenceNotes("");
    } finally {
      setIsUploadingEvidence(false);
    }
  };

  return (
    <div className={responsive ? "fixed inset-0 z-50 bg-slate-950/40 xl:sticky xl:top-6 xl:col-start-2 xl:row-span-3 xl:row-start-1 xl:z-auto xl:h-[calc(100vh-3rem)] xl:min-w-0 xl:bg-transparent" : "fixed inset-0 z-50 bg-slate-950/40"}>
      <aside className={`ml-auto flex h-full w-full max-w-[min(96vw,1536px)] flex-col overflow-hidden bg-white shadow-2xl ${responsive ? "xl:max-w-none xl:rounded-xl xl:border xl:border-line xl:shadow-panel" : ""}`} aria-label="Finding detail">
        <div className="border-b border-line p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Pill level={finding.severity}>{finding.severity}</Pill>
                <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${statusCfg.color}`}>{statusCfg.label}</span>
                {finding.ruleId && <span className="rounded-full bg-slate-100 px-2 py-0.5 font-mono text-xs text-slate-500">{finding.ruleId}</span>}
              </div>
              <h2 className="mt-3 text-xl font-black">{finding.title}</h2>
              <p className="mt-1 text-sm text-muted">{finding.description}</p>
            </div>
            <button autoFocus className="rounded-lg border border-line px-3 py-2 text-sm font-bold" onClick={onClose}>Close</button>
          </div>
        </div>

        <div className="grid min-w-0 flex-1 gap-4 overflow-y-auto p-5 xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.82fr)]">
          <EvidenceDecisionTrace finding={finding} partnerSignOff={partnerSignOff} />
          <div className="grid min-w-0 content-start gap-4">
            <section className="rounded-lg border border-line bg-slate-50 p-4">
              <p className="text-xs font-bold uppercase text-muted">Finding Details</p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <DrawerField label="Owner" value={findingOwner(finding)} />
                <DrawerField label="Reviewer" value={finding.reviewer || "-"} />
                <DrawerField label="Manager" value={finding.manager || finding.managerReviewedBy || "-"} />
                <DrawerField label="Partner" value={finding.partner || partnerSignOff?.signedBy || "-"} />
                <DrawerField label="Due Date" value={findingDueDate(finding)} />
                <DrawerField label="Status" value={statusCfg.label} />
                <DrawerField label="Category" value={finding.category.replaceAll("_", " ")} />
                <DrawerField label="Confidence In This Check" value={`${confidencePct}%`} />
                <DrawerField label="Quality Of Supporting Evidence" value={`${evidenceStrengthPct}% · ${findingEvidenceTier(finding)}`} />
                <DrawerField label="Risk Score" value={String(finding.riskScore ?? findingSeverityRank(finding.severity) * 25)} />
                <DrawerField label="Amount" value={impactAmount ? `£${Math.round(impactAmount).toLocaleString()}` : finding.expectedImpact || "-"} />
                <DrawerField label="Evidence Attached" value={evidenceItemCount ? "Yes" : "No"} />
                <DrawerField label="Reviewed At" value={formatDateTime(finding.reviewedAt)} />
                <DrawerField label="Resolved By" value={finding.resolvedBy || (!isOpenFinding(finding) ? finding.reviewer || "-" : "-")} />
                <DrawerField label="Resolved At" value={formatDateTime(finding.resolvedAt || (!isOpenFinding(finding) ? finding.reviewedAt : undefined))} />
                <DrawerField label="Approved By" value={finding.approvedBy || (managerStatus === "approved" ? finding.managerReviewedBy || "-" : "-")} />
                <DrawerField label="Approved At" value={formatDateTime(finding.approvedAt || (managerStatus === "approved" ? finding.managerReviewedAt : undefined))} />
                <DrawerField label="Manager Status" value={managerStatus.replaceAll("_", " ")} />
              </div>
              {finding.resolutionNote && (
                <div className="mt-3 rounded-lg border border-line bg-white p-3">
                  <p className="text-xs font-bold text-muted">Resolution Note</p>
                  <p className="mt-1 text-sm">{finding.resolutionNote}</p>
                </div>
              )}
              {finding.recommendation && (
                <div className="mt-3 rounded-lg border border-line bg-white p-3">
                  <p className="text-xs font-bold text-muted">Recommendation</p>
                  <p className="mt-1 text-sm">{finding.recommendation}</p>
                </div>
              )}
            </section>

            <section className="rounded-lg border border-line bg-white p-4">
              <p className="text-xs font-bold uppercase text-muted">Assignment</p>
              <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto]">
                <label className="grid gap-1">
                  <span className="text-xs font-bold text-muted">Owner</span>
                  <input className="h-10 rounded-lg border border-line px-3 text-sm" value={assignee} onChange={(event) => setAssignee(event.target.value)} placeholder="Reviewer name" />
                </label>
                <label className="grid gap-1">
                  <span className="text-xs font-bold text-muted">Due date</span>
                  <input aria-label="Assignment due date" className="h-10 rounded-lg border border-line px-3 text-sm" type="date" value={assignmentDueDate} onChange={(event) => setAssignmentDueDate(event.target.value)} />
                </label>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button className="rounded-lg bg-brand px-4 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300" disabled={reviewLocked} onClick={() => updateFindingAssignment(finding.id, assignee, assignmentDueDate)}>Save Assignment</button>
                <button className="rounded-lg border border-line bg-white px-4 py-2 text-sm font-bold disabled:cursor-not-allowed disabled:text-muted" disabled={reviewLocked} onClick={() => {
                  setAssignee("Me");
                  updateFindingAssignment(finding.id, "Me", assignmentDueDate);
                }}>Assign To Me</button>
                <button className="rounded-lg border border-line bg-white px-4 py-2 text-sm font-bold text-muted disabled:cursor-not-allowed" disabled={reviewLocked} onClick={() => {
                  setAssignee("");
                  setAssignmentDueDate("");
                  updateFindingAssignment(finding.id, "", "");
                }}>Clear</button>
              </div>
            </section>

            <section className="rounded-lg border border-line bg-white p-4">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-xs font-bold uppercase text-muted">Evidence Viewer</p>
                  <h3 className="mt-1 font-black">Supporting evidence and why this was flagged</h3>
                </div>
                <span className="rounded-full bg-cyan-50 px-3 py-1 text-xs font-bold text-cyan-800">{findingEvidenceTier(finding)} evidence</span>
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <DrawerField label="Source File" value={evidenceRef.sourceFile} />
                <DrawerField label="Sheet" value={primaryRow?.sheetName || "Default / extracted rows"} />
                <DrawerField label="Rows" value={evidenceRef.rowIndexes} />
                <DrawerField label="Source Row Count" value={String(evidenceRef.rowCount)} />
                <DrawerField label="Account / Party" value={evidenceRef.accountOrParty} />
                <DrawerField label="Period" value={finding.evidence.period || "-"} />
                <DrawerField label="Check Reference" value={finding.ruleId ?? finding.id} />
                <DrawerField label="Confidence In This Check" value={`${confidencePct}%`} />
                <DrawerField label="Quality Of Supporting Evidence" value={`${evidenceStrengthPct}%`} />
                <DrawerField label="Evidence Items" value={String(evidenceItemCount)} />
                <DrawerField label="Balance / Amount" value={typeof primaryRow?.amount === "number" ? `£${Math.round(primaryRow.amount).toLocaleString("en-GB")}` : impactAmount ? `£${Math.round(impactAmount).toLocaleString("en-GB")}` : "-"} />
              </div>
              <div className="mt-3 rounded-lg border border-line bg-slate-50 p-3">
                <p className="text-xs font-bold text-muted">Calculation</p>
                <p className="mt-1 text-sm">{evidenceRef.calculation}</p>
              </div>
              <div className="mt-3 rounded-lg border border-cyan-100 bg-cyan-50 p-3">
                <p className="text-xs font-bold uppercase text-cyan-900">Evidence Reference</p>
                <p className="mt-1 text-sm font-semibold text-cyan-950">{evidenceRef.sourceFile} · {evidenceRef.rowIndexes}</p>
                <p className="mt-1 text-xs text-cyan-900">{evidenceRef.rowCount} source row{evidenceRef.rowCount !== 1 ? "s" : ""} linked to {finding.ruleId ?? finding.id}.</p>
              </div>
              <div className="mt-3 rounded-lg border border-line bg-amber-50 p-3">
                <p className="text-xs font-bold uppercase text-amber-800">Why Triggered</p>
                <p className="mt-1 text-sm font-semibold text-amber-950">{findingTriggeredReason(finding)}</p>
                <p className="mt-2 text-xs text-amber-900">ClosePilot records the source file, row-level evidence and rule identifier so reviewers can inspect the exception without regenerating the analysis.</p>
              </div>
              {primaryRow ? (
                <div className="mt-3 rounded-lg border border-line bg-white p-3">
                  <p className="text-xs font-bold uppercase text-muted">Primary Source Row</p>
                  <div className="mt-2 grid gap-2 text-xs sm:grid-cols-2">
                    {Object.entries(primaryRow.sourceRow ?? {}).filter(([, value]) => String(value ?? "").trim()).slice(0, 10).map(([key, value]) => (
                      <div key={key} className="rounded-lg bg-slate-50 p-2">
                        <span className="block font-bold uppercase text-muted">{key}</span>
                        <span className="mt-1 block break-words font-semibold">{String(value)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
              <div className="mt-3 rounded-lg border border-line bg-slate-50 p-3">
                <p className="text-xs font-bold uppercase text-muted">Upload Evidence</p>
                <textarea className="mt-2 min-h-16 w-full rounded-lg border border-line bg-white px-3 py-2 text-sm" value={evidenceNotes} onChange={(event) => setEvidenceNotes(event.target.value)} placeholder="Optional evidence note." />
                <label className="mt-2 inline-flex cursor-pointer rounded-lg bg-brand px-4 py-2 text-sm font-bold text-white">
                  {isUploadingEvidence ? "Uploading..." : "Upload Evidence"}
                  <input className="hidden" type="file" multiple disabled={reviewLocked || isUploadingEvidence} onChange={(event) => uploadEvidence(event.target.files)} />
                </label>
              </div>
              {evidence.length > 0 && (
                <div className="mt-3 grid gap-2">
                  {evidence.map((item) => (
                    <div key={item.id} className="rounded-lg border border-line bg-white p-3 text-sm">
                      <div className="flex items-start justify-between gap-3">
                        <a className="min-w-0 transition-colors hover:text-brand" href={item.fileUrl || "#"} target={item.fileUrl ? "_blank" : undefined} rel="noreferrer">
                          <strong className="block truncate">{item.fileName}</strong>
                          <span className="mt-1 block text-xs text-muted">{item.uploadedBy} · {new Date(item.uploadedAt).toLocaleString("en-GB")}</span>
                        </a>
                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-bold ${item.status === "accepted" || item.status === "not_required" ? "bg-emerald-100 text-emerald-700" : item.status === "rejected" ? "bg-red-100 text-red-700" : item.status === "requested" ? "bg-amber-100 text-amber-800" : item.status === "under_review" ? "bg-cyan-100 text-cyan-800" : item.status === "superseded" ? "bg-slate-100 text-slate-700" : "bg-blue-100 text-blue-700"}`}>{(item.status ?? "uploaded").replaceAll("_", " ")}</span>
                      </div>
                      {item.notes && <p className="mt-2 text-xs text-muted">{item.notes}</p>}
                      {item.reviewNote && <p className="mt-1 text-xs text-muted">Review: {item.reviewNote}</p>}
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button className="rounded-lg border border-line bg-white px-3 py-1.5 text-xs font-bold disabled:cursor-not-allowed disabled:text-muted" disabled={reviewLocked || item.status === "requested" || item.status === "accepted" || item.status === "superseded" || item.status === "not_required"} onClick={() => updateEvidenceStatus(finding.id, item.id, "under_review", evidenceNotes)}>Under Review</button>
                        <button className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300" disabled={reviewLocked || item.status === "accepted" || item.status === "requested" || item.status === "superseded" || item.status === "not_required"} onClick={() => updateEvidenceStatus(finding.id, item.id, "accepted", evidenceNotes)}>Accept Evidence</button>
                        <button className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-bold text-red-700 disabled:cursor-not-allowed disabled:text-muted" disabled={reviewLocked || item.status === "rejected" || item.status === "requested" || item.status === "superseded" || item.status === "not_required"} onClick={() => updateEvidenceStatus(finding.id, item.id, "rejected", evidenceNotes)}>Reject Evidence</button>
                        <button className="rounded-lg border border-line bg-white px-3 py-1.5 text-xs font-bold disabled:cursor-not-allowed disabled:text-muted" disabled={reviewLocked || item.status === "accepted" || item.status === "superseded" || item.status === "not_required"} onClick={() => updateEvidenceStatus(finding.id, item.id, "superseded", evidenceNotes)}>Supersede</button>
                        <button className="rounded-lg border border-line bg-white px-3 py-1.5 text-xs font-bold disabled:cursor-not-allowed disabled:text-muted" disabled={reviewLocked || item.status === "not_required"} onClick={() => updateEvidenceStatus(finding.id, item.id, "not_required", evidenceNotes)}>Not Required</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <EvidenceRowsPreview finding={finding} compact />
            </section>

            <section className="rounded-lg border border-line bg-white p-4">
              <p className="text-xs font-bold uppercase text-muted">Reviewer Workflow</p>
              <label className="mt-3 block">
                <span className="mb-1 block text-xs font-bold text-muted">Action note</span>
                <textarea className="min-h-20 w-full rounded-lg border border-line px-3 py-2 text-sm" value={note} onChange={(event) => setNote(event.target.value)} />
              </label>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <button className="rounded-lg border border-line bg-white px-3 py-2 text-sm font-bold disabled:cursor-not-allowed disabled:text-muted" disabled={reviewLocked} onClick={() => act("under_review")}>Assign / Review</button>
                <button className="rounded-lg bg-amber-500 px-3 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300" disabled={reviewLocked} onClick={() => act("evidence_requested")}>Request Evidence</button>
                <button className="rounded-lg bg-cyan-600 px-3 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300" disabled={reviewLocked} onClick={() => act("evidence_received")}>Evidence Received</button>
                <button className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300" disabled={reviewLocked} onClick={() => act("resolved")}>Resolve</button>
                <button className="rounded-lg bg-green-700 px-3 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300" disabled={reviewLocked} onClick={() => act("approved")}>Approve</button>
                <button className="rounded-lg bg-red-600 px-3 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300" disabled={reviewLocked} onClick={() => act("false_positive")}>False Positive</button>
                <button className="rounded-lg bg-violet-600 px-3 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300" disabled={reviewLocked} onClick={() => act("accepted_risk")}>Accept Risk</button>
              </div>
            </section>

            <section className="rounded-lg border border-line bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-bold uppercase text-muted">Manager Review</p>
                  <p className="mt-1 text-sm font-semibold capitalize">{managerStatus.replaceAll("_", " ")}</p>
                </div>
                <Pill level={managerStatus === "approved" ? "low" : managerStatus === "returned" ? "high" : managerStatus === "escalated" ? "medium" : "medium"}>{managerStatus.replaceAll("_", " ")}</Pill>
              </div>
              {finding.managerReviewNote && (
                <div className="mt-3 rounded-lg border border-line bg-slate-50 p-3">
                  <p className="text-xs font-bold text-muted">Latest manager note</p>
                  <p className="mt-1 text-sm">{finding.managerReviewNote}</p>
                  {finding.managerReviewedBy && <p className="mt-1 text-xs text-muted">{finding.managerReviewedBy} · {finding.managerReviewedAt ? new Date(finding.managerReviewedAt).toLocaleString("en-GB") : ""}</p>}
                </div>
              )}
              <textarea className="mt-3 min-h-20 w-full rounded-lg border border-line px-3 py-2 text-sm" value={managerNote} onChange={(event) => setManagerNote(event.target.value)} placeholder="Manager approval, return reason, or escalation note." />
              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                <button className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300" disabled={reviewLocked} onClick={() => managerAct("approved")}>Approve</button>
                <button className="rounded-lg border border-line bg-white px-3 py-2 text-sm font-bold disabled:cursor-not-allowed disabled:text-muted" disabled={reviewLocked} onClick={() => managerAct("returned")}>Return</button>
                <button className="rounded-lg bg-slate-700 px-3 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300" disabled={reviewLocked} onClick={() => managerAct("escalated")}>Escalate</button>
              </div>
            </section>
          </div>

          <div className="grid min-w-0 content-start gap-4">
            <section className="rounded-lg border border-line bg-white p-4">
              <p className="text-xs font-bold uppercase text-muted">Comments</p>
              <textarea className="mt-3 min-h-24 w-full rounded-lg border border-line px-3 py-2 text-sm" value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Add manager note, client response, or evidence request context." />
              <button className="mt-2 rounded-lg bg-brand px-4 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300" disabled={reviewLocked} onClick={submitComment}>Add Comment</button>
              <div className="mt-4 grid gap-3">
                {sortedComments.length ? sortedComments.map((item) => (
                  <div key={item.id} className="rounded-lg border border-line bg-slate-50 p-3">
                    <p className="text-sm">{item.comment}</p>
                    <p className="mt-2 text-xs text-muted">{item.userId} · {new Date(item.createdAt).toLocaleString("en-GB")}</p>
                  </div>
                )) : <p className="text-sm text-muted">No comments yet.</p>}
              </div>
            </section>

            <section className="rounded-lg border border-line bg-white p-4">
              <p className="text-xs font-bold uppercase text-muted">Activity</p>
              <div className="mt-3 grid gap-3">
                {sortedActivities.length ? sortedActivities.map((item) => (
                  <div key={item.id} className="border-l-2 border-brand pl-3">
                    <strong className="block text-sm">{findingActivityLabel(item.action)}</strong>
                    {item.details && <p className="mt-1 text-xs text-muted">{item.details}</p>}
                    <p className="mt-1 text-xs text-muted">{item.userId} · {new Date(item.timestamp).toLocaleString("en-GB")}</p>
                  </div>
                )) : <p className="text-sm text-muted">No activity recorded yet.</p>}
              </div>
            </section>
          </div>
        </div>
      </aside>
    </div>
  );
}
