import { Pill } from "@/components/ui-primitives";
import { riskCopy } from "@/lib/finance";
import type { RiskLevel } from "@/lib/types";

export function ForecastLine({ label, from, to }: { label: string; from: number; to: number }) {
  const gain = Math.max(0, to - from);
  return (
    <div className="rounded-lg border border-line bg-white p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0"><strong className="block truncate text-sm">{label}</strong><p className="mt-1 text-xs text-muted">{from}% → {to}% readiness</p></div>
        <span className={`shrink-0 text-sm font-bold ${gain ? "text-emerald-700" : "text-muted"}`}>{gain ? `+${gain}` : "+0"}</span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
        <div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.max(4, to)}%` }} />
      </div>
    </div>
  );
}

export function SummaryItem({ label, value, detail, level }: { label: string; value: string; detail: string; level: RiskLevel }) {
  return (
    <div className="min-h-32 rounded-lg border border-line bg-slate-50 p-3">
      <p className="text-xs font-bold uppercase text-muted">{label}</p>
      <strong className="mt-2 block break-words text-2xl leading-none">{value}</strong>
      <p className="mt-1 text-xs text-muted">{detail}</p>
      <div className="mt-2"><Pill level={level}>{riskCopy(level)}</Pill></div>
    </div>
  );
}
