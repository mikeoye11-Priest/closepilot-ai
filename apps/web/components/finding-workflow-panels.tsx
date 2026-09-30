import { Pill } from "@/components/ui-primitives";
import type { LifecycleStatus } from "@/lib/finding-ledger";
import {
  FINDING_LIFECYCLE_LABELS,
  FINDING_STATUS_CONFIG,
  findingDueDate,
  findingLifecycleCounts,
  findingOwner,
  lifecycleStatuses,
} from "@/lib/finding-workflow";
import type { Finding, RiskLevel } from "@/lib/types";

export function DrawerField({ label, value }: { label: string; value: string }) {
  return <div><p className="text-xs font-bold uppercase text-muted">{label}</p><p className="mt-1 break-words text-sm font-semibold capitalize">{value}</p></div>;
}

export function FindingLifecycleSummary({ findings, setActive }: { findings: Finding[]; setActive: (value: string) => void }) {
  const counts = findingLifecycleCounts(findings);
  const tones: Record<LifecycleStatus, RiskLevel> = {
    open: counts.open ? "high" : "low",
    under_review: counts.under_review ? "medium" : "low",
    evidence_requested: counts.evidence_requested ? "high" : "low",
    evidence_received: counts.evidence_received ? "medium" : "low",
    resolved: "low",
    approved: "low",
    closed: "low",
  };

  return (
    <div className="grid gap-2">
      {lifecycleStatuses.map((status) => (
        <button key={status} className="grid grid-cols-[1fr_auto] items-center rounded-lg border border-line bg-slate-50 px-3 py-2 text-left transition-colors hover:border-brand hover:bg-cyan-50" onClick={() => setActive("Findings")}>
          <span className="text-sm font-bold">{FINDING_LIFECYCLE_LABELS[status]}</span>
          <strong className="text-lg">{counts[status]}</strong>
          <span className="col-span-2 mt-1">
            <Pill level={tones[status]}>{status === "evidence_requested" ? "evidence queue" : status === "resolved" ? "ready for sign-off" : FINDING_STATUS_CONFIG[status].label}</Pill>
          </span>
        </button>
      ))}
    </div>
  );
}

export function FindingRegister({
  findings,
  onSelect,
  selectedIds,
  onToggleSelected,
}: {
  findings: Finding[];
  onSelect: (findingId: string) => void;
  selectedIds: string[];
  onToggleSelected: (findingId: string) => void;
}) {
  if (!findings.length) return <p className="py-4 text-center text-sm text-muted">No findings match the current status.</p>;
  const weight: Record<RiskLevel, number> = { critical: 4, high: 3, medium: 2, low: 1 };
  const rows = findings.slice().sort((a, b) => weight[b.severity] - weight[a.severity]).slice(0, 12);

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] border-collapse text-left text-sm">
        <thead className="text-xs uppercase text-muted">
          <tr>
            <th className="border-b border-line p-2">Select</th>
            <th className="border-b border-line p-2">Severity</th>
            <th className="border-b border-line p-2">Finding</th>
            <th className="border-b border-line p-2">Owner</th>
            <th className="border-b border-line p-2">Status</th>
            <th className="border-b border-line p-2">Due Date</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((finding) => {
            const statusCfg = FINDING_STATUS_CONFIG[finding.status] ?? FINDING_STATUS_CONFIG.open;
            return (
              <tr key={finding.id} className="cursor-pointer hover:bg-slate-50" onClick={() => onSelect(finding.id)}>
                <td className="border-b border-line p-2" onClick={(event) => event.stopPropagation()}>
                  <input className="h-4 w-4 accent-brand" type="checkbox" checked={selectedIds.includes(finding.id)} onChange={() => onToggleSelected(finding.id)} aria-label={`Select ${finding.title}`} />
                </td>
                <td className="border-b border-line p-2"><Pill level={finding.severity}>{finding.severity}</Pill></td>
                <td className="border-b border-line p-2"><strong className="block">{finding.title}</strong><span className="text-xs text-muted">{finding.sourceFile ?? finding.evidence.sourceFile}</span></td>
                <td className="border-b border-line p-2 font-semibold">{findingOwner(finding)}</td>
                <td className="border-b border-line p-2"><span className={`rounded-full px-2 py-0.5 text-xs font-bold ${statusCfg.color}`}>{statusCfg.label}</span></td>
                <td className="border-b border-line p-2 font-semibold">{findingDueDate(finding)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {findings.length > rows.length && <p className="mt-2 text-xs text-muted">{findings.length - rows.length} more finding(s) in the detail queue.</p>}
    </div>
  );
}
