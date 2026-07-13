"use client";

type Variant = "management" | "statutory";

const CONFIG: Record<Variant, { eyebrow: string; title: string; route: string; blurb: string; contents: string[] }> = {
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
      "Corporation tax computation (marginal relief, period-pro-rated)",
      "Directors' approval and small-company audit-exemption statement",
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
  const base = `${config.route}?${new URLSearchParams({ tenantId, companyId }).toString()}`;
  const open = (extra = "") => window.open(`${base}${extra}`, "_blank", "noopener,noreferrer");
  const download = (extra: string) => {
    const anchor = document.createElement("a");
    anchor.href = `${base}${extra}`;
    anchor.rel = "noopener";
    anchor.click();
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

          <p className="mt-6 text-xs font-bold uppercase tracking-wider text-slate-500">Download or view</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <FormatCard title="PDF" sub="Print-ready · opens in a tab" tone="primary" onClick={() => open("&print=1")} />
            <FormatCard title="Word (.doc)" sub="Editable in Microsoft Word" onClick={() => download("&format=doc")} />
            <FormatCard title="Excel (.xlsx)" sub="Formatted · live formulas" onClick={() => download("&format=xlsx")} />
            <FormatCard title="Preview" sub="View in the browser" onClick={() => open("")} />
            {variant === "statutory" && <FormatCard title="iXBRL (draft)" sub="For Companies House filing" tone="amber" onClick={() => download("&format=ixbrl")} />}
          </div>

          <p className="mt-5 text-xs text-slate-500">
            {variant === "statutory"
              ? "Draft statutory statements for review. Tax, directors' report and full disclosures remain the preparer's responsibility before filing; the iXBRL must be validated against a filing checker."
              : "Prepared for internal management purposes; any AI-drafted narrative is grounded in the figures and must be reviewed before issue."}
            {" "}Reflects the most recent Xero sync — if it looks out of date, run <span className="font-semibold">Settings → Sync now</span> first.
          </p>
        </div>
      </div>
    </div>
  );
}
