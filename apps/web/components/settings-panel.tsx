"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { AnalysisResult, Company, Tenant } from "@/lib/types";
import type { AccountingIntegrationState } from "@/lib/integrations/types";
import { INTEGRATION_STAGE_META, integrationActivityLabel, integrationSyncSummary, pollIntegrationSync, type IntegrationActivity } from "@/lib/integrations/lifecycle";
import { PERSISTABLE_ID } from "@/lib/workspace-snapshots";
import { recentVatPeriods, recentPeriods, VAT_PERIOD_COUNTS, PERIOD_COUNTS, type VatFrequency, type ReportFrequency } from "@/lib/vat-periods";

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

export function SettingsPanel({ tenant, company, userEmail, userName, onIntegrationAnalysis, onSyncedDataErased, setActive, presentationMode }: { tenant: Tenant; company: Company; userEmail: string; userName: string; onIntegrationAnalysis: (result: AnalysisResult, warnings?: string[]) => void; onSyncedDataErased?: () => void; setActive: (value: string) => void; presentationMode: boolean }) {
  const canConnectLiveIntegration = PERSISTABLE_ID.test(tenant.id) && PERSISTABLE_ID.test(company.id);
  const [name, setName] = useState(userName);
  const [email, setEmail] = useState(userEmail);
  const [role, setRole] = useState("Practice Admin");
  const [exportFormat, setExportFormat] = useState("PDF");
  const [currency, setCurrency] = useState("GBP");
  const [dateFormat, setDateFormat] = useState("DD/MM/YYYY");
  const [emailAlerts, setEmailAlerts] = useState(true);
  const [saved, setSaved] = useState(false);
  const [integrations, setIntegrations] = useState<AccountingIntegrationState[]>([]);
  const [integrationActivity, setIntegrationActivity] = useState<IntegrationActivity[]>([]);
  const [integrationMessage, setIntegrationMessage] = useState("");
  const [integrationBusy, setIntegrationBusy] = useState(false);
  const [vatFrequency, setVatFrequency] = useState<"accounts" | VatFrequency>("accounts");
  const [vatPeriodValue, setVatPeriodValue] = useState("");
  const vatPeriods = useMemo(() => (vatFrequency === "accounts" ? [] : recentVatPeriods(vatFrequency, VAT_PERIOD_COUNTS[vatFrequency])), [vatFrequency]);
  const changeVatFrequency = (next: "accounts" | VatFrequency) => {
    setVatFrequency(next);
    setVatPeriodValue(next === "accounts" ? "" : recentVatPeriods(next, VAT_PERIOD_COUNTS[next])[0]?.value ?? "");
  };

  // Accounts reporting period — scopes the sync's "as at" date (period end) for
  // the management/financial accounts. Year-to-date basis: the P&L runs from the
  // financial-year start (derived server-side) to this end. "current" = today.
  const ACCOUNTS_FREQUENCIES: ReportFrequency[] = ["monthly", "quarterly", "annual"];
  const [accountsFrequency, setAccountsFrequency] = useState<"current" | ReportFrequency>("current");
  const [accountsPeriodValue, setAccountsPeriodValue] = useState("");
  const accountsPeriods = useMemo(() => (accountsFrequency === "current" ? [] : recentPeriods(accountsFrequency, PERIOD_COUNTS[accountsFrequency])), [accountsFrequency]);
  const changeAccountsFrequency = (next: "current" | ReportFrequency) => {
    setAccountsFrequency(next);
    setAccountsPeriodValue(next === "current" ? "" : recentPeriods(next, PERIOD_COUNTS[next])[0]?.value ?? "");
  };

  const applyIntegrations = (result: { integrations?: unknown; recentActivity?: unknown }) => {
    setIntegrations(Array.isArray(result.integrations) ? result.integrations : []);
    setIntegrationActivity(Array.isArray(result.recentActivity) ? result.recentActivity : []);
  };

  useEffect(() => {
    fetch(`/api/integrations?tenantId=${encodeURIComponent(tenant.id)}&companyId=${encodeURIComponent(company.id)}`)
      .then((response) => response.json())
      .then(applyIntegrations)
      .catch(() => { setIntegrations([]); setIntegrationActivity([]); });
  }, [company.id, tenant.id]);

  const reloadIntegrations = async () => {
    const response = await fetch(`/api/integrations?tenantId=${encodeURIComponent(tenant.id)}&companyId=${encodeURIComponent(company.id)}`);
    applyIntegrations(await response.json());
  };

  const selectXeroOrganisation = async (integrationId: string) => {
    setIntegrationBusy(true); setIntegrationMessage("");
    try {
      const response = await fetch("/api/integrations/xero/select", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tenantId: tenant.id, companyId: company.id, integrationId }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not select Xero organisation.");
      await reloadIntegrations(); setIntegrationMessage("Xero organisation selected.");
    } catch (error) { setIntegrationMessage(error instanceof Error ? error.message : "Xero selection failed."); }
    finally { setIntegrationBusy(false); }
  };

  const syncProvider = async (provider: "xero" | "quickbooks" | "sage") => {
    const label = provider === "sage" ? "Sage" : provider === "quickbooks" ? "QuickBooks" : "Xero";
    setIntegrationBusy(true); setIntegrationMessage(`Queueing ${label} trial balance and VAT evidence…`);
    try {
      const chosenPeriod = vatFrequency === "accounts" ? undefined : vatPeriods.find((period) => period.value === vatPeriodValue);
      const chosenAccountsPeriod = accountsFrequency === "current" ? undefined : accountsPeriods.find((period) => period.value === accountsPeriodValue);
      const asOfDate = chosenAccountsPeriod?.end ?? new Date().toISOString().slice(0, 10);
      const response = await fetch(`/api/integrations/${provider}/sync`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tenantId: tenant.id, tenantName: tenant.name, tenantType: tenant.type, tenantPlan: tenant.plan, companyId: company.id, companyName: company.name, companyIndustry: company.industry, currency: company.currency, country: company.country, asOfDate, ...(chosenPeriod ? { vatPeriodStart: chosenPeriod.start, vatPeriodEnd: chosenPeriod.end } : {}) }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || `${label} sync failed.`);
      setIntegrationMessage(`${label} sync is running in the background…`);
      const completed = await pollIntegrationSync(provider, result.syncId, (status) => setIntegrationMessage(status === "queued" ? `${label} sync queued…` : `Syncing ${label} data and running assurance checks…`));
      if (!completed.analysis) throw new Error(`${label} sync completed without an analysis result.`);
      onIntegrationAnalysis(completed.analysis, completed.warnings ?? []);
      await reloadIntegrations();
      const vatRows = completed.counts?.vatRows ?? 0;
      const warningText = completed.warnings?.length ? ` Warnings: ${completed.warnings.join("; ")}` : "";
      const periodText = completed.vatPeriod ? ` VAT period ${completed.vatPeriod.start} to ${completed.vatPeriod.end}.` : "";
      const vatText = vatRows
        ? `${vatRows} VAT row(s).`
        : `0 VAT row(s). VAT Assurance needs ${label} tax-coded sales/purchases in the period, or upload a VAT evidence export.`;
      setIntegrationMessage(`${label} sync completed: ${completed.counts?.trialBalance ?? 0} trial-balance and ${vatText}${periodText}${warningText}`);
    } catch (error) { setIntegrationMessage(error instanceof Error ? error.message : `${label} sync failed.`); }
    finally { setIntegrationBusy(false); }
  };

  const disconnectProvider = async (provider: "xero" | "quickbooks" | "sage", integrationId: string) => {
    const label = provider === "sage" ? "Sage" : provider === "quickbooks" ? "QuickBooks" : "Xero";
    // Make the retention behaviour explicit: disconnecting only revokes the live
    // connection — completed syncs, reviews and accounts stay as evidence.
    if (typeof window !== "undefined" && !window.confirm(`Disconnect ${label}?\n\nThis stops future syncing and revokes ClosePilot's access. Reviews, accounts and sync evidence already produced are kept — reconnect any time to resume.`)) return;
    setIntegrationBusy(true); setIntegrationMessage("");
    try {
      const response = await fetch(`/api/integrations/${provider}/disconnect`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ integrationId }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || `${label} disconnect failed.`);
      await reloadIntegrations(); setIntegrationMessage(`${label} disconnected.`);
    } catch (error) { setIntegrationMessage(error instanceof Error ? error.message : `${label} disconnect failed.`); }
    finally { setIntegrationBusy(false); }
  };

  // Right to erasure — permanently deletes this client's synced accounting data
  // and connections. Distinct from disconnect (which keeps the evidence): a
  // typed confirmation guards it because it cannot be undone.
  const eraseIntegrationData = async () => {
    if (typeof window === "undefined") return;
    const confirmation = window.prompt(`Permanently erase ALL synced accounting data and connections for ${company.name}?\n\nThis deletes the imported trial balances, VAT evidence and reviews sourced from the connected accounting systems, and cannot be undone. (Uploaded files and manual work are not affected.)\n\nType ERASE to confirm.`);
    if (confirmation == null) return;
    if (confirmation.trim().toUpperCase() !== "ERASE") { setIntegrationMessage("Erase cancelled — confirmation text did not match."); return; }
    setIntegrationBusy(true); setIntegrationMessage("Erasing synced accounting data…");
    try {
      const response = await fetch(`/api/integrations/erase`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tenantId: tenant.id, companyId: company.id }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Erase failed.");
      await reloadIntegrations();
      // Also clear the workspace review derived from the synced data (sync-sourced
      // only) so the erase is complete — the parent decides based on provenance.
      onSyncedDataErased?.();
      setIntegrationMessage(result.message || "Synced accounting data erased.");
    } catch (error) { setIntegrationMessage(error instanceof Error ? error.message : "Erase failed."); }
    finally { setIntegrationBusy(false); }
  };

  const save = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  return (
    <div className="grid gap-6 max-w-2xl">
      <Panel title="Profile">
        <div className="grid gap-4 md:grid-cols-2">
          <label className="grid gap-2">
            <span className="text-sm font-bold text-muted">Full name</span>
            <input className="h-11 rounded-lg border border-line px-3" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="grid gap-2">
            <span className="text-sm font-bold text-muted">Email</span>
            <input className="h-11 rounded-lg border border-line px-3" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label className="grid gap-2">
            <span className="text-sm font-bold text-muted">Role</span>
            <select className="h-11 rounded-lg border border-line px-3" value={role} onChange={(e) => setRole(e.target.value)}>
              {["Practice Admin", "Manager", "Reviewer", "Client User"].map((r) => <option key={r}>{r}</option>)}
            </select>
          </label>
          <label className="grid gap-2">
            <span className="text-sm font-bold text-muted">Firm / Organisation</span>
            <input className="h-11 rounded-lg border border-line px-3 bg-slate-50" value={tenant.name} readOnly />
          </label>
        </div>
      </Panel>

      <Panel title="Export Preferences">
        <div className="grid gap-4 md:grid-cols-3">
          <label className="grid gap-2">
            <span className="text-sm font-bold text-muted">Export format</span>
            <select className="h-11 rounded-lg border border-line px-3" value={exportFormat} onChange={(e) => setExportFormat(e.target.value)}>
              {["PDF", "Excel", "CSV", "Word"].map((f) => <option key={f}>{f}</option>)}
            </select>
          </label>
          <label className="grid gap-2">
            <span className="text-sm font-bold text-muted">Currency display</span>
            <select className="h-11 rounded-lg border border-line px-3" value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {["GBP", "EUR", "USD", "NGN", "GHS", "KES", "ZAR"].map((c) => <option key={c}>{c}</option>)}
            </select>
          </label>
          <label className="grid gap-2">
            <span className="text-sm font-bold text-muted">Date format</span>
            <select className="h-11 rounded-lg border border-line px-3" value={dateFormat} onChange={(e) => setDateFormat(e.target.value)}>
              {["DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD"].map((d) => <option key={d}>{d}</option>)}
            </select>
          </label>
        </div>
      </Panel>

      <Panel title="Notifications">
        <label className="flex cursor-pointer items-center justify-between rounded-lg border border-line p-4">
          <div>
            <strong>Email alerts</strong>
            <p className="mt-1 text-sm text-muted">Receive an email when new critical findings are detected after upload.</p>
          </div>
          <button
            className={`relative h-6 w-11 rounded-full transition-colors ${emailAlerts ? "bg-brand" : "bg-slate-300"}`}
            onClick={() => setEmailAlerts((v) => !v)}
          >
            <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${emailAlerts ? "translate-x-5" : "translate-x-0.5"}`} />
          </button>
        </label>
      </Panel>

      <Panel title="Accounting Integrations">
        <div className="grid gap-3">
          {integrations.map((integration) => (
            <div key={integration.provider} className="rounded-lg border border-line bg-slate-50 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <strong>{integration.label}</strong>
                  <p className="mt-1 text-sm text-muted">{integration.detail}</p>
                  <p className="mt-2 text-xs text-muted">Scope: {integration.capabilities.map((capability) => capability.replaceAll("_", " ")).join(", ")}.</p>
                </div>
                <Pill level={integration.status === "connected" ? "low" : integration.status === "ready_to_connect" || integration.status === "tenant_selection_required" ? "medium" : "high"}>{integration.status.replaceAll("_", " ")}</Pill>
              </div>
              {integration.organisations?.length ? (
                <div className="mt-3 grid gap-2">
                  {integration.connected && (
                    <div className="rounded-lg border border-line bg-white p-3 text-sm">
                      <span className="text-xs font-bold uppercase text-muted">VAT return period</span>
                      <div className="mt-2 grid gap-2 sm:grid-cols-2">
                        <select className="rounded-lg border border-line bg-white px-3 py-2 text-sm" value={vatFrequency} disabled={integrationBusy} onChange={(event) => changeVatFrequency(event.target.value as "accounts" | VatFrequency)}>
                          <option value="accounts">Accounts period (default)</option>
                          <option value="monthly">Monthly</option>
                          <option value="bimonthly">Bi-monthly</option>
                          <option value="quarterly">Quarterly</option>
                          <option value="annual">Annual</option>
                        </select>
                        <select className="rounded-lg border border-line bg-white px-3 py-2 text-sm disabled:bg-slate-50 disabled:text-muted" value={vatPeriodValue} disabled={integrationBusy || vatFrequency === "accounts"} onChange={(event) => setVatPeriodValue(event.target.value)}>
                          {vatFrequency === "accounts"
                            ? <option value="">Whole accounts period</option>
                            : vatPeriods.map((period) => <option key={period.value} value={period.value}>{period.label}</option>)}
                        </select>
                      </div>
                      <p className="mt-2 text-xs text-muted">{vatFrequency === "accounts" ? "VAT evidence is scoped to the current accounting period." : "Scopes the sync's VAT evidence to the selected return period. Confirm the exact dates if the company is on a non-calendar VAT stagger."}</p>
                    </div>
                  )}
                  {integration.connected && (
                    <div className="rounded-lg border border-line bg-white p-3 text-sm">
                      <span className="text-xs font-bold uppercase text-muted">Accounts reporting period</span>
                      <div className="mt-2 grid gap-2 sm:grid-cols-2">
                        <select className="rounded-lg border border-line bg-white px-3 py-2 text-sm" value={accountsFrequency} disabled={integrationBusy} onChange={(event) => changeAccountsFrequency(event.target.value as "current" | ReportFrequency)}>
                          <option value="current">Current (to today)</option>
                          {ACCOUNTS_FREQUENCIES.map((frequency) => <option key={frequency} value={frequency}>{frequency[0].toUpperCase() + frequency.slice(1)}</option>)}
                        </select>
                        <select className="rounded-lg border border-line bg-white px-3 py-2 text-sm disabled:bg-slate-50 disabled:text-muted" value={accountsPeriodValue} disabled={integrationBusy || accountsFrequency === "current"} onChange={(event) => setAccountsPeriodValue(event.target.value)}>
                          {accountsFrequency === "current"
                            ? <option value="">Up to today</option>
                            : accountsPeriods.map((period) => <option key={period.value} value={period.value}>{period.label}</option>)}
                        </select>
                      </div>
                      <p className="mt-2 text-xs text-muted">{accountsFrequency === "current" ? "Management & financial accounts are produced to today's date." : "Sets the accounts “as at” date; the P&L runs year-to-date to that period end. Calendar-aligned — confirm the year-end if the financial year isn't December."}</p>
                    </div>
                  )}
                  {integration.organisations.map((organisation) => (
                    <div key={organisation.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-white p-3 text-sm">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <strong>{organisation.name}</strong>
                          {organisation.stage && <span className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wide ${INTEGRATION_STAGE_META[organisation.stage]?.cls ?? "bg-slate-100 text-slate-600"}`}>{INTEGRATION_STAGE_META[organisation.stage]?.label ?? organisation.stage}</span>}
                        </div>
                        <p className={`text-xs ${organisation.stage === "needs_attention" ? "text-red-700" : "text-muted"}`}>{integrationSyncSummary(organisation)}</p>
                        {organisation.sync?.integrity && (organisation.sync.integrity.issues.length === 0
                          ? <p className="text-xs font-semibold text-emerald-700">✓ Data integrity: {organisation.sync.integrity.passed}/{organisation.sync.integrity.total} reconciliations passed</p>
                          : <p className="text-xs font-semibold text-amber-800">⚠ Data integrity: {organisation.sync.integrity.passed}/{organisation.sync.integrity.total} passed — review {organisation.sync.integrity.issues.map((issue) => issue.name).join(", ")}</p>)}
                        {organisation.change && organisation.change.recordsDelta !== 0 && (
                          <p className={`text-xs ${organisation.change.recordsDelta < 0 ? "font-semibold text-amber-800" : "text-muted"}`}>
                            {organisation.change.recordsDelta < 0 ? "⚠ " : ""}
                            {organisation.change.recordsDelta > 0 ? "+" : ""}{organisation.change.recordsDelta} records vs last sync{organisation.change.sinceDate ? ` (${new Date(organisation.change.sinceDate).toLocaleDateString("en-GB")})` : ""}
                            {organisation.change.recordsDelta < 0 ? " — fewer than before; check for a partial sync" : ""}
                          </p>
                        )}
                      </div>
                      <div className="flex gap-2">
                        {integration.provider === "xero" && !organisation.selected && <button className="rounded-lg border border-line px-3 py-2 text-xs font-bold" disabled={integrationBusy} onClick={() => selectXeroOrganisation(organisation.id)}>Select</button>}
                        {organisation.selected && <>
                          {organisation.stage === "reauth_required" && integration.connectUrl
                            ? <a className="rounded-lg bg-red-600 px-3 py-2 text-xs font-bold text-white" href={integration.connectUrl}>Reconnect</a>
                            : <button className="rounded-lg bg-brand px-3 py-2 text-xs font-bold text-white" disabled={integrationBusy} onClick={() => syncProvider(integration.provider)}>{organisation.stage === "needs_attention" ? "Retry sync" : "Sync now"}</button>}
                          <button className="rounded-lg border border-red-200 px-3 py-2 text-xs font-bold text-red-700" disabled={integrationBusy} onClick={() => disconnectProvider(integration.provider, organisation.id)}>Disconnect</button>
                        </>}
                      </div>
                    </div>
                  ))}
                </div>
              ) : integration.connectUrl ? (
                <a className="mt-3 inline-block rounded-lg bg-brand px-3 py-2 text-sm font-bold text-white" href={integration.connectUrl}>Connect {integration.label}</a>
              ) : integration.configured && !canConnectLiveIntegration ? (
                <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
                  <p><strong>Create your workspace to connect {integration.label}.</strong> This is the read-only sample workspace, so it can&apos;t hold a live accounting connection. Start your own workspace and its data will sync here.</p>
                  {!presentationMode
                    ? <button className="mt-2 rounded-lg bg-amber-600 px-3 py-2 text-xs font-bold text-white" onClick={() => setActive("Onboarding")}>Create a workspace</button>
                    : <a className="mt-2 inline-block rounded-lg bg-amber-600 px-3 py-2 text-xs font-bold text-white" href="/login">Sign in to get started</a>}
                </div>
              ) : (
                <button className="mt-3 rounded-lg border border-line bg-white px-3 py-2 text-sm font-bold disabled:cursor-not-allowed disabled:text-muted" disabled>{integration.configured ? "Connector unavailable" : "Awaiting credentials"}</button>
              )}
            </div>
          ))}
          {!integrations.length && <p className="text-sm text-muted">Integration status is unavailable.</p>}
          <p className="text-xs text-muted">Using <span className="font-semibold">Sage 50</span> (desktop)? It has no cloud connection — export your trial balance / P&amp;L / balance sheet and upload them; ClosePilot builds the same review and accounts from the files.</p>
          {integrationMessage && <p className="rounded-lg border border-line bg-white p-3 text-sm font-semibold">{integrationMessage}</p>}
          {integrationActivity.length > 0 && (
            <div className="rounded-lg border border-line bg-slate-50 p-3">
              <p className="text-xs font-bold uppercase tracking-wide text-muted">Recent activity</p>
              <ul className="mt-2 grid gap-1">
                {integrationActivity.map((event, index) => (
                  <li key={`${event.action}-${event.at}-${index}`} className="flex items-center justify-between gap-3 text-xs">
                    <span className="font-semibold">{integrationActivityLabel(event.action)}</span>
                    <span className="text-muted">{new Date(event.at).toLocaleString("en-GB")}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[11px] text-muted">Connect, sync and disconnect events are recorded for this workspace — disconnecting keeps the reviews and accounts already produced.</p>
            </div>
          )}
          {canConnectLiveIntegration && integrations.some((integration) => (integration.organisations?.length ?? 0) > 0) && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3">
              <p className="text-xs font-bold uppercase tracking-wide text-red-700">Erase synced data</p>
              <p className="mt-1 text-xs text-red-950">Permanently delete all accounting data synced for <span className="font-semibold">{company.name}</span> — imported trial balances, VAT evidence and the reviews built from them — and remove its connections. This <span className="font-semibold">cannot be undone</span>. Uploaded files and manual work are not affected. To simply stop syncing while keeping the evidence, use <span className="font-semibold">Disconnect</span> above.</p>
              <button className="mt-2 rounded-lg border border-red-300 bg-white px-3 py-2 text-xs font-bold text-red-700 disabled:opacity-50" disabled={integrationBusy} onClick={eraseIntegrationData}>Erase synced data…</button>
            </div>
          )}
        </div>
      </Panel>

      <div className="flex items-center gap-3">
        <button className="rounded-lg bg-brand px-5 py-3 font-bold text-white" onClick={save}>Save Settings</button>
        {saved && <span className="text-sm font-bold text-emerald-700">Settings saved.</span>}
      </div>
    </div>
  );
}
