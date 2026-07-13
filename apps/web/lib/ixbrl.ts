// Inline XBRL (iXBRL) rendering of the statutory financial statements, tagged
// against the FRC taxonomy (FRS 102, 2023-01-01 entry point) for Companies
// House / HMRC filing. This is a DRAFT: it must be validated against a filing
// checker (e.g. the Companies House test service) before any live submission —
// concept names, dimensions and the entry point may need adjustment, and the
// company registration number must be supplied.

import type { buildStatutoryAccounts } from "./statutory-accounts";

type Pack = ReturnType<typeof buildStatutoryAccounts>;

const esc = (value: string) => value.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
const disp = (value: number) => Math.abs(Math.round(value)).toLocaleString("en-GB");

// One tagged monetary fact. `report` is the value as it should be reported for
// the concept (magnitudes for cost/creditor concepts); a negative value emits
// sign="-" and the displayed number is its magnitude.
function fact(name: string, ctx: string, report: number): string {
  const neg = report < 0;
  return `<ix:nonFraction name="${name}" contextRef="${ctx}" unitRef="GBP" decimals="0" format="ixt:num-dot-decimal"${neg ? ' sign="-"' : ""}>${disp(report)}</ix:nonFraction>`;
}

export function renderIxbrl(pack: Pack, companyNumber = ""): string {
  const { meta, sofp, incomeStatement: is, hasComparatives } = pack;
  const end = meta.asOfDate;
  const start = `${end.slice(0, 4)}-01-01`;
  const priorYear = Number(end.slice(0, 4)) - 1;
  const priorEnd = `${priorYear}${end.slice(4)}`;
  const priorStart = `${priorYear}-01-01`;
  const entityId = (companyNumber || "00000000").replace(/[^0-9A-Za-z]/g, "");

  const context = (id: string, kind: "instant" | "duration", a: string, b?: string) => `
    <xbrli:context id="${id}">
      <xbrli:entity><xbrli:identifier scheme="http://www.companieshouse.gov.uk/">${esc(entityId)}</xbrli:identifier></xbrli:entity>
      <xbrli:period>${kind === "instant" ? `<xbrli:instant>${a}</xbrli:instant>` : `<xbrli:startDate>${a}</xbrli:startDate><xbrli:endDate>${b}</xbrli:endDate>`}</xbrli:period>
    </xbrli:context>`;

  // Two number columns when comparatives exist.
  const numCols = (current: string, prior: string) => `<td class="num">${current}</td>${hasComparatives ? `<td class="num">${prior}</td>` : ""}`;
  const sofpRow = (label: string, concept: string, cur: number, pri: number, cls = "") =>
    `<tr class="${cls}"><td>${esc(label)}</td>${numCols(fact(concept, "iCurrent", cur), hasComparatives ? fact(concept, "iPrior", pri) : "")}</tr>`;
  const plRow = (label: string, concept: string, cur: number, pri: number, cls = "") =>
    `<tr class="${cls}"><td>${esc(label)}</td>${numCols(fact(concept, "dCurrent", cur), hasComparatives ? fact(concept, "dPrior", pri) : "")}</tr>`;
  const colHead = `<tr class="colhead"><td></td><td class="num">${end}</td>${hasComparatives ? `<td class="num">${priorEnd}</td>` : ""}</tr>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"
      xmlns:ix="http://www.xbrl.org/2013/inlineXBRL"
      xmlns:ixt="http://www.xbrl.org/inlineXBRL/transformation/2020-02-12"
      xmlns:xbrli="http://www.xbrl.org/2003/instance"
      xmlns:link="http://www.xbrl.org/2003/linkbase"
      xmlns:xlink="http://www.w3.org/1999/xlink"
      xmlns:iso4217="http://www.xbrl.org/2003/iso4217"
      xmlns:uk-core="http://xbrl.frc.org.uk/fr/2023-01-01/core"
      xmlns:uk-bus="http://xbrl.frc.org.uk/cd/2023-01-01/business">
<head>
  <meta charset="UTF-8"/>
  <title>${esc(meta.companyName)} — Financial Statements (iXBRL)</title>
  <style>
    body { font-family: Georgia, serif; color:#0f172a; max-width:820px; margin:24px auto; padding:0 24px; }
    .draft { background:#fef3c7; border:1px solid #f59e0b; border-radius:8px; padding:10px 14px; font-family:system-ui; font-size:12px; margin-bottom:20px; }
    h1 { font-size:24px; } h2 { font-size:16px; margin-top:28px; }
    table { width:100%; border-collapse:collapse; font-size:13px; } td { padding:5px 6px; }
    .num { text-align:right; font-variant-numeric:tabular-nums; }
    tr.colhead td { border-bottom:1px solid #0f172a; font-weight:700; font-size:11px; color:#64748b; }
    tr.head td { font-weight:700; color:#64748b; padding-top:10px; }
    tr.sub td { border-top:1px solid #cbd5e1; font-weight:600; }
    tr.total td { border-top:1px solid #0f172a; border-bottom:3px double #0f172a; font-weight:700; }
  </style>
</head>
<body>
  <div style="display:none">
    <ix:header>
      <ix:references><link:schemaRef xlink:type="simple" xlink:href="https://xbrl.frc.org.uk/FRS-102/2023-01-01/FRS-102-2023-01-01.xsd"/></ix:references>
      <ix:resources>
        ${context("iCurrent", "instant", end)}
        ${context("dCurrent", "duration", start, end)}
        ${hasComparatives ? context("iPrior", "instant", priorEnd) : ""}
        ${hasComparatives ? context("dPrior", "duration", priorStart, priorEnd) : ""}
        <xbrli:unit id="GBP"><xbrli:measure>iso4217:GBP</xbrli:measure></xbrli:unit>
      </ix:resources>
    </ix:header>
  </div>

  <div class="draft"><strong>DRAFT iXBRL — not yet filed.</strong> Tagged against the FRC FRS 102 (2023-01-01) taxonomy. Validate against a filing checker (e.g. the Companies House test service) and insert the company registration number before submission. Concept mapping and dimensions must be confirmed by the preparer.</div>

  <h1><ix:nonNumeric name="uk-bus:EntityCurrentLegalOrRegisteredName" contextRef="dCurrent">${esc(meta.companyName)}</ix:nonNumeric></h1>
  <p>Financial statements for the period ended ${end}</p>

  <h2>Statement of Financial Position</h2>
  <table>
    ${colHead}
    <tr class="head"><td>Fixed assets</td><td></td>${hasComparatives ? "<td></td>" : ""}</tr>
    ${sofpRow("Tangible assets", "uk-core:PropertyPlantEquipment", sofp.tangibleFixedAssets, sofp.priorTangible)}
    <tr class="head"><td>Current assets</td><td></td>${hasComparatives ? "<td></td>" : ""}</tr>
    ${sofpRow("Debtors", "uk-core:Debtors", sofp.debtors, sofp.priorDebtors)}
    ${sofpRow("Cash at bank and in hand", "uk-core:CashBankOnHand", sofp.cash, sofp.priorCash)}
    ${sofpRow("Total current assets", "uk-core:CurrentAssets", sofp.currentAssetsTotal, sofp.priorCurrentAssets, "sub")}
    ${sofpRow("Creditors: amounts falling due within one year", "uk-core:Creditors", sofp.creditorsWithinYear, sofp.priorCreditors)}
    ${sofpRow("Net current assets", "uk-core:NetCurrentAssetsLiabilities", sofp.netCurrentAssets, sofp.priorNetCurrentAssets, "sub")}
    ${sofpRow("Total assets less current liabilities", "uk-core:TotalAssetsLessCurrentLiabilities", sofp.totalAssetsLessCurrentLiabilities, sofp.priorTALCL)}
    ${sofpRow("Net assets", "uk-core:NetAssetsLiabilities", sofp.netAssets, sofp.priorNetAssets, "total")}
    ${sofpRow("Capital and reserves", "uk-core:Equity", sofp.totalEquity, sofp.priorEquity, "total")}
  </table>

  <h2>Income Statement</h2>
  <table>
    ${colHead.replace(end, end).replace(priorEnd, priorEnd)}
    ${plRow("Turnover", "uk-core:TurnoverRevenue", is.turnover, is.priorTurnover)}
    ${plRow("Cost of sales", "uk-core:CostSales", Math.abs(is.costOfSales), Math.abs(is.priorCostOfSales))}
    ${plRow("Gross profit", "uk-core:GrossProfitLoss", is.grossProfit, is.priorGrossProfit, "sub")}
    ${plRow("Administrative expenses", "uk-core:AdministrativeExpenses", Math.abs(is.adminExpenses), Math.abs(is.priorAdminExpenses))}
    ${plRow("Operating profit", "uk-core:OperatingProfitLoss", is.operatingProfit, is.priorOperatingProfit, "sub")}
    ${plRow("Profit for the financial period", "uk-core:ProfitLoss", is.profitForYear, is.priorProfitForYear, "total")}
  </table>

  <p style="font-family:system-ui;font-size:11px;color:#64748b;margin-top:24px">Generated by ClosePilot. This inline-XBRL document is a draft for validation; the preparer remains responsible for taxonomy accuracy, dimensions, disclosures and filing.</p>
</body>
</html>`;
}
