"use client";

import type { ReactNode } from "react";
import { isOpenFinding } from "@/lib/finding-ledger";
import { riskCopy } from "@/lib/finance";
import type { AnalysisResult, ClientCompany, RiskLevel, Tenant } from "@/lib/types";

function Panel({ title, children }: { title: string; children: ReactNode }) {
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

function Pill({ level, children }: { level: string; children: ReactNode }) {
  const colors: Record<string, string> = {
    low: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
    medium: "bg-amber-50 text-amber-700 ring-amber-600/20",
    high: "bg-red-50 text-red-700 ring-red-600/20",
    critical: "bg-red-50 text-red-700 ring-red-600/20",
    none: "bg-slate-100 text-slate-500 ring-slate-500/20",
  };
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold capitalize leading-none ring-1 ring-inset ${colors[level] || colors.medium}`}>{children}</span>;
}

function Metric({ title, value, detail, tone }: { title: string; value: string | number; detail: string; tone: RiskLevel }) {
  const border = tone === "low" ? "border-l-green" : tone === "medium" ? "border-l-amber" : "border-l-red";
  const soft = tone === "low" ? "from-emerald-50" : tone === "medium" ? "from-amber-50" : "from-red-50";
  return (
    <article className={`min-h-32 rounded-xl border border-l-4 border-line bg-gradient-to-br ${soft} to-white p-4 shadow-card ${border}`}>
      <p className="text-sm font-bold text-muted">{title}</p>
      <strong className="mt-3 block break-words text-3xl font-black leading-none tracking-tight text-ink">{value}</strong>
      <span className="mt-2 block text-sm text-muted">{detail}</span>
    </article>
  );
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="rounded-lg border border-dashed border-line bg-slate-50 p-6 text-center">
      <strong className="block">{title}</strong>
      <p className="mt-1 text-sm text-muted">{detail}</p>
    </div>
  );
}

function clientHealthRisks(client: ClientCompany): { cashflow: RiskLevel; vat: RiskLevel; debtors: RiskLevel; workingCapital: RiskLevel } {
  const score = client.score;
  const findings = client.openFindings;
  return {
    cashflow:       score < 60 || findings > 5 ? "high" : score < 75 ? "medium" : "low",
    vat:            client.closeStatus?.toLowerCase().includes("vat") ? "high" : score < 70 ? "medium" : "low",
    debtors:        client.closeStatus?.toLowerCase().includes("ar") || client.closeStatus?.toLowerCase().includes("debtor") ? "high" : score < 70 ? "medium" : "low",
    workingCapital: score < 55 ? "critical" : score < 70 ? "high" : score < 80 ? "medium" : "low",
  };
}

function RiskDot({ level }: { level: RiskLevel }) {
  const colors: Record<RiskLevel, string> = { low: "bg-emerald-500", medium: "bg-amber-400", high: "bg-red-500", critical: "bg-red-700" };
  const titles: Record<RiskLevel, string> = { low: "Low risk", medium: "Watch", high: "At risk", critical: "Critical" };
  return <span role="img" aria-label={titles[level]} className={`inline-block h-2.5 w-2.5 rounded-full ${colors[level]}`} title={titles[level]} />;
}

export function PracticePortal({ tenant, clients, currentCompanyId, switchCompany, companySnapshots }: { tenant: Tenant; clients: ClientCompany[]; currentCompanyId: string; switchCompany: (companyId: string) => void; companySnapshots: Record<string, AnalysisResult> }) {
  const average = clients.length ? Math.round(clients.reduce((sum, client) => sum + client.score, 0) / clients.length) : 0;
  const highRisk = clients.filter((c) => c.risk === "high" || c.risk === "critical").length;
  const totalFindings = clients.reduce((sum, c) => sum + c.openFindings, 0);
  const vatRows = clients.map((client) => {
    const snapshot = companySnapshots[client.id];
    const vatReview = snapshot?.vatReview;
    const vatFindings = snapshot?.findings.filter((finding) => finding.category === "vat" && isOpenFinding(finding)) ?? [];
    const hasVat = Boolean(vatReview && vatReview.source !== "empty" && vatReview.transactionsAnalysed > 0);
    const failedReconciliations = vatReview?.reconciliationResults.filter((item) => item.status === "failed").length ?? 0;
    const status = !hasVat ? "Waiting" : failedReconciliations ? "Blocked" : vatFindings.length ? "Review" : "Ready";
    const tone: RiskLevel = status === "Ready" ? "low" : status === "Review" || status === "Waiting" ? "medium" : "critical";
    return {
      client,
      vatDue: vatReview?.vatReturn.box5 ?? 0,
      findings: vatFindings.length + (vatReview?.findings.length ?? 0),
      status,
      tone,
    };
  });
  const vatReady = vatRows.filter((row) => row.status === "Ready").length;
  const vatWaiting = vatRows.filter((row) => row.status === "Waiting").length;
  const vatBlocked = vatRows.filter((row) => row.status === "Blocked").length;
  const workflow = [
    { name: "Awaiting Pack", clients: clients.filter((c) => c.closeStatus === "Awaiting upload"), tone: "medium" as RiskLevel },
    { name: "AI Review Complete", clients: clients.filter((c) => c.closeStatus !== "Awaiting upload" && c.openFindings === 0), tone: "low" as RiskLevel },
    { name: "Manager Review", clients: clients.filter((c) => c.openFindings > 0 && c.risk !== "high" && c.risk !== "critical"), tone: "medium" as RiskLevel },
    { name: "Blocked / High Risk", clients: clients.filter((c) => c.risk === "high" || c.risk === "critical"), tone: "critical" as RiskLevel },
  ];
  const nextActions = clients
    .slice()
    .sort((a, b) => b.openFindings - a.openFindings || a.score - b.score)
    .slice(0, 5);

  return (
    <div className="grid gap-4">
      {/* Practice overview */}
      <section className="rounded-lg border border-line bg-white p-5 shadow-panel">
        <div className="mb-4">
          <p className="text-xs font-bold uppercase text-muted">Client Health Dashboard</p>
          <h2 className="text-xl font-black">{tenant.name}</h2>
          <p className="text-sm text-muted">{clients.length} active client{clients.length !== 1 ? "s" : ""} · {tenant.type === "accounting_practice" ? "Accounting practice" : "Company workspace"}</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-4">
          <div className="rounded-lg border border-line bg-slate-50 p-4 text-center">
            <strong className={`block text-3xl font-black ${average >= 80 ? "text-emerald-700" : average >= 65 ? "text-amber-700" : "text-red-700"}`}>{average || "—"}</strong>
            <p className="mt-1 text-sm font-bold text-muted">Avg Review Quality</p>
          </div>
          <div className="rounded-lg border border-line bg-slate-50 p-4 text-center">
            <strong className={`block text-3xl font-black ${clients.length > 0 ? "text-brand" : "text-slate-400"}`}>{clients.length}</strong>
            <p className="mt-1 text-sm font-bold text-muted">Active Clients</p>
          </div>
          <div className="rounded-lg border border-line bg-slate-50 p-4 text-center">
            <strong className={`block text-3xl font-black ${highRisk > 0 ? "text-red-700" : "text-emerald-700"}`}>{highRisk}</strong>
            <p className="mt-1 text-sm font-bold text-muted">High-Risk Clients</p>
          </div>
          <div className="rounded-lg border border-line bg-slate-50 p-4 text-center">
            <strong className={`block text-3xl font-black ${totalFindings > 0 ? "text-amber-700" : "text-emerald-700"}`}>{totalFindings}</strong>
            <p className="mt-1 text-sm font-bold text-muted">Open Findings</p>
          </div>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[0.7fr_1.3fr]">
        <Panel title="VAT Control Centre">
          <div className="grid gap-3">
            <Metric title="Returns Ready" value={vatReady} detail="Ready to submit/review" tone="low" />
            <Metric title="Returns Waiting" value={vatWaiting} detail="VAT pack not uploaded" tone="medium" />
            <Metric title="Returns Blocked" value={vatBlocked} detail="Failed reconciliation or blocker" tone={vatBlocked ? "critical" : "low"} />
          </div>
        </Panel>

        <Panel title="Practice VAT Review Queue">
          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="w-full min-w-[720px] border-collapse text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-muted">
                <tr>
                  <th className="border-b border-line p-3">Client</th>
                  <th className="border-b border-line p-3 text-right">VAT Due</th>
                  <th className="border-b border-line p-3 text-right">Findings</th>
                  <th className="border-b border-line p-3">Status</th>
                  <th className="border-b border-line p-3"></th>
                </tr>
              </thead>
              <tbody>
                {vatRows.map((row) => (
                  <tr key={row.client.id}>
                    <td className="border-b border-line p-3 font-bold">{row.client.name}</td>
                    <td className="border-b border-line p-3 text-right font-semibold">{row.status === "Waiting" ? "—" : `£${Math.round(Math.abs(row.vatDue)).toLocaleString("en-GB")}`}</td>
                    <td className="border-b border-line p-3 text-right">{row.findings}</td>
                    <td className="border-b border-line p-3"><Pill level={row.tone}>{row.status}</Pill></td>
                    <td className="border-b border-line p-3 text-right">
                      <button className="rounded-lg bg-brand px-3 py-2 text-xs font-bold text-white" onClick={() => switchCompany(row.client.id)}>Open</button>
                    </td>
                  </tr>
                ))}
                {vatRows.length === 0 && (
                  <tr>
                    <td className="p-4 text-center text-muted" colSpan={5}>No clients available for VAT review.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1fr_0.8fr]">
        <Panel title="Practice Review Workflow">
          <div className="grid gap-3 md:grid-cols-4">
            {workflow.map((lane) => (
              <div key={lane.name} className="rounded-lg border border-line bg-slate-50 p-3">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <strong className="text-sm">{lane.name}</strong>
                  <Pill level={lane.tone}>{lane.clients.length}</Pill>
                </div>
                <div className="grid gap-2">
                  {lane.clients.slice(0, 4).map((client) => (
                    <button key={client.id} className="rounded-lg border border-line bg-white p-2 text-left hover:border-brand" onClick={() => switchCompany(client.id)}>
                      <span className="block truncate text-sm font-bold">{client.name}</span>
                      <span className="block text-xs text-muted">{client.openFindings} open · score {client.score || "—"}</span>
                    </button>
                  ))}
                  {lane.clients.length === 0 && <p className="rounded-lg border border-dashed border-line bg-white p-3 text-xs text-muted">No clients in this lane.</p>}
                </div>
              </div>
            ))}
          </div>
        </Panel>
        <Panel title="Manager Queue">
          <div className="grid gap-2">
            {nextActions.length ? nextActions.map((client) => (
              <button key={client.id} className="flex items-center justify-between gap-3 rounded-lg border border-line bg-white p-3 text-left hover:border-brand" onClick={() => switchCompany(client.id)}>
                <div className="min-w-0">
                  <strong className="block truncate text-sm">{client.name}</strong>
                  <p className="text-xs text-muted">{client.system} · {client.closeStatus}</p>
                </div>
                <div className="shrink-0 text-right">
                  <Pill level={client.risk}>{riskCopy(client.risk)}</Pill>
                  <p className="mt-1 text-xs font-bold text-muted">{client.openFindings} open</p>
                </div>
              </button>
            )) : <EmptyState title="No manager queue yet" detail="Onboard clients and upload finance packs to build the review queue." />}
          </div>
        </Panel>
      </section>

      {/* Client Health Cards */}
      {clients.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {clients.map((client) => {
            const health = clientHealthRisks(client);
            const isActive = client.id === currentCompanyId;
            return (
              <article key={client.id} className={`rounded-xl border bg-white p-5 shadow-sm transition-all ${isActive ? "border-brand ring-1 ring-brand" : "border-line hover:border-slate-300"}`}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-black">{client.name}</p>
                    <p className="text-xs text-muted">{client.system} · {client.closeStatus}</p>
                  </div>
                  <div className="text-right">
                    <strong className={`block text-2xl font-black ${client.score >= 80 ? "text-emerald-700" : client.score >= 65 ? "text-amber-700" : "text-red-700"}`}>{client.score || "—"}</strong>
                    <Pill level={client.risk}>{riskCopy(client.risk)}</Pill>
                  </div>
                </div>

                {/* Client Health Risk Indicators */}
                <div className="mt-4 grid grid-cols-4 gap-2 border-t border-line pt-4">
                  {[
                    { label: "Cashflow", level: health.cashflow },
                    { label: "VAT", level: health.vat },
                    { label: "Debtors", level: health.debtors },
                    { label: "Working Cap", level: health.workingCapital },
                  ].map(({ label, level }) => (
                    <div key={label} className="text-center">
                      <RiskDot level={level} />
                      <p className="mt-1 text-xs text-muted">{label}</p>
                    </div>
                  ))}
                </div>

                {client.openFindings > 0 && (
                  <p className="mt-3 text-xs font-semibold text-amber-700">{client.openFindings} open finding{client.openFindings !== 1 ? "s" : ""} require review</p>
                )}

                <button
                  className={`mt-4 w-full rounded-lg py-2 text-sm font-bold transition-colors ${isActive ? "bg-brand/10 text-brand" : "bg-brand text-white hover:bg-blue-700"}`}
                  onClick={() => switchCompany(client.id)}
                  disabled={isActive}
                >
                  {isActive ? "Currently Active" : "Open Client Review"}
                </button>
              </article>
            );
          })}
        </div>
      ) : (
        <Panel title="Client Health Dashboard">
          <div className="py-8 text-center">
            <p className="font-bold text-muted">No clients yet</p>
            <p className="mt-1 text-sm text-muted">Onboard your first client to see their health dashboard.</p>
          </div>
        </Panel>
      )}
    </div>
  );
}
