// Management accounts pack generated from the synced Xero statement rows.
// Produces a structured pack (P&L, balance sheet, cash, aged analysis, KPIs) and
// a self-contained, print-ready HTML document (Save-as-PDF or open as Word).

type Row = Record<string, string>;

export type SyncStatements = {
  asOfDate: string;
  currency?: string;
  companyName?: string;
  profitLoss: Row[];
  balanceSheet: Row[];
  agedDebtors: Row[];
  agedCreditors: Row[];
  bank: Row[];
  trialBalance: Row[];
};

type Line = { name: string; amount: number };
type Section = { title: string; lines: Line[]; total: number };

const num = (value: unknown): number => {
  const parsed = Number(String(value ?? "").replace(/[£$,\s]/g, "").replace(/^\((.*)\)$/, "-$1"));
  return Number.isFinite(parsed) ? parsed : 0;
};
const sumSections = (sections: Section[]) => sections.reduce((total, section) => total + section.total, 0);

function groupSections(rows: Row[], categoryKey: string, nameKey: string): Section[] {
  const map = new Map<string, Line[]>();
  for (const row of rows) {
    const title = String(row[categoryKey] ?? "").trim() || "Other";
    const name = String(row[nameKey] ?? "").trim();
    if (!name) continue;
    const lines = map.get(title) ?? [];
    lines.push({ name, amount: num(row.amount) });
    map.set(title, lines);
  }
  return [...map.entries()].map(([title, lines]) => ({ title, lines, total: lines.reduce((sum, line) => sum + line.amount, 0) }));
}

function buildProfitAndLoss(rows: Row[]) {
  const sections = groupSections(rows, "category", "description");
  const isIncome = (t: string) => /income|revenue|turnover|sales/i.test(t) && !/cost of (sales|goods)/i.test(t);
  const isCogs = (t: string) => /cost of (sales|goods)/i.test(t);
  const income = sections.filter((s) => isIncome(s.title));
  const costOfSales = sections.filter((s) => isCogs(s.title));
  const expenses = sections.filter((s) => !isIncome(s.title) && !isCogs(s.title));
  const revenue = sumSections(income);
  const cogs = sumSections(costOfSales); // negative
  const grossProfit = revenue + cogs;
  const overheads = sumSections(expenses); // negative
  const netProfit = revenue + cogs + overheads;
  return { income, costOfSales, expenses, revenue, cogs, grossProfit, overheads, netProfit };
}

function classifyBalance(title: string): "equity" | "liability" | "fixed" | "currentAsset" {
  const t = title.toLowerCase();
  if (/equity|capital|reserve|retained|earnings/.test(t)) return "equity";
  if (/liabilit|creditor|payable|loan|borrowing|accrual|overdraft|provision/.test(t)) return "liability";
  if (/fixed|non-current asset|intangible|tangible/.test(t)) return "fixed";
  return "currentAsset"; // assets are the residual (bank, current assets, debtors, etc.)
}

function buildBalanceSheet(rows: Row[]) {
  const sections = groupSections(rows, "category", "item");
  const fixedAssets = sections.filter((s) => classifyBalance(s.title) === "fixed");
  const currentAssets = sections.filter((s) => classifyBalance(s.title) === "currentAsset");
  const liabilities = sections.filter((s) => classifyBalance(s.title) === "liability");
  const equity = sections.filter((s) => classifyBalance(s.title) === "equity");
  const totalFixed = sumSections(fixedAssets);
  const totalCurrentAssets = sumSections(currentAssets);
  const totalAssets = totalFixed + totalCurrentAssets;
  const totalLiabilities = sumSections(liabilities);
  const netCurrentAssets = totalCurrentAssets - totalLiabilities;
  const netAssets = totalAssets - totalLiabilities;
  const totalEquity = sumSections(equity);
  return { fixedAssets, currentAssets, liabilities, equity, totalFixed, totalCurrentAssets, totalAssets, totalLiabilities, netCurrentAssets, netAssets, totalEquity };
}

function aging(rows: Row[]) {
  const buckets = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90plus: 0 };
  let total = 0;
  for (const row of rows) {
    const amount = num(row.amount);
    total += amount;
    const days = num(row.days_overdue);
    if (days <= 0) buckets.current += amount;
    else if (days <= 30) buckets.d1_30 += amount;
    else if (days <= 60) buckets.d31_60 += amount;
    else if (days <= 90) buckets.d61_90 += amount;
    else buckets.d90plus += amount;
  }
  return { total, buckets };
}

export function buildManagementAccounts(statements: SyncStatements) {
  const pl = buildProfitAndLoss(statements.profitLoss ?? []);
  const bs = buildBalanceSheet(statements.balanceSheet ?? []);
  const debtors = aging(statements.agedDebtors ?? []);
  const creditors = aging(statements.agedCreditors ?? []);
  const cashBalance = (statements.bank ?? []).reduce((sum, row) => sum + num(row.closing_balance), 0);
  const unreconciled = (statements.bank ?? []).reduce((sum, row) => sum + num(row.unreconciled_count), 0);
  const costBase = Math.abs(pl.cogs + pl.overheads);

  const kpis = {
    grossMargin: pl.revenue ? pl.grossProfit / pl.revenue : null,
    netMargin: pl.revenue ? pl.netProfit / pl.revenue : null,
    currentRatio: bs.totalLiabilities ? bs.totalCurrentAssets / bs.totalLiabilities : null,
    debtorDays: pl.revenue ? (debtors.total / pl.revenue) * 365 : null,
    creditorDays: costBase ? (creditors.total / costBase) * 365 : null,
  };

  return { meta: { companyName: statements.companyName ?? "Company", asOfDate: statements.asOfDate, currency: statements.currency ?? "GBP" }, pl, bs, debtors, creditors, cashBalance, unreconciled, kpis };
}

// ── Rendering ────────────────────────────────────────────────────────────────

const esc = (value: string) => value.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
const money = (value: number) => {
  const rounded = Math.round(value);
  const body = Math.abs(rounded).toLocaleString("en-GB");
  return rounded < 0 ? `(£${body})` : `£${body}`;
};
const pct = (value: number | null) => (value === null ? "—" : `${(value * 100).toFixed(1)}%`);
const days = (value: number | null) => (value === null ? "—" : `${Math.round(value)} days`);
const ratio = (value: number | null) => (value === null ? "—" : value.toFixed(2));

function statementRows(sections: Section[]): string {
  return sections
    .map(
      (section) => `
      <tr class="section"><td>${esc(section.title)}</td><td></td></tr>
      ${section.lines.map((line) => `<tr><td class="item">${esc(line.name)}</td><td class="num">${money(line.amount)}</td></tr>`).join("")}
      <tr class="subtotal"><td>Total ${esc(section.title)}</td><td class="num">${money(section.total)}</td></tr>`
    )
    .join("");
}

const totalRow = (label: string, value: number, cls = "total") => `<tr class="${cls}"><td>${esc(label)}</td><td class="num">${money(value)}</td></tr>`;

export function renderManagementAccountsHtml(pack: ReturnType<typeof buildManagementAccounts>, options: { autoPrint?: boolean } = {}): string {
  const { meta, pl, bs, debtors, creditors, kpis } = pack;
  const asOf = new Date(meta.asOfDate).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const kpiCard = (label: string, value: string) => `<div class="kpi"><span class="kpi-label">${label}</span><span class="kpi-value">${value}</span></div>`;
  const agingTable = (title: string, data: ReturnType<typeof aging>) => `
    <table class="aging"><caption>${title} — ${money(data.total)}</caption>
      <thead><tr><th>Current</th><th>1–30</th><th>31–60</th><th>61–90</th><th>90+</th></tr></thead>
      <tbody><tr>
        <td class="num">${money(data.buckets.current)}</td><td class="num">${money(data.buckets.d1_30)}</td>
        <td class="num">${money(data.buckets.d31_60)}</td><td class="num">${money(data.buckets.d61_90)}</td>
        <td class="num">${money(data.buckets.d90plus)}</td>
      </tr></tbody></table>`;

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(meta.companyName)} — Management Accounts</title>
<style>
  :root { --ink:#0f172a; --muted:#64748b; --line:#e2e8f0; --accent:#1d4ed8; --bg:#ffffff; }
  * { box-sizing: border-box; }
  body { font-family: "Inter", -apple-system, Segoe UI, Roboto, sans-serif; color: var(--ink); background:#f1f5f9; margin:0; }
  .page { max-width: 820px; margin: 24px auto; background: var(--bg); padding: 48px 56px; box-shadow: 0 1px 3px rgba(0,0,0,.1); }
  header { border-bottom: 3px solid var(--accent); padding-bottom: 16px; margin-bottom: 8px; }
  header .eyebrow { text-transform: uppercase; letter-spacing: .12em; font-size: 11px; color: var(--accent); font-weight: 700; }
  header h1 { font-size: 26px; margin: 6px 0 2px; }
  header .sub { color: var(--muted); font-size: 13px; }
  h2 { font-size: 15px; text-transform: uppercase; letter-spacing:.06em; margin: 34px 0 10px; padding-bottom:6px; border-bottom:1px solid var(--line); }
  table { width: 100%; border-collapse: collapse; font-size: 13px; font-variant-numeric: tabular-nums; }
  td, th { padding: 5px 8px; }
  .num { text-align: right; white-space: nowrap; }
  tr.section td { font-weight: 700; padding-top: 12px; color: var(--muted); text-transform: uppercase; font-size: 11px; letter-spacing: .05em; }
  tr td.item { padding-left: 22px; color: #334155; }
  tr.subtotal td { border-top: 1px solid var(--line); font-weight: 600; }
  tr.total td { border-top: 2px solid var(--ink); border-bottom: 2px solid var(--ink); font-weight: 800; }
  tr.headline td { border-top: 1px solid var(--line); font-weight: 800; color: var(--accent); }
  .kpis { display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px; margin: 6px 0 4px; }
  .kpi { border: 1px solid var(--line); border-radius: 10px; padding: 12px; }
  .kpi-label { display:block; font-size: 10px; text-transform: uppercase; letter-spacing:.06em; color: var(--muted); }
  .kpi-value { display:block; font-size: 20px; font-weight: 800; margin-top: 4px; }
  table.aging { margin-top: 10px; }
  table.aging caption { text-align: left; font-weight: 700; padding: 6px 0; }
  table.aging th { background:#f8fafc; text-align:right; border-bottom:1px solid var(--line); font-size:11px; color:var(--muted); }
  .note { color: var(--muted); font-size: 11px; margin-top: 8px; }
  footer { margin-top: 40px; border-top: 1px solid var(--line); padding-top: 12px; color: var(--muted); font-size: 11px; }
  .toolbar { max-width:820px; margin: 16px auto -8px; text-align:right; }
  .toolbar button { background: var(--accent); color:#fff; border:0; border-radius:8px; padding:8px 16px; font-weight:700; cursor:pointer; }
  @media print { body { background:#fff; } .page { box-shadow:none; margin:0; max-width:none; padding:0 12mm; } .toolbar { display:none; } h2 { page-break-after: avoid; } table { page-break-inside: avoid; } }
</style></head>
<body>
<div class="toolbar"><button onclick="window.print()">Save as PDF / Print</button></div>
<div class="page">
  <header>
    <div class="eyebrow">Management Accounts</div>
    <h1>${esc(meta.companyName)}</h1>
    <div class="sub">Period to ${asOf} · Prepared by ClosePilot · ${esc(meta.currency)}</div>
  </header>

  <h2>Key performance indicators</h2>
  <div class="kpis">
    ${kpiCard("Revenue", money(pl.revenue))}
    ${kpiCard("Gross margin", pct(kpis.grossMargin))}
    ${kpiCard("Net profit", money(pl.netProfit))}
    ${kpiCard("Current ratio", ratio(kpis.currentRatio))}
    ${kpiCard("Cash", money(pack.cashBalance))}
  </div>
  <div class="kpis">
    ${kpiCard("Net margin", pct(kpis.netMargin))}
    ${kpiCard("Debtor days", days(kpis.debtorDays))}
    ${kpiCard("Creditor days", days(kpis.creditorDays))}
    ${kpiCard("Debtors", money(debtors.total))}
    ${kpiCard("Creditors", money(creditors.total))}
  </div>

  <h2>Profit &amp; Loss</h2>
  <table>
    ${statementRows(pl.income)}
    ${totalRow("Revenue", pl.revenue, "headline")}
    ${pl.costOfSales.length ? statementRows(pl.costOfSales) : ""}
    ${pl.costOfSales.length ? totalRow("Gross profit", pl.grossProfit, "headline") : ""}
    ${statementRows(pl.expenses)}
    ${totalRow("Net profit", pl.netProfit, "total")}
  </table>

  <h2>Balance Sheet</h2>
  <table>
    ${bs.fixedAssets.length ? statementRows(bs.fixedAssets) : ""}
    ${bs.fixedAssets.length ? totalRow("Total fixed assets", bs.totalFixed, "headline") : ""}
    ${statementRows(bs.currentAssets)}
    ${totalRow("Total current assets", bs.totalCurrentAssets, "subtotal")}
    ${statementRows(bs.liabilities)}
    ${totalRow("Net current assets", bs.netCurrentAssets, "headline")}
    ${totalRow("Net assets", bs.netAssets, "total")}
    ${statementRows(bs.equity)}
    ${totalRow("Total equity", bs.totalEquity, "total")}
  </table>
  ${Math.abs(bs.netAssets - bs.totalEquity) > 1 ? `<p class="note">Note: net assets ${money(bs.netAssets)} and total equity ${money(bs.totalEquity)} differ by ${money(bs.netAssets - bs.totalEquity)} — review before finalising.</p>` : ""}

  <h2>Cash &amp; working capital</h2>
  ${agingTable("Aged debtors", debtors)}
  ${agingTable("Aged creditors", creditors)}
  <p class="note">Cash balance ${money(pack.cashBalance)}${pack.unreconciled ? ` · ${pack.unreconciled} unreconciled bank item(s) to clear` : " · bank reconciled"}.</p>

  <footer>
    Generated by ClosePilot from the connected Xero ledger. These management accounts are prepared for internal management purposes and are subject to review by the preparer. Figures are rounded to the nearest £.
  </footer>
</div>
${options.autoPrint ? "<script>window.addEventListener('load',()=>window.print());</script>" : ""}
</body></html>`;
}
