"use client";

import { useMemo, useState } from "react";
import { recentPeriods, PERIOD_COUNTS, type ReportFrequency } from "@/lib/vat-periods";

type Variant = "management" | "statutory" | "full";

const PERIOD_FREQUENCIES: ReportFrequency[] = ["monthly", "quarterly", "annual"];

const CONFIG: Record<Variant, { eyebrow: string; title: string; route: string; extra?: string; blurb: string; contents: string[] }> = {
  management: {
    eyebrow: "Accounts Production",
    title: "Management Accounts",
    route: "/api/reports/management-accounts",
    blurb: "A client-ready management accounts pack, generated directly from the connected Xero ledger — no re-keying. Built from the latest completed sync.",
    contents: [
      "AI-drafted commentary, grounded in the figures (review before issuing)",
      "Profit & loss with gross and net profit",
      "Balance sheet with net current assets and net assets",
      "Cash position, bank reconciliation and aged debtors/creditors",
      "KPIs: gross/net margin, current ratio, debtor & creditor days",
      "Prior-period comparatives and notes to the accounts",
    ],
  },
  statutory: {
    eyebrow: "Accounts Production",
    title: "Financial Accounts (Statutory)",
    route: "/api/reports/financial-accounts",
    blurb: "Draft statutory financial statements in FRS 102 Section 1A (small company) format from the connected Xero ledger — for review before filing.",
    contents: [
      "Statement of Financial Position + Income Statement (with prior-year comparatives)",
      "Directors' report and accounting policies (FRS 102 Section 1A)",
      "Notes to the financial statements",
      "Corporation tax computation (capital allowances, marginal relief, period-pro-rated)",
      "Draft CT600 corporation tax return (principal boxes + supporting computation)",
      "Directors' approval and small-company audit-exemption statement",
    ],
  },
  full: {
    eyebrow: "Accounts Production",
    title: "Financial Accounts (Full FRS 102)",
    route: "/api/reports/financial-accounts",
    extra: "&basis=full",
    blurb: "Draft full FRS 102 financial statements for companies above the small-company thresholds — including the primary statements a small company is exempt from.",
    contents: [
      "Statement of Financial Position + Income Statement (with comparatives)",
      "Statement of Changes in Equity and Statement of Cash Flows (indirect)",
      "Strategic report and directors' report",
      "Fuller notes (employees, directors' remuneration, related parties) + tax computation",
      "Corporation tax computation (capital allowances, marginal relief) + draft CT600",
      "Subject to audit — no small-company exemption",
    ],
  },
};

function FormatCard({ title, sub, onClick, tone = "default" }: { title: string; sub: string; onClick: () => void; tone?: "primary" | "default" | "amber" }) {
  const tones = {
    primary: "border-brand bg-brand/5 hover:bg-brand/10",
    default: "border-line bg-white hover:bg-slate-50",
    amber: "border-amber-300 bg-amber-50 hover:bg-amber-100",
  } as const;
  const titleTone = tone === "primary" ? "text-brand" : tone === "amber" ? "text-amber-800" : "text-ink";
  return (
    <button onClick={onClick} className={`flex flex-col items-start rounded-xl border px-4 py-3 text-left transition-colors ${tones[tone]}`}>
      <span className={`text-sm font-black ${titleTone}`}>{title}</span>
      <span className="mt-0.5 text-xs text-slate-500">{sub}</span>
    </button>
  );
}

export function ManagementAccountsPanel({ tenantId, companyId, companyName, variant = "management" }: { tenantId: string; companyId: string; companyName: string; variant?: Variant }) {
  const config = CONFIG[variant];
  const base = `${config.route}?${new URLSearchParams({ tenantId, companyId }).toString()}${config.extra ?? ""}`;

  // Reporting-period override — sets the accounts' "as at" date (year-to-date
  // basis). "auto" uses the period from the latest sync / uploaded documents.
  const [periodFrequency, setPeriodFrequency] = useState<"auto" | ReportFrequency>("auto");
  const [periodValue, setPeriodValue] = useState("");
  const periods = useMemo(() => (periodFrequency === "auto" ? [] : recentPeriods(periodFrequency, PERIOD_COUNTS[periodFrequency])), [periodFrequency]);
  const chosenEnd = periodFrequency === "auto" ? "" : periods.find((period) => period.value === periodValue)?.end ?? periods[0]?.end ?? "";
  const periodExtra = chosenEnd ? `&asOfDate=${chosenEnd}` : "";

  const open = (extra = "") => window.open(`${base}${periodExtra}${extra}`, "_blank", "noopener,noreferrer");
  const download = (extra: string) => {
    const anchor = document.createElement("a");
    anchor.href = `${base}${periodExtra}${extra}`;
    anchor.rel = "noopener";
    anchor.click();
  };
  const changePeriodFrequency = (next: "auto" | ReportFrequency) => {
    setPeriodFrequency(next);
    setPeriodValue(next === "auto" ? "" : recentPeriods(next, PERIOD_COUNTS[next])[0]?.value ?? "");
  };

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <div className="overflow-hidden rounded-2xl border border-line bg-white shadow-sm">
        <div className="border-b border-line bg-gradient-to-br from-brand/5 to-transparent px-6 py-5">
          <p className="text-xs font-black uppercase tracking-wider text-brand">{config.eyebrow}</p>
          <h1 className="mt-1 text-2xl font-black text-ink">{config.title}</h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-600">
            <span className="font-bold">{companyName}</span> — {config.blurb}
          </p>
        </div>

        <div className="px-6 py-5">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-500">What's included</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {config.contents.map((item) => (
              <div key={item} className="flex items-start gap-2 text-sm text-slate-700">
                <span className="mt-0.5 shrink-0 text-brand">✓</span>
                <span>{item}</span>
              </div>
            ))}
          </div>

          <p className="mt-6 text-xs font-bold uppercase tracking-wider text-slate-500">Reporting period</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <select className="rounded-lg border border-line bg-white px-3 py-2 text-sm" value={periodFrequency} onChange={(event) => changePeriodFrequency(event.target.value as "auto" | ReportFrequency)}>
              <option value="auto">Auto (from data)</option>
              {PERIOD_FREQUENCIES.map((frequency) => <option key={frequency} value={frequency}>{frequency[0].toUpperCase() + frequency.slice(1)}</option>)}
            </select>
            <select className="rounded-lg border border-line bg-white px-3 py-2 text-sm disabled:bg-slate-50 disabled:text-slate-400" value={periodValue} disabled={periodFrequency === "auto"} onChange={(event) => setPeriodValue(event.target.value)}>
              {periodFrequency === "auto"
                ? <option value="">As synced / uploaded</option>
                : periods.map((period) => <option key={period.value} value={period.value}>{period.label}</option>)}
            </select>
            <span className="text-xs text-slate-500">Year-to-date to the chosen period end.</span>
          </div>

          <p className="mt-6 text-xs font-bold uppercase tracking-wider text-slate-500">Download or view</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <FormatCard title="PDF" sub="Print-ready · opens in a tab" tone="primary" onClick={() => open("&print=1")} />
            <FormatCard title="Word (.doc)" sub="Editable in Microsoft Word" onClick={() => download("&format=doc")} />
            <FormatCard title="Excel (.xlsx)" sub="Formatted · live formulas" onClick={() => download("&format=xlsx")} />
            <FormatCard title="Preview" sub="View in the browser" onClick={() => open("")} />
            {(variant === "statutory" || variant === "full") && <FormatCard title="CT600 (draft)" sub="Corporation tax return" tone="amber" onClick={() => open("&format=ct600")} />}
            {(variant === "statutory" || variant === "full") && <FormatCard title="iXBRL (draft)" sub="For Companies House filing" tone="amber" onClick={() => download("&format=ixbrl")} />}
          </div>

          <p className="mt-5 text-xs text-slate-500">
            {variant !== "management"
              ? "Draft statutory statements for review. Tax, directors'/strategic report, audit and full disclosures remain the preparer's responsibility before filing; the iXBRL must be validated against a filing checker."
              : "Prepared for internal management purposes; any AI-drafted narrative is grounded in the figures and must be reviewed before issue."}
            {" "}Reflects the most recent Xero sync — if it looks out of date, run <span className="font-semibold">Settings → Sync now</span> first.
          </p>
        </div>
      </div>
    </div>
  );
}
