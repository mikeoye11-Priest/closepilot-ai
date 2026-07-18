// Draft Company Tax Return (CT600) prepared from the statutory accounts pack.
// This is a DRAFT that maps the corporation tax computation onto the principal
// CT600 boxes and prints the supporting computation alongside it. Box numbers
// follow the CT600 (2015 onward) version — check them against the current form
// before filing. It models a company with trading income only and no losses,
// group relief or other reliefs; the preparer transposes and completes it on
// HMRC's own CT600. Deterministic — no AI.

import type { buildStatutoryAccounts } from "./statutory-accounts";
import { screenShell, wordShell } from "./doc-shell";

type Pack = ReturnType<typeof buildStatutoryAccounts>;

const esc = (value: string) => value.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
const money = (value: number) => `£${Math.round(value).toLocaleString("en-GB")}`;
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

export function buildCT600(pack: Pack, opts: { companyNumber?: string; utr?: string } = {}) {
  const tc = pack.taxComputation;
  const turnover = Math.max(0, pack.incomeStatement.turnover);
  // With only trading income modelled, trading profits = profits chargeable to
  // corporation tax at every step of the chain.
  const chargeable = tc.taxableProfits;
  return {
    companyName: pack.meta.companyName,
    companyNumber: (opts.companyNumber ?? "").trim(),
    utr: (opts.utr ?? "").trim(),
    periodFrom: pack.meta.periodStart,
    periodTo: pack.meta.asOfDate,
    rate: tc.rate,
    band: tc.band,
    tc,
    // Principal CT600 boxes (2015 version numbering).
    boxes: {
      turnover: { box: "145", label: "Total turnover from trade", value: turnover },
      tradingProfits: { box: "155", label: "Trading profits", value: chargeable },
      netTradingProfits: { box: "165", label: "Net trading profits", value: chargeable },
      profitsBeforeDeductions: { box: "235", label: "Profits before other deductions and reliefs", value: chargeable },
      profitsBeforeCharges: { box: "300", label: "Profits before charges and group relief", value: chargeable },
      profitsChargeable: { box: "315", label: "Profits chargeable to corporation tax", value: chargeable },
      associatedCompanies: { box: "326", label: "Number of associated companies", value: 0 },
      corporationTax: { box: "430", label: "Corporation tax", value: tc.grossTax },
      marginalRelief: { box: "435", label: "Marginal relief", value: tc.marginalRelief },
      netCorporationTax: { box: "440", label: "Corporation tax net of marginal relief", value: tc.tax },
      taxChargeable: { box: "475", label: "Net corporation tax liability", value: tc.tax },
      taxPayable: { box: "525", label: "Tax payable", value: tc.tax },
    },
  };
}

export function renderCt600Html(ct600: ReturnType<typeof buildCT600>, options: { autoPrint?: boolean; word?: boolean } = {}): string {
  const { companyName, companyNumber, utr, periodFrom, periodTo, rate, band, tc, boxes } = ct600;
  const b = boxes;

  const css = `
  :root { --ink:#0f172a; --muted:#64748b; --line:#cbd5e1; --accent:#0b5cab; --box:#eef2f7; }
  * { box-sizing:border-box; }
  body { font-family:"Inter",system-ui,-apple-system,Segoe UI,Roboto,sans-serif; color:var(--ink); background:#f1f5f9; margin:0; font-size:13px; }
  .page { max-width:820px; margin:24px auto; background:#fff; padding:44px 52px; box-shadow:0 1px 3px rgba(0,0,0,.1); }
  header { border-bottom:3px solid var(--accent); padding-bottom:14px; margin-bottom:16px; }
  header .eyebrow { text-transform:uppercase; letter-spacing:.14em; font-size:11px; font-weight:800; color:var(--accent); }
  header h1 { font-size:23px; margin:6px 0 2px; }
  header .sub { color:var(--muted); font-size:12px; }
  .draft { background:#fef3c7; border:1px solid #f59e0b; border-radius:8px; padding:10px 14px; font-size:12px; line-height:1.5; margin-bottom:18px; }
  h2 { font-size:13px; text-transform:uppercase; letter-spacing:.06em; margin:26px 0 8px; padding-bottom:6px; border-bottom:1px solid var(--line); }
  table { width:100%; border-collapse:collapse; font-variant-numeric:tabular-nums; }
  td { padding:6px 8px; vertical-align:top; }
  .box { width:52px; }
  .box span { display:inline-block; min-width:40px; text-align:center; background:var(--box); border:1px solid var(--line); border-radius:5px; padding:2px 6px; font-weight:700; font-size:11px; color:var(--accent); }
  .lbl { color:#334155; }
  .num { text-align:right; white-space:nowrap; font-weight:600; }
  tr.sub td { border-top:1px solid var(--line); }
  tr.total td { border-top:1px solid var(--ink); border-bottom:3px double var(--ink); font-weight:800; }
  .kv { display:grid; grid-template-columns:max-content 1fr; gap:4px 16px; font-size:12px; margin:2px 0 6px; }
  .kv dt { color:var(--muted); }
  .kv dd { margin:0; font-weight:600; }
  .comp td:first-child { color:#334155; }
  .comp tr.strong td { font-weight:700; }
  .note { color:var(--muted); font-size:11px; line-height:1.6; margin-top:8px; }
  .toolbar { max-width:820px; margin:16px auto -8px; text-align:right; }
  .toolbar button { background:var(--accent); color:#fff; border:0; border-radius:8px; padding:8px 16px; font-weight:700; cursor:pointer; }
  footer { margin-top:34px; border-top:1px solid var(--line); padding-top:12px; color:var(--muted); font-size:11px; line-height:1.6; }
  @media print { body{background:#fff;} .page{box-shadow:none;margin:0;max-width:none;padding:0 12mm;} .toolbar{display:none;} h2{page-break-after:avoid;} table{page-break-inside:avoid;} }
`;

  const boxRow = (item: { box: string; label: string; value: number }, cls = "", display?: string) =>
    `<tr class="${cls}"><td class="box"><span>${item.box}</span></td><td class="lbl">${esc(item.label)}</td><td class="num">${display ?? money(item.value)}</td></tr>`;

  const title = `${esc(companyName)} — CT600 (draft)`;
  const inner = `
  <header>
    <div class="eyebrow">Company Tax Return · CT600 (draft)</div>
    <h1>${esc(companyName)}</h1>
    <div class="sub">For the accounting period ${fmtDate(periodFrom)} to ${fmtDate(periodTo)}</div>
  </header>

  <div class="draft"><strong>DRAFT — not for submission as-is.</strong> This maps the corporation tax computation onto the principal CT600 boxes for a company with trading income only, no losses, group relief or other reliefs. Box numbers follow the CT600 (2015) version and must be checked against the current form. Enter the company registration number and Unique Taxpayer Reference, confirm the figures, and transpose onto HMRC's CT600 before filing.</div>

  <h2>Company information</h2>
  <dl class="kv">
    <dt>Box 1 — Company name</dt><dd>${esc(companyName)}</dd>
    <dt>Box 2 — Company registration number</dt><dd>${companyNumber ? esc(companyNumber) : "— to be entered —"}</dd>
    <dt>Box 3 — Tax reference (UTR)</dt><dd>${utr ? esc(utr) : "— to be entered —"}</dd>
    <dt>Box 30 — Period covered — from</dt><dd>${fmtDate(periodFrom)}</dd>
    <dt>Box 35 — Period covered — to</dt><dd>${fmtDate(periodTo)}</dd>
  </dl>

  <h2>Company tax calculation</h2>
  <table>
    ${boxRow(b.turnover)}
    ${boxRow(b.tradingProfits)}
    ${boxRow(b.netTradingProfits, "sub")}
    ${boxRow(b.profitsBeforeDeductions)}
    ${boxRow(b.profitsBeforeCharges)}
    ${boxRow(b.profitsChargeable, "sub")}
    ${boxRow(b.associatedCompanies, "", String(b.associatedCompanies.value))}
    ${boxRow(b.corporationTax)}
    ${b.marginalRelief.value > 0 ? boxRow(b.marginalRelief) : ""}
    ${boxRow(b.netCorporationTax, "sub")}
    ${boxRow(b.taxChargeable)}
    ${boxRow(b.taxPayable, "total")}
  </table>
  <p class="note">Corporation tax charged at ${esc(rate)} (${esc(band)}). ${b.marginalRelief.value > 0 ? `Box 430 shows the main-rate charge before marginal relief; box 435 is the marginal relief.` : `No marginal relief applies at this level of profit.`} Where the accounting period straddles a change of rate, the profit must be apportioned across financial years (CT600 boxes 380–425) before the tax is struck — confirm before filing.</p>

  <h2>Supporting corporation tax computation</h2>
  <table class="comp">
    <tr><td>Profit before taxation per the accounts</td><td class="num">${money(tc.profitBeforeTax)}</td></tr>
    <tr><td>Add: depreciation charged in the accounts</td><td class="num">${money(tc.depreciation)}</td></tr>
    ${tc.capitalAllowances.total > 0 ? `<tr><td>Less: capital allowances</td><td class="num">(${money(tc.capitalAllowances.total)})</td></tr>` : ""}
    <tr class="strong sub"><td>Taxable total profits (box 315)</td><td class="num">${money(tc.taxableProfits)}</td></tr>
    ${tc.marginalRelief > 0 ? `<tr><td>Corporation tax at 25% (box 430)</td><td class="num">${money(tc.grossTax)}</td></tr><tr><td>Less: marginal relief (box 435)</td><td class="num">(${money(tc.marginalRelief)})</td></tr>` : ""}
    <tr class="strong total"><td>Corporation tax payable (box 525)</td><td class="num">${money(tc.tax)}</td></tr>
  </table>
  ${tc.capitalAllowances.total > 0
    ? `<p class="note">Capital allowances comprise the Annual Investment Allowance on estimated qualifying additions of ${money(tc.capitalAllowances.additions)}${tc.capitalAllowances.wda > 0 ? `, plus an 18% writing-down allowance on the balance above the AIA cap` : ``}. They assume every addition qualifies for AIA and exclude writing-down allowances on any brought-forward pool (the tax written-down value is not held in the ledger).</p>`
    : `<p class="note">No capital allowances have been claimed — a prior period covering the fixed-asset movement is needed to estimate qualifying additions.</p>`}

  <footer>
    Draft CT600 generated by ClosePilot from the connected Xero ledger for accounts-production purposes. It is not the official HMRC form and must not be submitted as-is. Losses, group relief, R&amp;D and other reliefs, disallowable expenses (e.g. entertaining), associated companies and financial-year apportionment remain the preparer's responsibility. Figures are rounded to the nearest £.
  </footer>`;

  return options.word ? wordShell(title, css, inner) : screenShell(title, css, inner, options.autoPrint);
}
