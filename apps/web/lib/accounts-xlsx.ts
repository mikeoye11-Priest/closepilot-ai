// Formula-driven, formatted Excel (.xlsx) workbooks for the management and
// statutory accounts. Subtotals/totals are real Excel formulas that reference
// the line-item cells, so editing a line recomputes the statement — the pack is
// a live model, not a static dump.

import ExcelJS from "exceljs";
import type { buildManagementAccounts } from "./management-accounts";
import type { buildStatutoryAccounts } from "./statutory-accounts";

const CUR = "£#,##0;(£#,##0)";
const PCT = "0.0%";
const MUTED = "FF64748B";
const ACCENT = "FF1D4ED8";

type Line = { name: string; amount: number; prior: number };
type Sec = { lines: Line[] };
const flat = (sections: Sec[]): Line[] => sections.flatMap((s) => s.lines);
const sumRange = (col: string, rows: number[]) => (rows.length ? `SUM(${col}${rows[0]}:${col}${rows[rows.length - 1]})` : "0");

function heading(ws: ExcelJS.Worksheet, title: string, subtitle: string, cols: number) {
  ws.getColumn(1).width = 52;
  for (let i = 2; i <= cols; i += 1) ws.getColumn(i).width = 16;
  ws.addRow([title]).getCell(1).font = { bold: true, size: 14 };
  ws.addRow([subtitle]).getCell(1).font = { color: { argb: MUTED }, size: 10 };
  ws.addRow([]);
}
function section(ws: ExcelJS.Worksheet, label: string, extraCols = 0) {
  const row = ws.addRow([label.toUpperCase(), ...Array(extraCols).fill("")]);
  row.getCell(1).font = { bold: true, size: 10, color: { argb: MUTED } };
  return row.number;
}
function line(ws: ExcelJS.Worksheet, label: string, values: (number | { formula: string; result: number })[], opts: { bold?: boolean; top?: boolean; double?: boolean } = {}) {
  const row = ws.addRow([label, ...values]);
  values.forEach((_, i) => {
    const cell = row.getCell(2 + i);
    cell.numFmt = CUR;
    if (opts.bold) cell.font = { bold: true };
    if (opts.top || opts.double) cell.border = { top: { style: "thin" }, ...(opts.double ? { bottom: { style: "double" } } : {}) };
  });
  if (opts.bold) row.getCell(1).font = { bold: true };
  return row.number;
}

// ── Management accounts ────────────────────────────────────────────────────────

export function buildManagementWorkbook(pack: ReturnType<typeof buildManagementAccounts>): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = "ClosePilot";
  const period = `Period to ${pack.meta.asOfDate} · ${pack.meta.currency}`;

  // Profit & Loss
  const pl = wb.addWorksheet("Profit & Loss");
  heading(pl, `${pack.meta.companyName} — Profit & Loss`, period, 2);
  section(pl, "Income");
  const inc = flat(pack.pl.income).map((l) => line(pl, l.name, [l.amount]));
  const revenueRow = line(pl, "Revenue", [{ formula: sumRange("B", inc), result: pack.pl.revenue }], { bold: true, top: true });
  let grossRow = revenueRow;
  if (pack.pl.costOfSales.length) {
    section(pl, "Cost of sales");
    const cos = flat(pack.pl.costOfSales).map((l) => line(pl, l.name, [l.amount]));
    grossRow = line(pl, "Gross profit", [{ formula: `B${revenueRow}+${sumRange("B", cos)}`, result: pack.pl.grossProfit }], { bold: true, top: true });
  }
  section(pl, "Overheads");
  const exp = flat(pack.pl.expenses).map((l) => line(pl, l.name, [l.amount]));
  const netRow = line(pl, "Net profit", [{ formula: `B${grossRow}+${sumRange("B", exp)}`, result: pack.pl.netProfit }], { bold: true, double: true });

  // Balance Sheet
  const bs = wb.addWorksheet("Balance Sheet");
  heading(bs, `${pack.meta.companyName} — Balance Sheet`, `As at ${pack.meta.asOfDate}`, 2);
  section(bs, "Fixed assets");
  const fx = flat(pack.bs.fixedAssets).map((l) => line(bs, l.name, [l.amount]));
  const totFx = line(bs, "Total fixed assets", [{ formula: sumRange("B", fx), result: pack.bs.totalFixed }], { bold: true, top: true });
  section(bs, "Current assets");
  const ca = flat(pack.bs.currentAssets).map((l) => line(bs, l.name, [l.amount]));
  const totCa = line(bs, "Total current assets", [{ formula: sumRange("B", ca), result: pack.bs.totalCurrentAssets }], { bold: true, top: true });
  section(bs, "Creditors: amounts falling due within one year");
  const li = flat(pack.bs.liabilities).map((l) => line(bs, l.name, [l.amount]));
  const totLi = line(bs, "Total liabilities", [{ formula: sumRange("B", li), result: pack.bs.totalLiabilities }], { bold: true, top: true });
  const netCa = line(bs, "Net current assets", [{ formula: `B${totCa}-B${totLi}`, result: pack.bs.netCurrentAssets }], { bold: true, top: true });
  const netAssets = line(bs, "Net assets", [{ formula: `B${totFx}+B${netCa}`, result: pack.bs.netAssets }], { bold: true, double: true });
  section(bs, "Capital and reserves");
  const eq = flat(pack.bs.equity).map((l) => line(bs, l.name, [l.amount]));
  line(bs, "Total equity", [{ formula: sumRange("B", eq), result: pack.bs.totalEquity }], { bold: true, double: true });

  // KPIs — cross-sheet formulas so they track the statements
  const kp = wb.addWorksheet("KPIs");
  heading(kp, `${pack.meta.companyName} — Key performance indicators`, period, 2);
  const PL = "'Profit & Loss'";
  const BS = "'Balance Sheet'";
  const pctRow = (label: string, formula: string, result: number) => { const r = kp.addRow([label, { formula, result }]); r.getCell(2).numFmt = PCT; return r.number; };
  const numRow = (label: string, formula: string, result: number, fmt = CUR) => { const r = kp.addRow([label, { formula, result }]); r.getCell(2).numFmt = fmt; return r.number; };
  numRow("Revenue", `${PL}!B${revenueRow}`, pack.pl.revenue);
  numRow("Gross profit", `${PL}!B${grossRow}`, pack.pl.grossProfit);
  numRow("Net profit", `${PL}!B${netRow}`, pack.pl.netProfit);
  pctRow("Gross margin", `IFERROR(${PL}!B${grossRow}/${PL}!B${revenueRow},0)`, pack.kpis.grossMargin ?? 0);
  pctRow("Net margin", `IFERROR(${PL}!B${netRow}/${PL}!B${revenueRow},0)`, pack.kpis.netMargin ?? 0);
  numRow("Current ratio", `IFERROR(${BS}!B${totCa}/${BS}!B${totLi},0)`, pack.kpis.currentRatio ?? 0, "0.00");
  numRow("Net assets", `${BS}!B${netAssets}`, pack.bs.netAssets);
  numRow("Cash at bank", `${pack.cashBalance}`, pack.cashBalance);
  numRow("Trade debtors", `${pack.debtors.total}`, pack.debtors.total);
  numRow("Trade creditors", `${pack.creditors.total}`, pack.creditors.total);
  numRow("Debtor days", `IFERROR(${pack.debtors.total}/${PL}!B${revenueRow}*365,0)`, pack.kpis.debtorDays ?? 0, "0");

  return wb;
}

// ── Statutory accounts (comparative) ───────────────────────────────────────────

export function buildStatutoryWorkbook(pack: ReturnType<typeof buildStatutoryAccounts>): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = "ClosePilot";
  const { sofp, incomeStatement: is, taxComputation: tc, hasComparatives } = pack;
  const cols = hasComparatives ? 3 : 2;
  const vals = (cur: number, pri: number): number[] => (hasComparatives ? [cur, pri] : [cur]);
  const priorYear = Number(pack.meta.asOfDate.slice(0, 4)) - 1;

  const colHead = (ws: ExcelJS.Worksheet) => {
    const r = ws.addRow(["", pack.meta.asOfDate, ...(hasComparatives ? [String(priorYear)] : [])]);
    r.eachCell((c, i) => { if (i > 1) { c.font = { bold: true, color: { argb: MUTED } }; c.alignment = { horizontal: "right" }; } });
  };

  // Income Statement
  const inc = wb.addWorksheet("Income Statement");
  heading(inc, `${pack.meta.companyName} — Income Statement`, `For the period ended ${pack.meta.asOfDate}`, cols);
  colHead(inc);
  line(inc, "Turnover", vals(is.turnover, is.priorTurnover));
  line(inc, "Cost of sales", vals(is.costOfSales, is.priorCostOfSales));
  const grRow = inc.lastRow!.number + 1;
  line(inc, "Gross profit", hasComparatives
    ? [{ formula: `B${grRow - 2}+B${grRow - 1}`, result: is.grossProfit }, { formula: `C${grRow - 2}+C${grRow - 1}`, result: is.priorGrossProfit }]
    : [{ formula: `B${grRow - 2}+B${grRow - 1}`, result: is.grossProfit }], { bold: true, top: true });
  line(inc, "Administrative expenses", vals(is.adminExpenses, is.priorAdminExpenses));
  const opRow = inc.lastRow!.number + 1;
  line(inc, "Operating profit", hasComparatives
    ? [{ formula: `B${opRow - 2}+B${opRow - 1}`, result: is.operatingProfit }, { formula: `C${opRow - 2}+C${opRow - 1}`, result: is.priorOperatingProfit }]
    : [{ formula: `B${opRow - 2}+B${opRow - 1}`, result: is.operatingProfit }], { bold: true, top: true });
  line(inc, "Profit for the financial period", vals(is.profitForYear, is.priorProfitForYear), { bold: true, double: true });

  // Balance Sheet (Statement of Financial Position)
  const bs = wb.addWorksheet("Balance Sheet");
  heading(bs, `${pack.meta.companyName} — Statement of Financial Position`, `As at ${pack.meta.asOfDate}`, cols);
  colHead(bs);
  section(bs, "Fixed assets", cols - 1);
  const tanRow = line(bs, "Tangible assets", vals(sofp.tangibleFixedAssets, sofp.priorTangible));
  section(bs, "Current assets", cols - 1);
  const debRow = line(bs, "Debtors", vals(sofp.debtors, sofp.priorDebtors));
  const cashRow = line(bs, "Cash at bank and in hand", vals(sofp.cash, sofp.priorCash));
  const caRow = line(bs, "Total current assets", hasComparatives
    ? [{ formula: `SUM(B${debRow}:B${cashRow})`, result: sofp.currentAssetsTotal }, { formula: `SUM(C${debRow}:C${cashRow})`, result: sofp.priorCurrentAssets }]
    : [{ formula: `SUM(B${debRow}:B${cashRow})`, result: sofp.currentAssetsTotal }], { bold: true, top: true });
  const crRow = line(bs, "Creditors: amounts falling due within one year", vals(-sofp.creditorsWithinYear, -sofp.priorCreditors));
  const ncaRow = line(bs, "Net current assets", hasComparatives
    ? [{ formula: `B${caRow}+B${crRow}`, result: sofp.netCurrentAssets }, { formula: `C${caRow}+C${crRow}`, result: sofp.priorNetCurrentAssets }]
    : [{ formula: `B${caRow}+B${crRow}`, result: sofp.netCurrentAssets }], { bold: true, top: true });
  line(bs, "Net assets", hasComparatives
    ? [{ formula: `B${tanRow}+B${ncaRow}`, result: sofp.netAssets }, { formula: `C${tanRow}+C${ncaRow}`, result: sofp.priorNetAssets }]
    : [{ formula: `B${tanRow}+B${ncaRow}`, result: sofp.netAssets }], { bold: true, double: true });
  section(bs, "Capital and reserves", cols - 1);
  const eqRows = sofp.equityLines.map((l) => line(bs, l.name, vals(l.amount, l.prior)));
  line(bs, "Shareholders' funds", hasComparatives
    ? [{ formula: sumRange("B", eqRows), result: sofp.totalEquity }, { formula: sumRange("C", eqRows), result: sofp.priorEquity }]
    : [{ formula: sumRange("B", eqRows), result: sofp.totalEquity }], { bold: true, double: true });

  // Corporation tax computation (formula-driven)
  const tax = wb.addWorksheet("Tax Computation");
  heading(tax, `${pack.meta.companyName} — Corporation Tax Computation`, `Estimated · ${tc.rate} · draft for review`, 2);
  const pbtRow = line(tax, "Profit before taxation", [tc.profitBeforeTax]);
  const depRow = line(tax, "Add: depreciation charged in the accounts", [tc.depreciation]);
  const ttpRow = line(tax, "Taxable total profits", [{ formula: `B${pbtRow}+B${depRow}`, result: tc.taxableProfits }], { bold: true, top: true });
  line(tax, `Corporation tax (${tc.rate})`, [tc.tax], { bold: true, double: true });
  tax.addRow([]);
  tax.addRow([`${tc.band}. Estimated over a ${tc.periodDays}-day period. Excludes capital allowances, other disallowables and associated companies — review before finalising. Ref: taxable profits × effective rate (row ${ttpRow}).`]).getCell(1).font = { color: { argb: MUTED }, size: 9 };

  // Full FRS 102 extras (comparatives required for meaningful movements)
  if (pack.full && hasComparatives) {
    const ce = pack.changesInEquity;
    const eqs = wb.addWorksheet("Changes in Equity");
    heading(eqs, `${pack.meta.companyName} — Statement of Changes in Equity`, `For the period ended ${pack.meta.asOfDate}`, 2);
    const oRow = line(eqs, "Equity at start of period", [ce.openingEquity]);
    line(eqs, "Profit for the financial period", [ce.profit]);
    const othRow = line(eqs, "Dividends and other movements", [ce.other]);
    line(eqs, "Equity at end of period", [{ formula: `SUM(B${oRow}:B${othRow})`, result: ce.closingEquity }], { bold: true, double: true });

    const cf = pack.cashFlow;
    const cfs = wb.addWorksheet("Cash Flow");
    heading(cfs, `${pack.meta.companyName} — Statement of Cash Flows`, `For the period ended ${pack.meta.asOfDate} · indirect method`, 2);
    section(cfs, "Operating activities");
    const opRow = line(cfs, "Operating profit", [cf.operatingProfit]);
    line(cfs, "Depreciation", [cf.depreciation]);
    line(cfs, "(Increase)/decrease in debtors", [-cf.dDebtors]);
    const crRow = line(cfs, "Increase/(decrease) in creditors", [cf.dCreditors]);
    const opsRow = line(cfs, "Net cash from operating activities", [{ formula: `SUM(B${opRow}:B${crRow})`, result: cf.netCashOps }], { bold: true, top: true });
    section(cfs, "Investing activities");
    const capRow = line(cfs, "Purchase of tangible fixed assets", [cf.capex]);
    section(cfs, "Financing activities");
    const finRow = line(cfs, "Financing and other movements", [cf.financingOther]);
    const chgRow = line(cfs, "Net increase/(decrease) in cash", [{ formula: `B${opsRow}+B${capRow}+B${finRow}`, result: cf.cashChange }], { bold: true, top: true });
    const startRow = line(cfs, "Cash at start of period", [cf.openingCash]);
    line(cfs, "Cash at end of period", [{ formula: `B${chgRow}+B${startRow}`, result: cf.closingCash }], { bold: true, double: true });
  }

  return wb;
}
