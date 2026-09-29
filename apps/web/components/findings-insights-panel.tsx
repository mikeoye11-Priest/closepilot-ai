"use client";

import { useMemo, useState } from "react";
import { Panel } from "@/components/ui-primitives";
import { buildFindingsInsights } from "@/lib/findings-insights";
import type { Finding } from "@/lib/types";

const INSIGHT_SEV_CHIP: Record<string, string> = {
  critical: "bg-red-100 text-red-800 ring-red-600/20",
  high: "bg-red-50 text-red-700 ring-red-600/20",
  medium: "bg-amber-50 text-amber-700 ring-amber-600/20",
  positive: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  info: "bg-slate-100 text-slate-600 ring-slate-500/20",
};

export function FindingsInsightsPanel({ findings }: { findings: Finding[] }) {
  const insights = useMemo(() => buildFindingsInsights(findings), [findings]);
  const [ai, setAi] = useState<{ narrative: string; aiGenerated: boolean } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  if (!insights.available) return null;

  const explain = async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/insight-narrative", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ factSheet: insights.factSheet, headline: insights.headline, role: "findings" }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not generate the narrative.");
      setAi({ narrative: data.narrative, aiGenerated: data.aiGenerated });
    } catch (e) { setError(e instanceof Error ? e.message : "Could not generate the narrative."); }
    finally { setLoading(false); }
  };

  return (
    <Panel title="Priority Findings">
      <p className="text-base font-bold text-ink">{insights.headline}</p>
      {ai ? (
        <div className="mt-3 rounded-xl border border-brand/20 bg-brand/5 p-4">
          <p className="text-[11px] font-black uppercase tracking-wide text-brand">{ai.aiGenerated ? "AI-drafted — review before relying on it" : "Summary"}</p>
          <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-ink">{ai.narrative}</p>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button className="rounded-lg bg-brand px-4 py-2 text-sm font-bold text-white disabled:opacity-60" disabled={loading} onClick={explain}>{loading ? "Thinking…" : "Explain with AI"}</button>
          {error && <span className="text-sm text-red-700">{error}</span>}
        </div>
      )}
      <div className="mt-4 grid gap-2">
        {insights.signals.map((signal, index) => (
          <div key={index} className="flex flex-wrap items-start justify-between gap-2 rounded-xl border border-line p-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase ring-1 ring-inset ${INSIGHT_SEV_CHIP[signal.severity] ?? INSIGHT_SEV_CHIP.info}`}>{signal.severity}</span>
                <span className="text-sm font-bold text-ink">{signal.title}</span>
              </div>
              <p className="mt-1 text-xs text-muted">{signal.detail}</p>
              <p className="mt-1 text-xs font-semibold text-ink">→ {signal.action}</p>
            </div>
            <span className="shrink-0 text-[11px] font-bold uppercase text-muted">{signal.area}</span>
          </div>
        ))}
      </div>
    </Panel>
  );
}
