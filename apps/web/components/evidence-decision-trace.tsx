import { isOpenFinding } from "@/lib/finding-ledger";
import { FINDING_STATUS_CONFIG, findingEvidenceReference, managerReviewStatus } from "@/lib/finding-workflow";
import type { Finding, PartnerSignOff } from "@/lib/types";

export function EvidenceDecisionTrace({ finding, partnerSignOff }: { finding: Finding; partnerSignOff?: PartnerSignOff }) {
  const evidenceRef = findingEvidenceReference(finding);
  const managerStatus = managerReviewStatus(finding);
  const reviewDecision = finding.reviewAction?.replaceAll("_", " ") || FINDING_STATUS_CONFIG[finding.status]?.label || finding.status.replaceAll("_", " ");
  const signOffImpact = partnerSignOff
    ? finding.status === "accepted_risk"
      ? "Accepted risk retained in locked pack"
      : "Included in locked review pack"
    : isOpenFinding(finding)
      ? "Blocks or qualifies sign-off"
      : "Ready for sign-off";
  const stages = [
    { label: "Source", value: evidenceRef.sourceFile, detail: evidenceRef.rowIndexes, tone: "border-cyan-500 bg-cyan-50" },
    { label: "Calculation", value: evidenceRef.calculation, detail: `${evidenceRef.rowCount} source row${evidenceRef.rowCount !== 1 ? "s" : ""}`, tone: "border-blue-500 bg-blue-50" },
    {
      label: "Finding",
      value: finding.title,
      detail: `${finding.severity} · ${finding.ruleId ?? finding.id}`,
      tone: finding.severity === "critical" || finding.severity === "high" ? "border-amber-500 bg-amber-50" : "border-slate-400 bg-slate-50",
    },
    {
      label: "Review",
      value: reviewDecision,
      detail: `Manager ${managerStatus.replaceAll("_", " ")}`,
      tone: managerStatus === "approved" ? "border-emerald-500 bg-emerald-50" : "border-violet-500 bg-violet-50",
    },
    {
      label: "Sign-off",
      value: signOffImpact,
      detail: partnerSignOff ? `${partnerSignOff.signedBy} · ${partnerSignOff.reviewPackStatus ?? partnerSignOff.status}` : "Partner decision pending",
      tone: partnerSignOff ? "border-emerald-600 bg-emerald-50" : "border-slate-400 bg-slate-50",
    },
  ];

  return (
    <section className="rounded-lg border border-line bg-white p-4 xl:col-span-2" aria-label="Review trail">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase text-muted">Review trail</p>
          <h3 className="mt-1 text-lg font-black">From source row to partner sign-off</h3>
        </div>
        <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-800">Fully traceable</span>
      </div>
      <ol className="mt-4 grid gap-2 md:grid-cols-5">
        {stages.map((stage, index) => (
          <li key={stage.label} className={`relative min-w-0 rounded-lg border border-l-4 p-3 ${stage.tone}`}>
            <div className="flex items-center gap-2">
              <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white">{index + 1}</span>
              <span className="text-xs font-bold uppercase text-slate-600">{stage.label}</span>
            </div>
            <strong className="mt-3 block break-words text-sm leading-snug">{stage.value}</strong>
            <span className="mt-2 block break-words text-xs capitalize text-muted">{stage.detail}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
