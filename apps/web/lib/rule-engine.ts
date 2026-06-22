/**
 * ClosePilot Assurance Rule Engine
 *
 * Generic, declarative executor for all 350+ assurance rules.
 * Each rule is a pure data definition — no code changes required to add new rules.
 *
 * Supports 1,500+ rules at scale via rule library files.
 */

import type { Finding, FindingEvidenceRow, Upload } from "@/lib/types";
import type { AssuranceRule, RuleResult, Comparator } from "@/lib/types/rule";

// ─── Column resolver ──────────────────────────────────────────────────────────
//
// Maps logical field names to arrays of real column aliases used by
// Sage, Xero, QuickBooks, Business Central, SAP, Oracle and Excel exports.
// The engine tries each alias in order and uses the first non-empty value.

const FIELD_ALIASES: Record<string, string[]> = {
  // Identifiers
  customer:      ["customer","customer_name","debtor","debtor_name","name","account_name","client","client_name","account","party","contact_name"],
  supplier:      ["supplier","supplier_name","vendor","vendor_name","creditor","creditor_name","name","payee","account_name","party"],
  account_name:  ["account_name","account_description","nominal","gl_account","ledger_account","account","description","account_code","nominal_code","acc_name"],
  account_code:  ["account_code","nominal_code","code","gl_code","acc_code","nominal","account_no","acc_no"],
  user:          ["posted_by","created_by","user","preparer","user_name","entered_by","approved_by","authorised_by"],

  // Amounts
  balance:       ["balance","closing_balance","net","amount","net_balance","outstanding_balance"],
  amount:        ["amount","balance","outstanding","invoice_amount","net_amount","total","value","gross","net"],
  debit:         ["debit","debits","dr","debit_amount"],
  credit:        ["credit","credits","cr","credit_amount"],
  vat_amount:    ["vat_amount","tax_amount","vat","tax","gst_amount","vat_value","tax_value"],
  net_amount:    ["net_amount","net","amount","invoice_amount","value","gross_ex_vat","ex_vat"],
  credit_limit:  ["credit_limit","limit","approved_limit","credit_facility","credit_line"],
  overdue:       ["over_60","60_days","60_plus","90_days","120_days","over_90","over_120","overdue","overdue_balance","amount","balance","outstanding"],

  // Dates
  date:          ["invoice_date","date","transaction_date","posting_date","doc_date","entry_date","inv_date","invoice_dt"],
  posting_date:  ["posting_date","entry_date","created_date","journal_date","posted_date","processed_date","entered_date"],
  due_date:      ["due_date","payment_due","due","pay_by","payment_date","due_dt","maturity_date"],

  // VAT
  vat_code:      ["vat_code","tax_code","vat_rate","tax_rate","vat_treatment","tax_treatment","vat_type","tax_type","vat_class"],

  // References
  invoice_ref:   ["invoice_ref","invoice_number","invoice_no","inv_no","inv_ref","reference","ref","doc_no","document_number","doc_number"],

  // Descriptions
  description:   ["description","narration","memo","details","particulars","transaction_description","account_name","category","account_description","narrative"],

  // Aging
  days:          ["days_overdue","days_outstanding","age","age_days","days","aging","overdue_days","day_bucket","period_bucket","bucket"],

  // Status
  status:        ["status","dispute_flag","on_hold","account_status","payment_status","query_flag"],

  // Currency
  currency:      ["currency","currency_code","ccy","iso_code","curr"],
};

export function resolveField(row: Record<string, string>, fieldSpec: string[]): string {
  // fieldSpec can be: logical names (e.g. "balance") OR direct column names
  for (const spec of fieldSpec) {
    const aliases = FIELD_ALIASES[spec] ?? [spec];
    for (const alias of aliases) {
      if (row[alias] !== undefined && row[alias].trim() !== "") return row[alias].trim();
    }
  }
  return "";
}

export function resolveNumeric(row: Record<string, string>, fieldSpec: string[]): number | null {
  const raw = resolveField(row, fieldSpec);
  if (!raw) return null;
  const cleaned = raw.replace(/[£$€,\s]/g, "").replace(/^\((.*)\)$/, "-$1");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

export function resolveDate(row: Record<string, string>, fieldSpec: string[]): Date | null {
  const raw = resolveField(row, fieldSpec);
  if (!raw) return null;
  const c = raw.trim().replace(/[/. ]/g, "-");
  const parts = c.split("-");
  if (parts.length !== 3) return null;
  const [a, b, cc] = parts.map(Number);
  if (cc > 2000) { const d = new Date(cc, b - 1, a); return isNaN(d.getTime()) ? null : d; }
  if (a  > 2000) { const d = new Date(a,  b - 1, cc); return isNaN(d.getTime()) ? null : d; }
  return null;
}

// ─── ParsedFile input shape ───────────────────────────────────────────────────

export interface EngineFile {
  upload: Upload;
  rows: Record<string, string>[];
  isParsed: boolean;
}

// ─── Main executor ────────────────────────────────────────────────────────────

export function executeRule(rule: AssuranceRule, file: EngineFile): RuleResult {
  if (!file.isParsed) return empty();
  if (rule.minRows && file.rows.length < rule.minRows) return empty();

  const today = new Date();
  const rows = file.rows;

  switch (rule.type) {

    case "threshold":  return evalThreshold(rule, rows);
    case "sign":       return evalSign(rule, rows);
    case "keyword":    return evalKeyword(rule, rows);
    case "pattern":    return evalPattern(rule, rows);
    case "comparison": return evalComparison(rule, rows);
    case "aging":      return evalAging(rule, rows, today);
    case "existence":  return evalExistence(rule, rows);
    case "percentage": return evalPercentage(rule, rows);
    case "variance":   return evalVariance(rule, rows);
    case "financial_statement_metric": return evalFinancialStatementMetric(rule, rows);
    case "close_review_metric": return evalCloseReviewMetric(rule, rows);
    case "ledger_metric": return evalLedgerMetric(rule, rows);
    default:           return empty();
  }
}

export function runRuleEngine(
  rules: AssuranceRule[],
  files: EngineFile[]
): Finding[] {
  const findings: Finding[] = [];

  for (const rule of rules) {
    const targets = rule.fileType === "any"
      ? files.filter((f) => f.isParsed)
      : files.filter((f) => f.upload.fileType === rule.fileType && f.isParsed);

    for (const file of targets) {
      const result = executeRule(rule, file);
      if (!result.triggered) continue;

      findings.push(buildFinding(rule, file, result));
    }
  }

  return findings;
}

// ─── Rule evaluators ──────────────────────────────────────────────────────────

function evalThreshold(rule: AssuranceRule, rows: Record<string, string>[]): RuleResult {
  const field = rule.field ?? ["amount"];
  const op = rule.comparator ?? "gt";
  const threshold = rule.threshold ?? 0;
  const nameField = rule.nameField ?? ["account_name", "customer", "supplier", "description"];

  const matching = rows.filter((r) => {
    const v = resolveNumeric(r, field);
    return v !== null && compare(v, op, threshold);
  });

  if (matching.length === 0) return empty();

  const total = matching.reduce((s, r) => s + Math.abs(resolveNumeric(r, field) ?? 0), 0);
  const names = matching.slice(0, 3).map((r) => resolveField(r, nameField)).filter(Boolean);

  return {
    triggered: true, matchCount: matching.length, matchTotal: total, matchNames: names,
    rows: evidenceRows(matching, nameField, field),
    evidence: `${matching.length} row(s) where ${field[0]} ${op} ${fc(threshold)} — total ${fc(total)}.`
  };
}

function evalSign(rule: AssuranceRule, rows: Record<string, string>[]): RuleResult {
  const field = rule.field ?? ["balance"];
  const threshold = rule.threshold ?? 1;
  const expectNegative = (rule.keywords ?? ["negative"])[0] === "negative";
  const nameField = rule.nameField ?? ["account_name", "customer", "supplier"];

  const matching = rows.filter((r) => {
    const v = resolveNumeric(r, field);
    return v !== null && (expectNegative ? v < -threshold : v > threshold);
  });

  if (matching.length === 0) return empty();

  const total = matching.reduce((s, r) => s + Math.abs(resolveNumeric(r, field) ?? 0), 0);
  const names = matching.slice(0, 3).map((r) => resolveField(r, nameField)).filter(Boolean);

  return {
    triggered: true, matchCount: matching.length, matchTotal: total, matchNames: names,
    rows: evidenceRows(matching, nameField, field),
    evidence: `${matching.length} ${expectNegative ? "negative" : "unexpected positive"} balance(s) totalling ${fc(total)}.`
  };
}

function evalKeyword(rule: AssuranceRule, rows: Record<string, string>[]): RuleResult {
  const field = rule.field ?? ["description"];
  const keywords = rule.keywords ?? [];
  if (keywords.length === 0) return empty();

  const re = new RegExp(keywords.join("|"), "i");
  const nameField = rule.nameField ?? field;

  const matching = rows.filter((r) => re.test(resolveField(r, field)));
  if (matching.length === 0) return empty();

  const total = matching.reduce((s, r) => s + Math.abs(resolveNumeric(r, ["amount","balance","outstanding"]) ?? 0), 0);
  const names = matching.slice(0, 3).map((r) => resolveField(r, nameField)).filter(Boolean);

  return {
    triggered: true, matchCount: matching.length, matchTotal: total, matchNames: names,
    rows: evidenceRows(matching, nameField, ["amount","balance","outstanding"]),
    evidence: `${matching.length} row(s) matching "${keywords[0]}" in ${field[0]}${total > 0 ? ` — ${fc(total)}` : ""}.`
  };
}

function evalPattern(rule: AssuranceRule, rows: Record<string, string>[]): RuleResult {
  const field = rule.field ?? ["description"];
  const pattern = rule.pattern ?? "";
  if (!pattern) return empty();

  const re = new RegExp(pattern, "i");
  const matching = rows.filter((r) => re.test(resolveField(r, field)));
  if (matching.length === 0) return empty();

  const total = matching.reduce((s, r) => s + Math.abs(resolveNumeric(r, ["amount","balance"]) ?? 0), 0);
  const names = matching.slice(0, 3).map((r) => resolveField(r, field)).filter(Boolean);

  return {
    triggered: true, matchCount: matching.length, matchTotal: total, matchNames: names,
    rows: evidenceRows(matching, field, ["amount","balance"]),
    evidence: `${matching.length} row(s) matching pattern /${pattern}/ — ${fc(total)}.`
  };
}

function evalComparison(rule: AssuranceRule, rows: Record<string, string>[]): RuleResult {
  const field1 = rule.field ?? ["balance"];
  const field2 = rule.referenceField ?? ["credit_limit"];
  const op = rule.comparator ?? "gt";
  const nameField = rule.nameField ?? ["customer","account_name"];

  const matching = rows.filter((r) => {
    const v1 = resolveNumeric(r, field1);
    const v2 = resolveNumeric(r, field2);
    return v1 !== null && v2 !== null && v2 > 0 && compare(v1, op, v2);
  });

  if (matching.length === 0) return empty();

  const total = matching.reduce((s, r) => s + Math.abs(resolveNumeric(r, field1) ?? 0), 0);
  const names = matching.slice(0, 3).map((r) => resolveField(r, nameField)).filter(Boolean);

  return {
    triggered: true, matchCount: matching.length, matchTotal: total, matchNames: names,
    rows: evidenceRows(matching, nameField, field1),
    evidence: `${matching.length} row(s) where ${field1[0]} ${op} ${field2[0]} — total ${fc(total)}.`
  };
}

function evalAging(rule: AssuranceRule, rows: Record<string, string>[], today: Date): RuleResult {
  const days = rule.days ?? 90;
  const dateField = rule.dateField ?? rule.field ?? ["date", "invoice_date"];
  const amountField = rule.referenceField ?? ["amount","balance","outstanding"];
  const nameField = rule.nameField ?? ["customer","supplier","account_name"];
  const cutoff = new Date(today.getTime() - days * 24 * 3600 * 1000);

  const matching = rows.filter((r) => {
    const d = resolveDate(r, dateField);
    const amt = resolveNumeric(r, amountField) ?? 0;
    // Also check day-bucket column
    const dayBucket = parseDayBucket(resolveField(r, ["days","age","aging","days_overdue"]));
    return (d && d < cutoff || dayBucket >= days) && amt > 0;
  });

  if (matching.length === 0) return empty();

  const total = matching.reduce((s, r) => s + Math.abs(resolveNumeric(r, amountField) ?? 0), 0);
  const names = matching.slice(0, 3).map((r) => resolveField(r, nameField)).filter(Boolean);

  return {
    triggered: true, matchCount: matching.length, matchTotal: total, matchNames: names,
    rows: evidenceRows(matching, nameField, amountField),
    evidence: `${matching.length} item(s) aged ${days}+ days with balance > 0 — total ${fc(total)}.`
  };
}

function evalExistence(rule: AssuranceRule, rows: Record<string, string>[]): RuleResult {
  const field = rule.field ?? ["account_name"];
  const nameField = rule.nameField ?? field;
  const amountField = rule.referenceField ?? ["balance","amount"];
  const keywords = rule.keywords ?? [];
  const mustExist = rule.mustExist ?? true;
  const threshold = rule.threshold;

  if (keywords.length === 0) return empty();
  const re = new RegExp(keywords.join("|"), "i");
  const candidateRows = rows.filter((r) => re.test(resolveField(r, field)));
  const matchRows = mustExist && threshold !== undefined
    ? candidateRows.filter((r) => Math.abs(resolveSignedAmount(r, amountField)) > threshold)
    : candidateRows;
  const found = matchRows.length > 0;

  const triggered = mustExist ? found : !found;
  if (!triggered) return empty();

  const total = matchRows.reduce((s, r) => s + Math.abs(resolveSignedAmount(r, amountField)), 0);
  const names = matchRows.slice(0, 3).map((r) => resolveField(r, field)).filter(Boolean);

  return {
    triggered: true, matchCount: matchRows.length, matchTotal: total, matchNames: names,
    rows: evidenceRows(matchRows, nameField, amountField),
    evidence: mustExist
      ? `${matchRows.length} row(s) matching "${keywords[0]}" found — ${fc(total)}.`
      : `No account matching "${keywords[0]}" found in ${field[0]}.`
  };
}

function evalPercentage(rule: AssuranceRule, rows: Record<string, string>[]): RuleResult {
  const field = rule.field ?? ["description"];
  const keywords = rule.keywords ?? [];
  const threshold = rule.percentage ?? 20;
  const re = keywords.length > 0 ? new RegExp(keywords.join("|"), "i") : null;

  let matchCount: number;
  if (re) {
    matchCount = rows.filter((r) => re.test(resolveField(r, field))).length;
  } else {
    // blank check
    matchCount = rows.filter((r) => !resolveField(r, field)).length;
  }

  const pct = (matchCount / Math.max(rows.length, 1)) * 100;
  if (pct < threshold) return empty();

  return {
    triggered: true, matchCount, matchTotal: 0, matchNames: [],
    evidence: `${matchCount} of ${rows.length} rows (${Math.round(pct)}%) match condition — threshold ${threshold}%.`
  };
}

function evalVariance(rule: AssuranceRule, rows: Record<string, string>[]): RuleResult {
  const field = rule.field ?? ["amount"];
  const threshold = rule.percentage ?? 50;

  const values = rows.map((r) => resolveNumeric(r, field) ?? 0).filter((v) => v !== 0);
  if (values.length < 3) return empty();

  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / values.length;
  const stdDev = Math.sqrt(variance);

  const outliers = values.filter((v) => Math.abs(v - mean) > (threshold / 100) * Math.abs(mean) || (stdDev > 0 && Math.abs((v - mean) / stdDev) > 2.5));

  if (outliers.length === 0) return empty();

  return {
    triggered: true, matchCount: outliers.length, matchTotal: outliers.reduce((s, v) => s + Math.abs(v), 0), matchNames: [],
    evidence: `${outliers.length} statistical outlier(s) — mean ${fc(mean)}, std dev ${fc(stdDev)}.`
  };
}

function evalFinancialStatementMetric(rule: AssuranceRule, rows: Record<string, string>[]): RuleResult {
  const metric = rule.metric;
  if (!metric) return empty();

  const fs = financialStatementTotals(rows);
  const threshold = rule.threshold ?? 0;

  switch (metric) {
    case "negative_cash": {
      if (fs.negativeCash <= threshold) return empty();
      return fsResult(`Cash and bank accounts have a net negative balance of ${fc(fs.negativeCash)}.`, fs.negativeCash, ["Cash and bank"]);
    }
    case "balance_sheet_equation": {
      if (fs.assets <= 0 || fs.liabilities + fs.equity <= 0) return empty();
      const expected = fs.liabilities + fs.equity;
      const difference = Math.abs(fs.assets - expected);
      const tolerance = Math.max(1, fs.assets * (rule.percentage ?? 1) / 100);
      if (difference <= tolerance) return empty();
      return fsResult(`Assets ${fc(fs.assets)} vs liabilities plus equity ${fc(expected)} — difference ${fc(difference)}.`, difference, ["Balance sheet equation"]);
    }
    case "current_ratio": {
      if (fs.currentAssets <= 0 || fs.currentLiabilities <= 0) return empty();
      const ratio = fs.currentAssets / fs.currentLiabilities;
      if (!compare(ratio, rule.comparator ?? "lt", threshold || 1)) return empty();
      return fsResult(`Current assets ${fc(fs.currentAssets)} / current liabilities ${fc(fs.currentLiabilities)} = ${ratio.toFixed(2)}.`, fs.currentLiabilities - fs.currentAssets, ["Current ratio"]);
    }
    case "quick_ratio": {
      if (fs.currentAssets <= 0 || fs.currentLiabilities <= 0) return empty();
      const quickAssets = Math.max(0, fs.currentAssets - fs.inventory);
      const ratio = quickAssets / fs.currentLiabilities;
      if (!compare(ratio, rule.comparator ?? "lt", threshold || 0.8)) return empty();
      return fsResult(`Quick assets ${fc(quickAssets)} / current liabilities ${fc(fs.currentLiabilities)} = ${ratio.toFixed(2)}.`, fs.currentLiabilities - quickAssets, ["Quick ratio"]);
    }
    case "debt_ratio": {
      if (fs.assets <= 0 || fs.liabilities <= 0) return empty();
      const ratio = fs.liabilities / fs.assets;
      if (!compare(ratio, rule.comparator ?? "gt", threshold || 0.75)) return empty();
      return fsResult(`Total liabilities ${fc(fs.liabilities)} / total assets ${fc(fs.assets)} = ${(ratio * 100).toFixed(1)}%.`, fs.liabilities, ["Debt ratio"]);
    }
    case "negative_net_assets": {
      if (fs.assets <= 0 || fs.liabilities <= 0) return empty();
      const netAssets = fs.assets - fs.liabilities;
      if (netAssets >= -threshold) return empty();
      return fsResult(`Total assets ${fc(fs.assets)} less total liabilities ${fc(fs.liabilities)} = negative net assets of ${fc(netAssets)}.`, Math.abs(netAssets), ["Net assets"]);
    }
    case "net_asset_ratio": {
      if (fs.assets <= 0 || fs.liabilities <= 0) return empty();
      const netAssets = fs.assets - fs.liabilities;
      if (netAssets < 0) return empty();
      const ratio = netAssets / fs.assets;
      if (!compare(ratio, rule.comparator ?? "lt", threshold || 0.1)) return empty();
      return fsResult(`Net assets ${fc(netAssets)} / total assets ${fc(fs.assets)} = ${(ratio * 100).toFixed(1)}%.`, Math.abs(netAssets), ["Net asset buffer"]);
    }
    case "fixed_asset_depreciation_gap": {
      if (fs.fixedAssets < (threshold || 10000) || fs.accumulatedDepreciation > 0) return empty();
      return fsResult(`Fixed assets ${fc(fs.fixedAssets)} but no accumulated depreciation balance was identified.`, fs.fixedAssets, ["Fixed assets", "Accumulated depreciation"]);
    }
    case "intangible_amortisation_gap": {
      if (fs.intangibles < (threshold || 10000) || fs.accumulatedAmortisation > 0) return empty();
      return fsResult(`Intangible assets ${fc(fs.intangibles)} but no accumulated amortisation balance was identified.`, fs.intangibles, ["Intangible assets", "Accumulated amortisation"]);
    }
    case "cash_ratio": {
      if (fs.cash <= 0 || fs.currentLiabilities <= 0) return empty();
      const ratio = fs.cash / fs.currentLiabilities;
      if (!compare(ratio, rule.comparator ?? "lt", threshold || 0.2)) return empty();
      return fsResult(`Cash ${fc(fs.cash)} / current liabilities ${fc(fs.currentLiabilities)} = ${ratio.toFixed(2)}.`, fs.currentLiabilities - fs.cash, ["Cash ratio"]);
    }
    case "asset_coverage": {
      if (fs.assets <= 0 || fs.borrowings <= 0) return empty();
      const ratio = fs.assets / fs.borrowings;
      if (!compare(ratio, rule.comparator ?? "lt", threshold || 1.5)) return empty();
      return fsResult(`Total assets ${fc(fs.assets)} / borrowings ${fc(fs.borrowings)} = ${ratio.toFixed(2)}.`, fs.borrowings, ["Asset coverage"]);
    }
    case "going_concern_score": {
      const currentRatio = fs.currentLiabilities > 0 ? fs.currentAssets / fs.currentLiabilities : 99;
      const debtRatio = fs.assets > 0 ? fs.liabilities / fs.assets : 0;
      const netAssets = fs.assets - fs.liabilities;
      const signals = [
        currentRatio < 1 ? "current ratio below 1.0" : "",
        debtRatio > 0.8 ? "debt ratio above 80%" : "",
        netAssets < 0 ? "negative net assets" : "",
        fs.negativeCash > 0 ? "negative cash balance" : "",
      ].filter(Boolean);
      if (signals.length < (threshold || 2)) return empty();
      const score = Math.max(0, 100 - signals.length * 25);
      return fsResult(`Going concern score ${score}/100 based on ${signals.join(", ")}.`, Math.abs(netAssets) + fs.negativeCash, ["Going concern score"]);
    }
  }
}

function evalCloseReviewMetric(rule: AssuranceRule, rows: Record<string, string>[]): RuleResult {
  const metric = rule.closeMetric;
  if (!metric) return empty();

  const pl = profitLossTotals(rows);
  const threshold = rule.threshold ?? 0;

  switch (metric) {
    case "gross_margin_below": {
      if (pl.revenue <= 0 || pl.costOfSales <= 0) return empty();
      const grossProfit = pl.revenue - pl.costOfSales;
      const margin = grossProfit / pl.revenue;
      if (!compare(margin, rule.comparator ?? "lt", threshold || 0.15)) return empty();
      return fsResult(`Revenue ${fc(pl.revenue)} less cost of sales ${fc(pl.costOfSales)} = gross margin ${(margin * 100).toFixed(1)}%.`, Math.abs(grossProfit), ["Gross margin"]);
    }
    case "operating_loss": {
      if (pl.revenue <= 0 && pl.operatingCosts <= 0) return empty();
      const operatingProfit = pl.revenue - pl.costOfSales - pl.operatingCosts - pl.payroll;
      if (operatingProfit >= -threshold) return empty();
      return fsResult(`Revenue ${fc(pl.revenue)} less COGS, payroll and overheads gives operating loss ${fc(operatingProfit)}.`, Math.abs(operatingProfit), ["Operating loss"]);
    }
    case "overhead_ratio_high": {
      if (pl.revenue <= 0 || pl.operatingCosts <= 0) return empty();
      const ratio = pl.operatingCosts / pl.revenue;
      if (!compare(ratio, rule.comparator ?? "gt", threshold || 0.45)) return empty();
      return fsResult(`Operating overheads ${fc(pl.operatingCosts)} / revenue ${fc(pl.revenue)} = ${(ratio * 100).toFixed(1)}%.`, pl.operatingCosts, ["Overhead ratio"]);
    }
    case "payroll_burden_high": {
      if (pl.revenue <= 0 || pl.payroll <= 0) return empty();
      const ratio = pl.payroll / pl.revenue;
      if (!compare(ratio, rule.comparator ?? "gt", threshold || 0.5)) return empty();
      return fsResult(`Payroll costs ${fc(pl.payroll)} / revenue ${fc(pl.revenue)} = ${(ratio * 100).toFixed(1)}%.`, pl.payroll, ["Payroll burden"]);
    }
    case "finance_cost_ratio_high": {
      if (pl.revenue <= 0 || pl.financeCosts <= 0) return empty();
      const ratio = pl.financeCosts / pl.revenue;
      if (!compare(ratio, rule.comparator ?? "gt", threshold || 0.08)) return empty();
      return fsResult(`Finance costs ${fc(pl.financeCosts)} / revenue ${fc(pl.revenue)} = ${(ratio * 100).toFixed(1)}%.`, pl.financeCosts, ["Finance cost ratio"]);
    }
    case "revenue_missing_but_costs_present": {
      const costs = pl.costOfSales + pl.operatingCosts + pl.payroll;
      if (pl.revenue > threshold || costs <= 0) return empty();
      return fsResult(`Revenue is ${fc(pl.revenue)} while operating costs are ${fc(costs)}.`, costs, ["Revenue completeness"]);
    }
  }
}

function evalLedgerMetric(rule: AssuranceRule, rows: Record<string, string>[]): RuleResult {
  const metric = rule.ledgerMetric;
  if (!metric) return empty();

  switch (metric) {
    case "duplicate_reference": {
      const refField = rule.field ?? ["invoice_ref", "reference"];
      const partyField = rule.nameField ?? ["supplier", "customer", "account_name"];
      const groups = new Map<string, { count: number; total: number; names: Set<string> }>();
      for (const row of rows) {
        const ref = resolveField(row, refField).toLowerCase();
        if (!ref || ref.length < 3) continue;
        const amount = Math.abs(resolveNumeric(row, ["amount", "balance", "outstanding"]) ?? 0);
        const key = `${resolveField(row, partyField).toLowerCase()}::${ref}`;
        const item = groups.get(key) ?? { count: 0, total: 0, names: new Set<string>() };
        item.count++;
        item.total += amount;
        item.names.add(resolveField(row, partyField) || ref);
        groups.set(key, item);
      }
      const duplicates = [...groups.values()].filter((item) => item.count > 1);
      if (!duplicates.length) return empty();
      const total = duplicates.reduce((sum, item) => sum + item.total, 0);
      const names = duplicates.flatMap((item) => [...item.names]).slice(0, 3);
      return fsResult(`${duplicates.length} duplicate reference group(s) found — total exposure ${fc(total)}.`, total, names);
    }
    case "duplicate_party_amount_date": {
      const partyField = rule.nameField ?? ["supplier", "customer", "account_name"];
      const groups = new Map<string, { count: number; total: number; names: Set<string> }>();
      for (const row of rows) {
        const party = resolveField(row, partyField);
        const amount = Math.abs(resolveNumeric(row, ["amount", "balance", "outstanding", "invoice_amount"]) ?? 0);
        const rawDate = resolveField(row, ["date", "invoice_date", "posting_date", "entry_date", "due_date"]);
        const parsedDate = resolveDate(row, ["date", "invoice_date", "posting_date", "entry_date", "due_date"]);
        const dateKey = parsedDate ? parsedDate.toISOString().slice(0, 10) : rawDate;
        if (!party || amount <= 0 || !dateKey) continue;
        const key = `${party.toLowerCase()}::${amount.toFixed(2)}::${dateKey}`;
        const item = groups.get(key) ?? { count: 0, total: 0, names: new Set<string>() };
        item.count++;
        item.total += amount;
        item.names.add(party);
        groups.set(key, item);
      }
      const duplicates = [...groups.values()].filter((item) => item.count > 1);
      if (!duplicates.length) return empty();
      const total = duplicates.reduce((sum, item) => sum + item.total, 0);
      const names = duplicates.flatMap((item) => [...item.names]).slice(0, 3);
      return fsResult(`${duplicates.length} supplier/date/amount duplicate group(s) found — exposure ${fc(total)}.`, total, names);
    }
    case "single_party_concentration": {
      const result = concentration(rows, rule.nameField ?? ["customer", "supplier", "account_name"], rule.threshold ?? 0.25, 1);
      if (!result) return empty();
      return fsResult(`${result.names[0]} represents ${(result.share * 100).toFixed(1)}% of ledger value (${fc(result.value)} of ${fc(result.total)}).`, result.value, result.names);
    }
    case "top_five_party_concentration": {
      const result = concentration(rows, rule.nameField ?? ["customer", "supplier", "account_name"], rule.threshold ?? 0.6, 5);
      if (!result) return empty();
      return fsResult(`Top ${result.names.length} parties represent ${(result.share * 100).toFixed(1)}% of ledger value (${fc(result.value)} of ${fc(result.total)}).`, result.value, result.names);
    }
  }
}

function concentration(rows: Record<string, string>[], partyField: string[], threshold: number, topN: number) {
  const totals = new Map<string, number>();
  for (const row of rows) {
    const party = resolveField(row, partyField) || "Unknown";
    const amount = Math.abs(resolveNumeric(row, ["amount", "balance", "outstanding"]) ?? 0);
    if (amount <= 0) continue;
    totals.set(party, (totals.get(party) ?? 0) + amount);
  }
  const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1]);
  const total = ranked.reduce((sum, [, value]) => sum + value, 0);
  if (total <= 0 || ranked.length === 0) return null;
  const selected = ranked.slice(0, topN);
  const value = selected.reduce((sum, [, v]) => sum + v, 0);
  const share = value / total;
  if (share < threshold) return null;
  return { names: selected.map(([name]) => name).slice(0, 3), value, total, share };
}

function financialStatementTotals(rows: Record<string, string>[]) {
  const total = (patterns: RegExp[], exclusions: RegExp[] = []) =>
    rows.reduce((sum, row) => {
      const name = resolveField(row, ["account_name", "description"]).toLowerCase();
      if (!name || exclusions.some((re) => re.test(name)) || !patterns.some((re) => re.test(name))) return sum;
      return sum + Math.abs(resolveNumeric(row, ["balance", "amount"]) ?? 0);
    }, 0);

  const totalFirst = (primary: RegExp[], fallback: RegExp[], exclusions: RegExp[] = []) => {
    const primaryTotal = total(primary, exclusions);
    return primaryTotal > 0 ? primaryTotal : total(fallback, exclusions);
  };

  const signedTotal = (patterns: RegExp[]) =>
    rows.reduce((sum, row) => {
      const name = resolveField(row, ["account_name", "description"]).toLowerCase();
      if (!patterns.some((re) => re.test(name))) return sum;
      return sum + (resolveNumeric(row, ["balance", "amount"]) ?? 0);
    }, 0);

  const assets = totalFirst([/total assets?$/, /^assets?$/], [/fixed assets?/, /current assets?/, /debtors?/, /receivables?/, /inventory/, /stock/, /cash/, /bank/], [/liabilit/, /equity/]);
  const liabilities = totalFirst([/total liabilit/], [/current liabilit/, /creditors?/, /borrowings?/, /loans?/, /lease obligation/, /overdraft/], [/assets?/]);
  const equity = totalFirst([/total equity/, /shareholders'? funds?/, /capital and reserves?/], [/share capital/, /retained earnings/, /profit and loss account/]);

  return {
    assets,
    liabilities,
    equity,
    currentAssets: totalFirst([/current assets?/], [/debtors?/, /receivables?/, /inventory/, /stock/, /cash/, /bank/], [/current liabilit/, /overdraft/]),
    currentLiabilities: totalFirst([/current liabilit/], [/creditors?: amounts falling due within one year/, /trade creditors?/, /payables?/, /overdraft/, /taxation/, /vat creditor/], [/non-current/, /long term/]),
    inventory: total([/inventory/, /stock/, /work in progress/, /\bwip\b/]),
    cash: total([/cash/, /bank/, /current account/], [/overdraft/, /loan/]),
    negativeCash: Math.abs(Math.min(0, signedTotal([/cash/, /bank/, /current account/]))),
    fixedAssets: total([/fixed assets?/, /tangible assets?/, /property,? plant/, /\bppe\b/], [/current/]),
    accumulatedDepreciation: total([/accumulated depreciation/, /depreciation provision/]),
    intangibles: total([/intangible/, /goodwill/, /brand/, /patent/, /licen[cs]e/, /trademark/]),
    accumulatedAmortisation: total([/accumulated amorti[sz]ation/, /amorti[sz]ation provision/]),
    borrowings: total([/bank loan/, /bank borrowing/, /borrowings?/, /term loan/, /\brcf\b/, /revolving credit/, /lease obligation/, /finance lease/]),
  };
}

function profitLossTotals(rows: Record<string, string>[]) {
  const total = (patterns: RegExp[], exclusions: RegExp[] = []) =>
    rows.reduce((sum, row) => {
      const name = resolveField(row, ["account_name", "description"]).toLowerCase();
      if (!name || exclusions.some((re) => re.test(name)) || !patterns.some((re) => re.test(name))) return sum;
      return sum + Math.abs(resolveNumeric(row, ["balance", "amount", "net"]) ?? 0);
    }, 0);

  return {
    revenue: total([/revenue/, /turnover/, /\bsales\b/, /income/], [/cost/, /expense/, /other income/, /interest/]),
    costOfSales: total([/cost of sales/, /\bcogs\b/, /direct cost/, /materials/, /purchases/], [/admin/, /overhead/]),
    operatingCosts: total([/overhead/, /admin/, /administrative/, /selling/, /distribution/, /marketing/, /rent/, /utilities/, /professional fees/, /software/, /subscription/, /insurance/], [/payroll/, /wages/, /salar/]),
    payroll: total([/payroll/, /wages/, /salaries/, /salary/, /staff cost/, /employer.?s? nic/, /national insurance/, /pension/]),
    financeCosts: total([/interest payable/, /interest expense/, /finance charge/, /bank charges/, /loan interest/]),
  };
}

function fsResult(evidence: string, matchTotal: number, matchNames: string[]): RuleResult {
  return {
    triggered: true,
    matchCount: 1,
    matchTotal: Math.abs(matchTotal),
    matchNames,
    evidence,
  };
}

// ─── Finding builder ──────────────────────────────────────────────────────────

// Base confidence scores per tier and confidence level
const CONFIDENCE_SCORE: Record<string, Record<string, number>> = {
  deterministic: { high: 98, medium: 92, low: 85 },
  indicator:     { high: 88, medium: 75, low: 62 },
  advisory:      { high: 68, medium: 55, low: 42 },
};

function buildFinding(rule: AssuranceRule, file: EngineFile, result: RuleResult): Finding {
  const ctx: Record<string, string> = {
    count:    String(result.matchCount),
    total:    fc(result.matchTotal),
    names:    result.matchNames.join(" / ") || "Multiple",
    file:     file.upload.fileName,
    rule:     rule.id,
    pct:      result.matchCount > 0 && result.matchTotal === 0 ? `${result.matchCount}` : `${Math.round(result.matchTotal / 1000)}k`,
  };

  return {
    id: `eng_${rule.id}_${file.upload.id}`,
    tenantId: file.upload.tenantId,
    companyId: file.upload.companyId,
    severity: rule.severity,
    category: rule.category,
    title: interpolate(rule.message, ctx),
    description: interpolate(rule.detail ?? rule.description, ctx),
    expectedImpact: interpolate(rule.impact ?? "", ctx),
    status: "open",
    confidence: rule.confidence,
    confidenceScore: CONFIDENCE_SCORE[rule.evidenceStrength ?? "indicator"][rule.confidence] ?? 75,
    ruleId: rule.id,
    evidenceStrength: rule.evidenceStrength ?? "indicator",
    evidence: {
      sourceFile: file.upload.fileName,
      accountCode: ctx.names,
      period: file.upload.uploadedAt,
      calculation: result.evidence,
      rows: result.rows?.map((row) => ({ ...row, sourceFile: file.upload.fileName, period: file.upload.uploadedAt })),
      matchCount: result.matchCount,
      matchValue: result.matchTotal,
      matchNames: result.matchNames,
    }
  };
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function empty(): RuleResult {
  return { triggered: false, matchCount: 0, matchTotal: 0, matchNames: [], evidence: "" };
}

function evidenceRows(rows: Record<string, string>[], nameField: string[], amountField: string[]): FindingEvidenceRow[] {
  return rows.slice(0, 10).map((row) => ({
    sourceFile: "",
    sheetName: cleanMeta(row.__sourceSheetName),
    rowIndex: numericMeta(row.__sourceRowIndex),
    accountCode: resolveField(row, nameField) || undefined,
    amount: resolveNumeric(row, amountField) ?? undefined,
    sourceRow: stripMeta(row),
  }));
}

function stripMeta(row: Record<string, string>) {
  return Object.fromEntries(Object.entries(row).filter(([key]) => !key.startsWith("__")));
}

function resolveSignedAmount(row: Record<string, string>, amountField: string[]) {
  const direct = resolveNumeric(row, amountField);
  if (direct !== null) return direct;
  const debit = resolveNumeric(row, ["debit"]);
  const credit = resolveNumeric(row, ["credit"]);
  if (debit !== null || credit !== null) return (debit ?? 0) - (credit ?? 0);
  return 0;
}

function cleanMeta(value: string | undefined) {
  return value?.trim() || undefined;
}

function numericMeta(value: string | undefined) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function compare(v: number, op: Comparator, threshold: number): boolean {
  switch (op) {
    case "gt":  return v > threshold;
    case "lt":  return v < threshold;
    case "gte": return v >= threshold;
    case "lte": return v <= threshold;
    case "eq":  return Math.abs(v - threshold) < 0.01;
    case "ne":  return Math.abs(v - threshold) >= 0.01;
  }
}

function interpolate(template: string, ctx: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, k) => ctx[k] ?? k);
}

function parseDayBucket(raw: string): number {
  if (!raw) return 0;
  if (raw.includes("120")) return 120;
  if (raw.includes("90"))  return 90;
  if (raw.includes("60"))  return 60;
  const n = Number(raw.replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function fc(v: number): string {
  return `£${Math.round(Math.abs(v)).toLocaleString()}`;
}
