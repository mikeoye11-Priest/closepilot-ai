"use client";

import { useState } from "react";
import { EvidenceRowsPreview } from "@/components/evidence-rows-preview";
import { EmptyState, Pill } from "@/components/ui-primitives";
import { isOpenFinding } from "@/lib/finding-ledger";
import { findingStandardReference } from "@/lib/finding-standards";
import { FINDING_STATUS_CONFIG, findingDetectionConfidence, findingEvidenceStrengthScore, reviewedFindingStatuses } from "@/lib/finding-workflow";
import type { Finding, FindingStatus, RiskLevel } from "@/lib/types";

export function FindingCard({ finding, setActive, updateFindingStatus, expanded = false }: { finding: Finding; setActive: (v: string) => void; updateFindingStatus?: (id: string, status: FindingStatus, reason?: string) => void; expanded?: boolean }) {
  const [open, setOpen] = useState(expanded);
  const [reviewReason, setReviewReason] = useState("");
  const standard = findingStandardReference(finding);
  const [aiExplanation, setAiExplanation] = useState("");
  const [aiStatus, setAiStatus] = useState<"idle" | "loading" | "done" | "unavailable" | "error">("idle");
  const explainFinding = async () => {
    setAiStatus("loading");
    try {
      const response = await fetch("/api/finding-explanation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: finding.title, description: finding.description, severity: finding.severity, category: finding.category, expectedImpact: finding.expectedImpact, recommendation: finding.recommendation, standard: standard?.label, evidence: finding.evidence?.calculation }),
      });
      const data = await response.json();
      if (!response.ok) { setAiStatus(/gemini/i.test(String(data.error ?? "")) ? "unavailable" : "error"); return; }
      setAiExplanation(String(data.explanation ?? "")); setAiStatus("done");
    } catch { setAiStatus("error"); }
  };
  const statusCfg = FINDING_STATUS_CONFIG[finding.status] ?? FINDING_STATUS_CONFIG.open;
  const confidencePct = findingDetectionConfidence(finding);
  const evidenceStrengthPct = findingEvidenceStrengthScore(finding);
  const severityBorder = finding.evidenceStrength === "advisory" ? "border-l-slate-300" : finding.severity === "critical" ? "border-l-red" : finding.severity === "high" ? "border-l-amber" : "border-l-line";
  const strengthLabel: Record<string, { label: string; color: string }> = {
    deterministic: { label: "Assurance Finding", color: "bg-emerald-100 text-emerald-800" },
    indicator:     { label: "Control Indicator", color: "bg-blue-100 text-blue-800" },
    advisory:      { label: "Compliance Reminder", color: "bg-slate-100 text-slate-600" },
  };
  const strength = strengthLabel[finding.evidenceStrength ?? "indicator"];
  const isDecided = !isOpenFinding(finding);

  return (
    <article className={`rounded-lg border border-l-4 border-line bg-white shadow-sm ${severityBorder} ${isDecided ? "opacity-75" : ""}`}>
      {/* Header */}
      <div className="flex cursor-pointer items-start gap-3 p-4" onClick={() => setOpen((v) => !v)}>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Pill level={finding.severity}>{finding.severity}</Pill>
            <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${statusCfg.color}`}>{statusCfg.label}</span>
            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${strength.color}`}>{strength.label}</span>
            {finding.ruleId && <span className="rounded-full bg-slate-100 px-2 py-0.5 font-mono text-xs text-slate-500">{finding.ruleId}</span>}
          </div>
          <h3 className="mt-2 font-bold leading-snug">{finding.title}</h3>
          <p className="mt-1 text-sm text-muted line-clamp-2">{finding.description}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5 text-right">
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted">Detection</span>
            <span className={`text-sm font-bold ${confidencePct >= 90 ? "text-emerald-700" : confidencePct >= 70 ? "text-amber-700" : "text-red-600"}`}>{confidencePct}%</span>
          </div>
          <span className="text-xs font-semibold text-muted">Evidence {evidenceStrengthPct}%</span>
          {finding.expectedImpact && <span className="text-xs font-semibold text-muted">{finding.expectedImpact}</span>}
          <span className="text-xs text-muted">{open ? "▲ Hide" : "▼ Details"}</span>
        </div>
      </div>

      {/* Expanded: evidence + HITL buttons */}
      {open && (
        <div className="border-t border-line px-4 pb-4 pt-3">
          {/* So what — why this matters and what to do */}
          <div className="mb-3 rounded-lg border border-brand/20 bg-brand/5 p-4">
            <p className="mb-2 text-xs font-bold uppercase text-brand">So what</p>
            <div className="grid gap-2 text-sm sm:grid-cols-2">
              <div><span className="text-xs font-bold text-muted">Financial impact</span><p className="font-semibold">{finding.expectedImpact || (finding.amount ? `£${finding.amount.toLocaleString("en-GB")}` : "Not quantified")}</p></div>
              <div><span className="text-xs font-bold text-muted">Risk level</span><p className="font-semibold capitalize">{finding.severity}{finding.evidenceStrength ? ` · ${finding.evidenceStrength}` : ""}</p></div>
              <div className="sm:col-span-2"><span className="text-xs font-bold text-muted">Why it matters</span><p>{finding.description}</p></div>
              <div className="sm:col-span-2"><span className="text-xs font-bold text-muted">Suggested fix</span><p>{finding.recommendation || "Review the exception, assign an owner and document resolution or accepted risk before sign-off."}</p></div>
              {standard && (
                <div className="sm:col-span-2"><span className="text-xs font-bold text-muted">Relevant standard</span><p><strong>{standard.label}</strong> — {standard.detail}</p></div>
              )}
            </div>
            {aiStatus === "done" && aiExplanation && (
              <div className="mt-3 rounded-lg border border-line bg-white p-3">
                <p className="text-[11px] font-bold uppercase text-amber-700">AI explanation — review before relying on it</p>
                <p className="mt-1 text-sm">{aiExplanation}</p>
              </div>
            )}
            {aiStatus === "unavailable" && <p className="mt-2 text-xs text-muted">AI explanation unavailable (no AI key configured). The grounded summary above is deterministic.</p>}
            {aiStatus === "error" && <p className="mt-2 text-xs text-red-600">AI explanation could not be generated.</p>}
            {aiStatus !== "done" && (
              <button className="mt-3 rounded-lg border border-brand/40 bg-white px-3 py-1.5 text-xs font-bold text-brand disabled:opacity-60" disabled={aiStatus === "loading"} onClick={explainFinding}>
                {aiStatus === "loading" ? "Explaining…" : "Explain with AI"}
              </button>
            )}
          </div>
          {/* Evidence panel */}
          <div className="rounded-lg bg-slate-50 p-4">
            <p className="mb-2 text-xs font-bold uppercase text-muted">Evidence</p>
            <div className="grid gap-2 text-sm md:grid-cols-2">
              <div><span className="text-xs text-muted">Source file</span><p className="font-semibold">{finding.evidence.sourceFile}</p></div>
              <div><span className="text-xs text-muted">Account / Party</span><p className="font-semibold truncate">{finding.evidence.accountCode || "—"}</p></div>
              <div><span className="text-xs text-muted">Period</span><p className="font-semibold">{finding.evidence.period}</p></div>
              <div><span className="text-xs text-muted">Detection confidence</span><p className={`font-black ${confidencePct >= 90 ? "text-emerald-700" : confidencePct >= 70 ? "text-amber-700" : "text-red-600"}`}>{confidencePct}%</p></div>
              <div><span className="text-xs text-muted">Evidence strength</span><p className={`font-black ${evidenceStrengthPct >= 90 ? "text-emerald-700" : evidenceStrengthPct >= 70 ? "text-amber-700" : "text-red-600"}`}>{evidenceStrengthPct}%</p></div>
            </div>
            <div className="mt-3 rounded-lg border border-line bg-white p-3">
              <p className="text-xs font-bold text-muted">Calculation</p>
              <p className="mt-1 text-sm">{finding.evidence.calculation}</p>
            </div>
            <EvidenceRowsPreview finding={finding} compact />
            {finding.reviewer && (
              <p className="mt-2 text-xs text-muted">Reviewed by: <strong>{finding.reviewer}</strong></p>
            )}
            {finding.reviewReason && (
              <div className="mt-2 rounded-lg border border-line bg-white p-3">
                <p className="text-xs font-bold text-muted">Reviewer reason</p>
                <p className="mt-1 text-sm">{finding.reviewReason}</p>
                {finding.reviewedAt && <p className="mt-1 text-xs text-muted">{new Date(finding.reviewedAt).toLocaleString("en-GB")}</p>}
              </div>
            )}
          </div>

          {/* HITL decision buttons */}
          {updateFindingStatus && (
            <div className="mt-4">
              <p className="mb-2 text-xs font-bold uppercase text-muted">Reviewer Actions</p>
              <label className="mb-3 block">
                <span className="mb-1 block text-xs font-bold text-muted">Action note</span>
                <textarea
                  className="min-h-20 w-full rounded-lg border border-line px-3 py-2 text-sm"
                  value={reviewReason}
                  onChange={(event) => setReviewReason(event.target.value)}
                  placeholder="Capture the review action, evidence request, resolution note or sign-off rationale."
                />
              </label>
              <div className="grid gap-2 sm:grid-cols-3 xl:grid-cols-8">
                <button className="rounded-lg border border-line bg-white px-3 py-2.5 text-sm font-bold hover:border-brand hover:text-brand transition-colors" onClick={() => updateFindingStatus(finding.id, "under_review", reviewReason)}>
                  Assign
                  <span className="block text-xs font-normal opacity-70">Under review</span>
                </button>
                <button className="rounded-lg bg-amber-500 px-3 py-2.5 text-sm font-bold text-white hover:bg-amber-600 transition-colors" onClick={() => updateFindingStatus(finding.id, "evidence_requested", reviewReason)}>
                  Request Evidence
                  <span className="block text-xs font-normal opacity-80">Need support</span>
                </button>
                <button className="rounded-lg bg-cyan-600 px-3 py-2.5 text-sm font-bold text-white hover:bg-cyan-700 transition-colors" onClick={() => updateFindingStatus(finding.id, "evidence_received", reviewReason)}>
                  Review Evidence
                  <span className="block text-xs font-normal opacity-80">Evidence in</span>
                </button>
                <button className="rounded-lg bg-emerald-600 px-3 py-2.5 text-sm font-bold text-white hover:bg-emerald-700 transition-colors" onClick={() => updateFindingStatus(finding.id, "resolved", reviewReason)}>
                  Resolve
                  <span className="block text-xs font-normal opacity-80">Resolve</span>
                </button>
                <button className="rounded-lg bg-green-700 px-3 py-2.5 text-sm font-bold text-white hover:bg-green-800 transition-colors" onClick={() => updateFindingStatus(finding.id, "approved", reviewReason)}>
                  Approve
                  <span className="block text-xs font-normal opacity-80">Sign off</span>
                </button>
                <button className="rounded-lg bg-red-600 px-3 py-2.5 text-sm font-bold text-white hover:bg-red-700 transition-colors" onClick={() => updateFindingStatus(finding.id, "false_positive", reviewReason)}>
                  False Positive
                  <span className="block text-xs font-normal opacity-80">Close path</span>
                </button>
                <button className="rounded-lg bg-violet-600 px-3 py-2.5 text-sm font-bold text-white hover:bg-violet-700 transition-colors" onClick={() => updateFindingStatus(finding.id, "accepted_risk", reviewReason)}>
                  Accept Risk
                  <span className="block text-xs font-normal opacity-80">No remediation</span>
                </button>
                <button className="rounded-lg bg-slate-600 px-3 py-2.5 text-sm font-bold text-white hover:bg-slate-700 transition-colors" onClick={() => updateFindingStatus(finding.id, "under_review", reviewReason || "Escalated for manager or partner review.")}>
                  Escalate
                  <span className="block text-xs font-normal opacity-80">Senior review</span>
                </button>
              </div>
            </div>
          )}

          {/* Already decided — show undo option */}
          {updateFindingStatus && isDecided && (
            <div className="mt-4 flex items-center gap-3">
              <span className={`rounded-lg px-3 py-2 text-sm font-bold ${statusCfg.color}`}>{statusCfg.label}</span>
              <button className="text-sm font-bold text-muted underline" onClick={() => updateFindingStatus(finding.id, "open")}>Undo decision</button>
            </div>
          )}

          <div className="mt-3 flex gap-2">
            <button className="rounded-lg border border-line px-3 py-1.5 text-xs font-bold" onClick={() => setActive("Ask ClosePilot")}>Ask ClosePilot</button>
          </div>
        </div>
      )}
    </article>
  );
}

export function FindingList({ findings, setActive, updateFindingStatus }: { findings: Finding[]; setActive: (value: string) => void; updateFindingStatus?: (findingId: string, status: FindingStatus, reason?: string) => void }) {
  const [severityFilter, setSeverityFilter] = useState<"all" | RiskLevel>("all");
  const [evidenceFilter, setEvidenceFilter] = useState<"all" | "deterministic" | "indicator" | "advisory">("all");
  const [statusFilter, setStatusFilter] = useState<"open" | "reviewed" | "all">("open");
  if (findings.length === 0) return <p className="py-4 text-center text-sm text-muted">No findings to display.</p>;
  const filtered = findings.filter((finding) => {
    if (severityFilter !== "all" && finding.severity !== severityFilter) return false;
    if (evidenceFilter !== "all" && (finding.evidenceStrength ?? "indicator") !== evidenceFilter) return false;
    if (statusFilter === "open" && !isOpenFinding(finding)) return false;
    if (statusFilter === "reviewed" && !reviewedFindingStatuses.includes(finding.status)) return false;
    return true;
  });
  return (
    <div className="grid gap-3">
      <div className="grid gap-2 rounded-lg border border-line bg-slate-50 p-3 md:grid-cols-3">
        <select className="h-9 rounded-lg border border-line bg-white px-3 text-sm font-bold" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}>
          <option value="open">Open queue</option>
          <option value="reviewed">Reviewed</option>
          <option value="all">All statuses</option>
        </select>
        <select className="h-9 rounded-lg border border-line bg-white px-3 text-sm font-bold" value={severityFilter} onChange={(e) => setSeverityFilter(e.target.value as typeof severityFilter)}>
          <option value="all">All severities</option>
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
        <select className="h-9 rounded-lg border border-line bg-white px-3 text-sm font-bold" value={evidenceFilter} onChange={(e) => setEvidenceFilter(e.target.value as typeof evidenceFilter)}>
          <option value="all">All evidence tiers</option>
          <option value="deterministic">Assurance findings</option>
          <option value="indicator">Risk indicators</option>
          <option value="advisory">Review reminders</option>
        </select>
      </div>
      {filtered.map((finding) => (
        <FindingCard key={finding.id} finding={finding} setActive={setActive} updateFindingStatus={updateFindingStatus} />
      ))}
      {filtered.length === 0 && <EmptyState title="No matching findings" detail="Change the filters to see the rest of the review queue." />}
    </div>
  );
}
