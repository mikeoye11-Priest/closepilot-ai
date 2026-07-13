// Statutory financial accounts (FRS 102 Section 1A, small company format)
// generated from the synced Xero ledger, with prior-period comparatives.
// Reuses the management-accounts data engine and re-presents it in statutory
// statement layouts with notes and an approval block. Deterministic — no AI.

import { buildManagementAccounts, type SyncStatements } from "./management-accounts";

type Line = { name: string; amount: number; prior: number };
type StatNote = { title: string; body?: string; rows?: { label: string; value: number; prior?: number; strong?: boolean }[] };

const esc = (value: string) => value.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
const money = (value: number) => {
  const rounded = Math.round(value);
  const body = Math.abs(rounded).toLocaleString("en-GB");
  return rounded < 0 ? `(${body})` : `${body}`;
};
const flat = (sections: { lines: Line[] }[]): Line[] => sections.flatMap((s) => s.lines);
const sum = (lines: Line[], key: "amount" | "prior" = "amount") => lines.reduce((total, line) => total + line[key], 0);

export function buildStatutoryAccounts(statements: SyncStatements) {
  const ma = buildManagementAccounts(statements);
  const { pl, bs, prior } = ma;

  const cashSections = bs.currentAssets.filter((s) => /bank|cash/i.test(s.title));
  const debtorSections = bs.currentAssets.filter((s) => !/bank|cash/i.test(s.title));
  const cashLines = flat(cashSections);
  const debtorLines = flat(debtorSections);

  const sofp = {
    tangibleFixedAssets: bs.totalFixed, priorTangible: bs.priorFixed,
    debtors: sum(debtorLines), priorDebtors: sum(debtorLines, "prior"),
    cash: sum(cashLines), priorCash: sum(cashLines, "prior"),
    currentAssetsTotal: bs.totalCurrentAssets, priorCurrentAssets: bs.priorCurrentAssets,
    creditorsWithinYear: bs.totalLiabilities, priorCreditors: bs.priorLiabilities,
    netCurrentAssets: bs.totalCurrentAssets - bs.totalLiabilities, priorNetCurrentAssets: bs.priorCurrentAssets - bs.priorLiabilities,
    totalAssetsLessCurrentLiabilities: bs.totalFixed + (bs.totalCurrentAssets - bs.totalLiabilities), priorTALCL: bs.priorFixed + (bs.priorCurrentAssets - bs.priorLiabilities),
    netAssets: bs.netAssets, priorNetAssets: bs.priorNetAssets,
    equityLines: flat(bs.equity),
    totalEquity: bs.totalEquity, priorEquity: bs.priorEquity,
  };

  const incomeStatement = {
    turnover: pl.revenue, priorTurnover: prior.revenue,
    costOfSales: pl.cogs, priorCostOfSales: prior.cogs,
    grossProfit: pl.grossProfit, priorGrossProfit: prior.grossProfit,
    adminExpenses: pl.overheads, priorAdminExpenses: prior.overheads,
    operatingProfit: pl.grossProfit + pl.overheads, priorOperatingProfit: prior.grossProfit + prior.overheads,
    profitForYear: pl.netProfit, priorProfitForYear: prior.netProfit,
  };

  const notes: StatNote[] = [
    { title: "Accounting policies", body: "Basis of preparation — These financial statements have been prepared in accordance with FRS 102 Section 1A 'Small Entities' and the Companies Act 2006, under the historical cost convention. They have been drafted by ClosePilot from the accounting records maintained in Xero and are subject to the accountant's review and the directors' approval. Turnover represents amounts receivable for goods and services, net of VAT. Tangible fixed assets are stated at cost less accumulated depreciation. Debtors and creditors are recognised at amortised cost." },
    { title: "Turnover", body: "Turnover recognised in the period, analysed by class.", rows: flat(pl.income).map((l) => ({ label: l.name, value: l.amount, prior: l.prior })) },
    ...(bs.fixedAssets.length ? [{ title: "Tangible fixed assets", body: "Net book value by class of asset.", rows: [...flat(bs.fixedAssets).map((l) => ({ label: l.name, value: l.amount, prior: l.prior })), { label: "Net book value", value: bs.totalFixed, prior: bs.priorFixed, strong: true }] }] : []),
    { title: "Debtors: amounts falling due within one year", rows: [{ label: "Trade and other debtors", value: sofp.debtors, prior: sofp.priorDebtors, strong: true }] },
    { title: "Creditors: amounts falling due within one year", rows: [...flat(bs.liabilities).map((l) => ({ label: l.name, value: l.amount, prior: l.prior })), { label: "", value: bs.totalLiabilities, prior: bs.priorLiabilities, strong: true }] },
    { title: "Capital and reserves", rows: [...sofp.equityLines.map((l) => ({ label: l.name, value: l.amount, prior: l.prior })), { label: "Shareholders' funds", value: bs.totalEquity, prior: bs.priorEquity, strong: true }] },
  ];

  return { meta: ma.meta, sofp, incomeStatement, notes, hasComparatives: prior.hasComparatives, balanced: Math.abs(bs.netAssets - bs.totalEquity) <= 1 };
}

// ── Rendering ────────────────────────────────────────────────────────────────

export function renderStatutoryAccountsHtml(pack: ReturnType<typeof buildStatutoryAccounts>, options: { autoPrint?: boolean } = {}): string {
  const { meta, sofp, incomeStatement: is, notes, hasComparatives } = pack;
  const asOf = new Date(meta.asOfDate).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const priorYear = Number(meta.asOfDate.slice(0, 4)) - 1;
  const priorAsOf = new Date(`${priorYear}${meta.asOfDate.slice(4)}`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

  const priorCol = (value: number | null) => (hasComparatives ? `<td class="num">${value === null ? "" : money(value)}</td>` : "");
  const row = (label: string, value: number | null, prior: number | null, cls = "") => `<tr class="${cls}"><td>${esc(label)}</td><td class="num">${value === null ? "" : money(value)}</td>${priorCol(prior)}</tr>`;
  const colHead = hasComparatives
    ? `<tr class="colhead"><td></td><td class="num">${esc(asOf)}</td><td class="num">${esc(priorAsOf)}</td></tr>`
    : `<tr class="colhead"><td></td><td class="num">${esc(asOf)}</td></tr>`;
  const noteRow = (r: { label: string; value: number; prior?: number; strong?: boolean }) => row(r.label, r.value, r.prior ?? null, r.strong ? "sub strong" : "indent");

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(meta.companyName)} — Financial Statements</title>
<style>
  :root { --ink:#0f172a; --muted:#64748b; --line:#cbd5e1; --bg:#ffffff; }
  * { box-sizing:border-box; }
  body { font-family: Georgia, "Times New Roman", serif; color:var(--ink); background:#f1f5f9; margin:0; }
  .page { max-width: 800px; margin: 24px auto; background:var(--bg); padding: 56px 64px; box-shadow:0 1px 3px rgba(0,0,0,.1); }
  .cover { min-height: 60vh; display:flex; flex-direction:column; justify-content:center; text-align:center; page-break-after: always; }
  .cover h1 { font-size: 30px; margin: 0 0 8px; }
  .cover .kind { text-transform:uppercase; letter-spacing:.18em; font-size:12px; color:var(--muted); }
  .cover .period { margin-top: 14px; font-size:15px; color:var(--muted); }
  h2 { font-size: 16px; margin: 36px 0 6px; }
  .sub { color:var(--muted); font-size:12px; margin: 0 0 14px; }
  table { width:100%; border-collapse:collapse; font-size:13px; font-variant-numeric:tabular-nums; }
  td { padding: 5px 6px; }
  .num { text-align:right; white-space:nowrap; font-family:"Inter",system-ui,sans-serif; }
  tr.colhead td { border-bottom:1px solid var(--ink); font-weight:700; font-size:11px; color:var(--muted); }
  tr.head td { color:var(--muted); font-weight:700; padding-top:12px; }
  tr.indent td:first-child { padding-left: 20px; }
  tr.sub td { border-top:1px solid var(--line); }
  tr.total td { border-top:1px solid var(--ink); border-bottom:3px double var(--ink); font-weight:700; }
  tr.strong td { font-weight:700; }
  .note-block { margin-bottom: 16px; }
  .note-block h3 { font-size:13px; margin: 14px 0 4px; }
  .note-block p { font-size:12px; line-height:1.6; color:#334155; margin: 0 0 6px; }
  .note-block table { max-width: 520px; }
  .approval { margin-top: 28px; border-top:1px solid var(--line); padding-top:14px; font-size:12px; line-height:1.6; }
  .sig { margin-top: 26px; }
  .sig .line { border-bottom:1px solid var(--ink); width: 240px; margin-top: 26px; }
  footer { margin-top: 34px; border-top:1px solid var(--line); padding-top:10px; color:var(--muted); font-size:11px; }
  .toolbar { max-width:800px; margin:16px auto -8px; text-align:right; }
  .toolbar button { background:#1d4ed8; color:#fff; border:0; border-radius:8px; padding:8px 16px; font-weight:700; font-family:system-ui; cursor:pointer; }
  @media print { body{background:#fff;} .page{box-shadow:none;margin:0;max-width:none;padding:0 14mm;} .toolbar{display:none;} h2{page-break-after:avoid;} table{page-break-inside:avoid;} }
</style></head>
<body>
<div class="toolbar"><button onclick="window.print()">Save as PDF / Print</button></div>
<div class="page">
  <div class="cover">
    <div class="kind">Financial Statements</div>
    <h1>${esc(meta.companyName)}</h1>
    <div class="period">For the period ended ${asOf}</div>
    <div class="period" style="margin-top:24px;font-size:12px">Prepared under FRS 102 Section 1A — Small Entities${hasComparatives ? ` · with ${priorYear} comparatives` : ""}</div>
    <div class="period" style="font-size:12px">Draft prepared by ClosePilot from the Xero ledger — subject to review and approval</div>
  </div>

  <h2>Statement of Financial Position</h2>
  <p class="sub">As at ${asOf}</p>
  <table>
    ${colHead}
    <tr class="head"><td>Fixed assets</td><td></td>${hasComparatives ? "<td></td>" : ""}</tr>
    ${row("Tangible assets", sofp.tangibleFixedAssets, sofp.priorTangible, "indent")}
    <tr class="head"><td>Current assets</td><td></td>${hasComparatives ? "<td></td>" : ""}</tr>
    ${row("Debtors", sofp.debtors, sofp.priorDebtors, "indent")}
    ${row("Cash at bank and in hand", sofp.cash, sofp.priorCash, "indent")}
    ${row("Total current assets", sofp.currentAssetsTotal, sofp.priorCurrentAssets, "sub indent")}
    ${row("Creditors: amounts falling due within one year", -sofp.creditorsWithinYear, -sofp.priorCreditors, "indent")}
    ${row("Net current assets", sofp.netCurrentAssets, sofp.priorNetCurrentAssets, "sub strong")}
    ${row("Total assets less current liabilities", sofp.totalAssetsLessCurrentLiabilities, sofp.priorTALCL, "strong")}
    ${row("Net assets", sofp.netAssets, sofp.priorNetAssets, "total")}
    <tr class="head"><td>Capital and reserves</td><td></td>${hasComparatives ? "<td></td>" : ""}</tr>
    ${sofp.equityLines.map((l) => row(l.name, l.amount, l.prior, "indent")).join("")}
    ${row("Shareholders' funds", sofp.totalEquity, sofp.priorEquity, "total")}
  </table>

  <h2>Income Statement</h2>
  <p class="sub">For the period ended ${asOf}</p>
  <table>
    ${colHead}
    ${row("Turnover", is.turnover, is.priorTurnover)}
    ${row("Cost of sales", is.costOfSales, is.priorCostOfSales)}
    ${row("Gross profit", is.grossProfit, is.priorGrossProfit, "sub strong")}
    ${row("Administrative expenses", is.adminExpenses, is.priorAdminExpenses)}
    ${row("Operating profit", is.operatingProfit, is.priorOperatingProfit, "sub strong")}
    ${row("Profit for the financial period", is.profitForYear, is.priorProfitForYear, "total")}
  </table>

  <h2>Notes to the Financial Statements</h2>
  ${notes.map((n, i) => `<div class="note-block"><h3>${i + 1}. ${esc(n.title)}</h3>${n.body ? `<p>${esc(n.body)}</p>` : ""}${n.rows?.length ? `<table>${hasComparatives ? `<tr class="colhead"><td></td><td class="num">${meta.asOfDate.slice(0, 4)}</td><td class="num">${priorYear}</td></tr>` : ""}${n.rows.map(noteRow).join("")}</table>` : ""}</div>`).join("")}

  <div class="approval">
    <strong>Approval</strong>
    <p>These financial statements have been prepared in accordance with the provisions applicable to companies subject to the small companies regime and in accordance with FRS 102 Section 1A. For the period ended ${asOf} the company was entitled to exemption from audit under section 477 of the Companies Act 2006. The members have not required the company to obtain an audit of its financial statements.</p>
    <p>The financial statements were approved by the board of directors and authorised for issue.</p>
    <div class="sig"><div class="line"></div>Director &nbsp;·&nbsp; Date: ______________</div>
  </div>

  ${pack.balanced ? "" : `<p class="sub" style="color:#b91c1c">Note: net assets and shareholders' funds do not agree — review before approval.</p>`}

  <footer>
    Draft generated by ClosePilot from the connected Xero ledger for accounts-production purposes. Statutory disclosures, tax and directors' report remain the responsibility of the preparer and must be reviewed before filing. Figures are presented to the nearest £; brackets denote negatives/liabilities.
  </footer>
</div>
${options.autoPrint ? "<script>window.addEventListener('load',()=>window.print());</script>" : ""}
</body></html>`;
}
