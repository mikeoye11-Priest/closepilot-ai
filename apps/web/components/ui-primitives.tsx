import type { ReactNode } from "react";

export function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-surface p-5 shadow-card">
      <div className="mb-4 flex items-center gap-2.5">
        <span className="h-4 w-1 rounded-full bg-gradient-to-b from-cyan to-brand" aria-hidden="true" />
        <h2 className="text-[15px] font-bold tracking-tight text-ink">{title}</h2>
      </div>
      {children}
    </section>
  );
}

export function Pill({ level, children }: { level: string; children: ReactNode }) {
  const colors: Record<string, string> = {
    low: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
    medium: "bg-amber-50 text-amber-700 ring-amber-600/20",
    high: "bg-red-50 text-red-700 ring-red-600/20",
    critical: "bg-red-50 text-red-700 ring-red-600/20",
    none: "bg-slate-100 text-slate-500 ring-slate-500/20",
  };
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold capitalize leading-none ring-1 ring-inset ${colors[level] || colors.medium}`}>
      {children}
    </span>
  );
}

export function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="rounded-lg border border-dashed border-line bg-slate-50 p-6 text-center">
      <strong className="block">{title}</strong>
      <p className="mt-1 text-sm text-muted">{detail}</p>
    </div>
  );
}
