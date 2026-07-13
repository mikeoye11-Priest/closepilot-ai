"use client";

export function ManagementAccountsPanel({ tenantId, companyId, companyName }: { tenantId: string; companyId: string; companyName: string }) {
  const base = `/api/reports/management-accounts?${new URLSearchParams({ tenantId, companyId }).toString()}`;
  const openPdf = () => window.open(`${base}&print=1`, "_blank", "noopener,noreferrer");
  const openView = () => window.open(base, "_blank", "noopener,noreferrer");
  const downloadWord = () => {
    const anchor = document.createElement("a");
    anchor.href = `${base}&format=doc`;
    anchor.rel = "noopener";
    anchor.click();
  };

  const contents = [
    "AI-drafted commentary, grounded in the figures (review before issuing)",
    "Profit & loss with gross and net profit",
    "Balance sheet with net current assets and net assets",
    "Cash position, bank reconciliation and aged debtors/creditors",
    "KPIs: gross/net margin, current ratio, debtor & creditor days",
    "Notes to the accounts (turnover, debtors, creditors, fixed assets, policies)",
  ];

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <div className="rounded-2xl border border-line bg-white p-6 shadow-sm">
        <p className="text-xs font-black uppercase tracking-wider text-brand">Accounts Production</p>
        <h1 className="mt-1 text-2xl font-black text-ink">Management Accounts</h1>
        <p className="mt-2 max-w-2xl text-sm text-slate-600">
          Generate a client-ready management accounts pack for <span className="font-bold">{companyName}</span> directly
          from the connected Xero ledger — no re-keying. Built from the latest completed sync.
        </p>

        <div className="mt-5 grid gap-2 sm:grid-cols-2">
          {contents.map((item) => (
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
          Reflects the most recent Xero sync for this company. If it looks out of date, run <span className="font-semibold">Settings → Sync now</span> first.
          The pack is prepared for internal management purposes; professional sign-off remains with the preparer.
        </p>
      </div>
    </div>
  );
}
