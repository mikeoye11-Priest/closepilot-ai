"use client";

type Variant = "management" | "statutory";

const CONFIG: Record<Variant, { eyebrow: string; title: string; route: string; blurb: string; contents: string[] }> = {
  management: {
    eyebrow: "Accounts Production",
    title: "Management Accounts",
    route: "/api/reports/management-accounts",
    blurb: "Generate a client-ready management accounts pack directly from the connected Xero ledger — no re-keying. Built from the latest completed sync.",
    contents: [
      "AI-drafted commentary, grounded in the figures (review before issuing)",
      "Profit & loss with gross and net profit",
      "Balance sheet with net current assets and net assets",
      "Cash position, bank reconciliation and aged debtors/creditors",
      "KPIs: gross/net margin, current ratio, debtor & creditor days",
      "Notes to the accounts (turnover, debtors, creditors, fixed assets, policies)",
    ],
  },
  statutory: {
    eyebrow: "Accounts Production",
    title: "Financial Accounts (Statutory)",
    route: "/api/reports/financial-accounts",
    blurb: "Draft statutory financial statements in FRS 102 Section 1A (small company) format from the connected Xero ledger — for review before filing.",
    contents: [
      "Statement of Financial Position (statutory balance sheet format)",
      "Income Statement (turnover → gross profit → operating profit)",
      "Notes to the financial statements (policies, turnover, debtors, creditors, fixed assets)",
      "Accounting policies under FRS 102 Section 1A",
      "Directors' approval and small-company audit-exemption statement",
    ],
  },
};

export function ManagementAccountsPanel({ tenantId, companyId, companyName, variant = "management" }: { tenantId: string; companyId: string; companyName: string; variant?: Variant }) {
  const config = CONFIG[variant];
  const base = `${config.route}?${new URLSearchParams({ tenantId, companyId }).toString()}`;
  const openPdf = () => window.open(`${base}&print=1`, "_blank", "noopener,noreferrer");
  const openView = () => window.open(base, "_blank", "noopener,noreferrer");
  const downloadWord = () => {
    const anchor = document.createElement("a");
    anchor.href = `${base}&format=doc`;
    anchor.rel = "noopener";
    anchor.click();
  };

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <div className="rounded-2xl border border-line bg-white p-6 shadow-sm">
        <p className="text-xs font-black uppercase tracking-wider text-brand">{config.eyebrow}</p>
        <h1 className="mt-1 text-2xl font-black text-ink">{config.title}</h1>
        <p className="mt-2 max-w-2xl text-sm text-slate-600">
          {config.blurb.replace("the connected Xero ledger", "")}for <span className="font-bold">{companyName}</span> from the connected Xero ledger.
        </p>

        <div className="mt-5 grid gap-2 sm:grid-cols-2">
          {config.contents.map((item) => (
            <div key={item} className="flex items-start gap-2 text-sm text-slate-700">
              <span className="mt-0.5 text-brand">✓</span>
              <span>{item}</span>
            </div>
          ))}
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          <button className="rounded-lg bg-brand px-4 py-2 text-sm font-bold text-white shadow-sm transition-colors hover:bg-blue-700" onClick={openPdf}>
            Open pack — Save as PDF
          </button>
          <button className="rounded-lg border border-brand px-4 py-2 text-sm font-bold text-brand" onClick={downloadWord}>
            Download Word (.doc)
          </button>
          <button className="rounded-lg border border-line px-4 py-2 text-sm font-bold text-slate-700" onClick={openView}>
            Preview in browser
          </button>
        </div>

        <p className="mt-4 text-xs text-slate-500">
          {variant === "statutory"
            ? "Draft statutory statements for review. Tax, directors' report and full statutory disclosures remain the preparer's responsibility before filing."
            : "The pack is prepared for internal management purposes; any AI-drafted narrative is grounded in the figures and must be reviewed before issue."}
          {" "}Reflects the most recent Xero sync — if it looks out of date, run <span className="font-semibold">Settings → Sync now</span> first.
        </p>
      </div>
    </div>
  );
}
