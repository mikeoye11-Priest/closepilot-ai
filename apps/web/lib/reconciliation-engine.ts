import type { Finding, FindingEvidenceRow, Upload, ValidationCheck } from "./types";

export type ReconciliationFile = {
  upload: Upload;
  headers: string[];
  rows: Record<string, string>[];
  isParsed: boolean;
};

type ReconciliationResult = {
  validationChecks: ValidationCheck[];
  findings: Finding[];
};

const ACCOUNT_NAME_KEYS = ["account_name","account_description","nominal","gl_account","ledger_account","account","description","item","account_code","nominal_code","acc_name","g_l_account_long_text","gl_account_long_text"];
const BALANCE_KEYS = ["balance","closing_balance","balance_at_date","net","amount","amount_company_code_currency","amount_transaction_currency","closing_balance","net_movement","movement","net_change","debit_ytd","credit_ytd"];
const DEBIT_KEYS = ["debit","debits","dr","debit_amount"];
const CREDIT_KEYS = ["credit","credits","cr","credit_amount"];
const AR_AMOUNT_KEYS = ["over_60","60_days","60_plus","90_days","120_days","over_90","over_120","days_31_60","days_61_90","days_91_plus","overdue","due","due_local","overdue_balance","amount","balance","outstanding","total","total_outstanding","net_balance"];
const AP_AMOUNT_KEYS = ["amount","balance","outstanding","invoice_amount","net_amount","total","total_due","due","due_local","days_31_60","days_61_90","days_91_plus","value","gross","net"];
const VAT_AMOUNT_KEYS = ["vat_amount","tax_amount","vat","tax","gst_amount","vat_value","tax_value"];
const VAT_TYPE_KEYS = ["type","transaction_type","vat_direction","direction","supply_type"];

export function runReconciliationEngine(files: ReconciliationFile[]): ReconciliationResult {
  const parsed = files.filter((file) => file.isParsed);
  const validationChecks: ValidationCheck[] = [];
  const findings: Finding[] = [];
  const tbFile = parsed.find((file) => file.upload.fileType === "trial_balance" && !isBankReconciliationFile(file));
  const arFile = parsed.find((file) => file.upload.fileType === "aged_debtors");
  const apFile = parsed.find((file) => file.upload.fileType === "aged_creditors");
  const vatFile = parsed.find((file) => file.upload.fileType === "vat_report");
  const bsFile = parsed.find((file) => file.upload.fileType === "balance_sheet");
  const plFile = parsed.find((file) => file.upload.fileType === "profit_loss");
  const bankReconFile = parsed.find(isBankReconciliationFile);
  const tenantId = parsed[0]?.upload.tenantId ?? "tenant_demo";
  const companyId = parsed[0]?.upload.companyId ?? "company_demo";

  const record = (
    id: string,
    file: ReconciliationFile | undefined,
    name: string,
    status: ValidationCheck["status"],
    detail: string,
    finding?: Omit<Finding, "tenantId" | "companyId" | "status" | "confidence" | "evidenceStrength" | "evidence">
      & { sourceFile: string; accountCode: string; calculation: string; rows?: FindingEvidenceRow[] }
  ) => {
    validationChecks.push({
      id,
      tenantId: file?.upload.tenantId ?? tenantId,
      companyId: file?.upload.companyId ?? companyId,
      name,
      status,
      detail,
    });

    if (!finding) return;
    findings.push({
      id: finding.id,
      tenantId: file?.upload.tenantId ?? tenantId,
      companyId: file?.upload.companyId ?? companyId,
      severity: finding.severity,
      category: finding.category,
      title: finding.title,
      description: finding.description,
      expectedImpact: finding.expectedImpact,
      status: "open",
      confidence: "high",
      confidenceScore: 95,
      ruleId: finding.ruleId,
      evidenceStrength: "deterministic",
      evidence: {
        sourceFile: finding.sourceFile,
        accountCode: finding.accountCode,
        period: file?.upload.uploadedAt ?? new Date().toISOString().slice(0, 10),
        calculation: finding.calculation,
        rows: finding.rows,
      },
    });
  };

  if (tbFile && arFile) {
    const arTotal = sumRows(arFile.rows, AR_AMOUNT_KEYS);
    const tbDebtorRows = matchingRows(tbFile.rows, [/trade\s*debtor|accounts\s*receivable|debtor\s*control|receivables/i]);
    const tbDebtors = Math.abs(sumRows(tbDebtorRows, BALANCE_KEYS));
    const diff = Math.abs(arTotal - tbDebtors);
    const passed = tbDebtors > 0 && diff <= tolerance(tbDebtors);
    record(
      "rec_val_ar_control",
      arFile,
      "AR ledger agrees to debtors control",
      passed ? "passed" : "failed",
      passed ? `PASS: AR aging ${fc(arTotal)} agrees to TB debtors control ${fc(tbDebtors)}. Difference ${fc(diff)}.` : `FAIL: AR aging ${fc(arTotal)} vs TB debtors control ${fc(tbDebtors)}. Difference ${fc(diff)}.`,
      passed ? undefined : reconciliationFinding("rec_001_ar_control", "REC_001", "ar", diff > 10000 ? "high" : "medium", `AR aging does not reconcile to debtors control — ${fc(diff)} difference`, `Aged debtors total ${fc(arTotal)} does not agree to the TB debtors control account ${fc(tbDebtors)}. This is a core cross-file reconciliation failure.`, `Unreconciled AR difference ${fc(diff)}`, arFile, "AR vs debtors control", `AR aging ${fc(arTotal)} - TB debtors control ${fc(tbDebtors)} = ${fc(diff)}.`, [
        ...evidenceRows(arFile, arFile.rows, "AR aging total", AR_AMOUNT_KEYS, { side: "subledger", total: arTotal }),
        ...evidenceRows(tbFile, tbDebtorRows, "TB debtors control", BALANCE_KEYS, { side: "control", total: tbDebtors }),
      ])
    );
  }

  if (tbFile && apFile) {
    const apTotal = sumRows(apFile.rows, AP_AMOUNT_KEYS);
    const tbCreditorRows = matchingRows(tbFile.rows, [/trade\s*creditor|accounts\s*payable|creditor\s*control|payables/i]);
    const tbCreditors = Math.abs(sumRows(tbCreditorRows, BALANCE_KEYS));
    const diff = Math.abs(apTotal - tbCreditors);
    const passed = tbCreditors > 0 && diff <= tolerance(tbCreditors);
    record(
      "rec_val_ap_control",
      apFile,
      "AP ledger agrees to creditors control",
      passed ? "passed" : "failed",
      passed ? `PASS: AP aging ${fc(apTotal)} agrees to TB creditors control ${fc(tbCreditors)}. Difference ${fc(diff)}.` : `FAIL: AP aging ${fc(apTotal)} vs TB creditors control ${fc(tbCreditors)}. Difference ${fc(diff)}.`,
      passed ? undefined : reconciliationFinding("rec_002_ap_control", "REC_002", "ap", diff > 10000 ? "high" : "medium", `AP aging does not reconcile to creditors control — ${fc(diff)} difference`, `Aged creditors total ${fc(apTotal)} does not agree to the TB creditors control account ${fc(tbCreditors)}. Supplier balances should not be signed off until this difference is explained.`, `Unreconciled AP difference ${fc(diff)}`, apFile, "AP vs creditors control", `AP aging ${fc(apTotal)} - TB creditors control ${fc(tbCreditors)} = ${fc(diff)}.`, [
        ...evidenceRows(apFile, apFile.rows, "AP aging total", AP_AMOUNT_KEYS, { side: "subledger", total: apTotal }),
        ...evidenceRows(tbFile, tbCreditorRows, "TB creditors control", BALANCE_KEYS, { side: "control", total: tbCreditors }),
      ])
    );
  }

  if (tbFile && vatFile) {
    const vatTotal = vatReturnNetAmount(vatFile.rows) ?? vatNetByType(vatFile.rows) ?? Math.abs(sumRows(vatFile.rows, VAT_AMOUNT_KEYS));
    const tbVatRows = matchingRows(tbFile.rows, [/\bvat\b|\bgst\b|sales\s*tax|vat\s*control|vat\s*liabilit|tax\s*control|tax payable/i]);
    const tbVat = Math.abs(sumRows(tbVatRows, BALANCE_KEYS));
    const diff = Math.abs(vatTotal - tbVat);
    const passed = tbVat > 0 && diff <= tolerance(tbVat);
    record(
      "rec_val_vat_control",
      vatFile,
      "VAT report agrees to VAT control",
      passed ? "passed" : "failed",
      passed ? `PASS: VAT report ${fc(vatTotal)} agrees to TB VAT control ${fc(tbVat)}. Difference ${fc(diff)}.` : `FAIL: VAT report ${fc(vatTotal)} vs TB VAT control ${fc(tbVat)}. Difference ${fc(diff)}.`,
      passed ? undefined : reconciliationFinding("rec_003_vat_control", "REC_003", "vat", diff > 5000 ? "high" : "medium", `VAT report does not reconcile to VAT control — ${fc(diff)} difference`, `VAT report total ${fc(vatTotal)} does not agree to the TB VAT control account ${fc(tbVat)}. The VAT return should not be treated as ready until this is reconciled.`, `VAT control difference ${fc(diff)}`, vatFile, "VAT report vs VAT control", `VAT report ${fc(vatTotal)} - TB VAT control ${fc(tbVat)} = ${fc(diff)}.`, [
        ...evidenceRows(vatFile, vatFile.rows, "VAT report total", VAT_AMOUNT_KEYS, { side: "subledger", total: vatTotal }),
        ...evidenceRows(tbFile, tbVatRows, "TB VAT control", BALANCE_KEYS, { side: "control", total: tbVat }),
      ])
    );
  }

  if (bsFile) {
    const equation = balanceSheetEquation(bsFile.rows);
    const passed = equation.diff <= tolerance(equation.assets);
    record(
      "rec_val_bs_equation",
      bsFile,
      "Balance sheet equation",
      passed ? "passed" : "failed",
      passed ? `PASS: Assets ${fc(equation.assets)} equal liabilities ${fc(equation.liabilities)} + equity ${fc(equation.equity)}.` : `FAIL: Assets ${fc(equation.assets)} vs liabilities ${fc(equation.liabilities)} + equity ${fc(equation.equity)}. Difference ${fc(equation.diff)}.`,
      passed ? undefined : reconciliationFinding("rec_004_bs_equation", "REC_004", "data_quality", "critical", `Balance sheet equation does not balance — ${fc(equation.diff)} difference`, `Assets must equal liabilities plus equity. This balance sheet is structurally unreconciled and should block sign-off.`, `Balance sheet equation difference ${fc(equation.diff)}`, bsFile, "Balance sheet equation", `Assets ${fc(equation.assets)} - liabilities ${fc(equation.liabilities)} - equity ${fc(equation.equity)} = ${fc(equation.diff)}.`, evidenceRows(bsFile, bsFile.rows, "Balance sheet equation inputs", BALANCE_KEYS, equation))
    );
  }

  if (tbFile && bankReconFile) {
    const tbBankRows = matchingRows(tbFile.rows, [/\bbank\b|current account|cash at bank|petty cash|checking|savings/i], [/overdraft|loan|interest|charges?|\bfees?\b|sales|revenue|income|receivable|payable/i]);
    const tbBank = Math.abs(sumRows(tbBankRows, BALANCE_KEYS));
    const reconBank = bankStatementBalance(bankReconFile.rows) ?? Math.abs(sumRows(bankReconFile.rows, BALANCE_KEYS));
    const diff = Math.abs(reconBank - tbBank);
    const passed = tbBank > 0 && reconBank > 0 && diff <= tolerance(tbBank);
    record(
      "rec_val_bank_reconciliation",
      bankReconFile,
      "Bank reconciliation agrees to TB bank balance",
      passed ? "passed" : "failed",
      passed ? `PASS: Bank reconciliation ${fc(reconBank)} agrees to TB bank balance ${fc(tbBank)}.` : `FAIL: Bank reconciliation ${fc(reconBank)} vs TB bank balance ${fc(tbBank)}. Difference ${fc(diff)}.`,
      passed ? undefined : reconciliationFinding("rec_005_bank_reconciliation", "REC_005", "controls", "high", `Bank reconciliation does not agree to TB — ${fc(diff)} difference`, `Bank reconciliation balance ${fc(reconBank)} does not agree to the TB bank balance ${fc(tbBank)}. Cash should not be signed off until reconciling items are explained.`, `Bank reconciliation difference ${fc(diff)}`, bankReconFile, "Bank reconciliation vs TB bank", `Bank reconciliation ${fc(reconBank)} - TB bank ${fc(tbBank)} = ${fc(diff)}.`, [
        ...evidenceRows(bankReconFile, bankReconFile.rows, "Bank reconciliation balance", BALANCE_KEYS, { side: "reconciliation", total: reconBank }),
        ...evidenceRows(tbFile, tbBankRows, "TB bank control", BALANCE_KEYS, { side: "control", total: tbBank }),
      ])
    );
  } else if (tbFile) {
    record("rec_val_bank_reconciliation", tbFile, "Bank reconciliation agrees to TB bank balance", "warning", "Bank reconciliation file not identified — bank agreement could not be independently tested.");
  }

  if (tbFile && plFile) {
    record(
      "rec_val_pl_retained_earnings",
      plFile,
      "P&L movement agrees to retained earnings",
      "warning",
      "Prior-period equity movement data is required before P&L to retained earnings can be tested reliably."
    );
  }

  return { validationChecks, findings };
}

function reconciliationFinding(
  id: string,
  ruleId: string,
  category: Finding["category"],
  severity: Finding["severity"],
  title: string,
  description: string,
  expectedImpact: string,
  file: ReconciliationFile,
  accountCode: string,
  calculation: string,
  rows?: FindingEvidenceRow[]
) {
  return {
    id,
    ruleId,
    category,
    severity,
    title,
    description,
    expectedImpact,
    sourceFile: file.upload.fileName,
    accountCode,
    calculation,
    rows,
  };
}

function isBankReconciliationFile(file: ReconciliationFile) {
  return file.upload.fileType === "bank_reconciliation" || /bank.?recon|bank.?rec|bank.?statement|cashbook/i.test(file.upload.fileName);
}

function vatReturnNetAmount(rows: Record<string, string>[]): number | null {
  const boxFive = rows.find((row) => /box\s*5|net vat/i.test(rowText(row)));
  if (!boxFive) return null;
  return Math.abs(firstNumeric(boxFive));
}

// Net VAT position (output minus input) using each row's transaction type, so a
// transaction-level VAT report is compared to the VAT control account on a net
// basis rather than a gross sum of both sides. Credit notes already carry negated
// amounts, so they net down the correct side. Null when rows carry no direction.
function vatNetByType(rows: Record<string, string>[]): number | null {
  if (!rows.some((row) => val(row, VAT_TYPE_KEYS))) return null;
  let net = 0;
  for (const row of rows) {
    const vat = numeric(val(row, VAT_AMOUNT_KEYS));
    const isInput = /purchase|input|payable|accpay|bill|expense/i.test(val(row, VAT_TYPE_KEYS));
    net += isInput ? -vat : vat;
  }
  return Math.abs(net);
}

function bankStatementBalance(rows: Record<string, string>[]): number | null {
  const statement = rows.find((row) => /bank statement balance/i.test(rowText(row)));
  if (!statement) return null;
  return Math.abs(firstNumeric(statement));
}

function firstNumeric(row: Record<string, string>): number {
  for (const value of Object.values(row)) {
    const parsed = numeric(value);
    if (parsed) return parsed;
  }
  return 0;
}

function val(row: Record<string, string>, keys: string[]): string {
  for (const key of keys) {
    if (row[key]) return row[key].trim();
  }
  return "";
}

function amount(row: Record<string, string>, keys: string[]): number {
  const debit = numeric(val(row, DEBIT_KEYS));
  const credit = numeric(val(row, CREDIT_KEYS));
  if (debit || credit) return debit - credit;
  return numeric(val(row, keys));
}

function numeric(raw: string) {
  if (!raw) return 0;
  const cleaned = raw.replace(/[£$€,\s]/g, "").replace(/^\((.*)\)$/, "-$1");
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function sumRows(rows: Record<string, string>[], keys: string[]) {
  return rows.reduce((sum, row) => sum + Math.abs(amount(row, keys)), 0);
}

function matchingRows(rows: Record<string, string>[], include: RegExp[], exclude: RegExp[] = []) {
  return rows.filter((row) => {
    const text = rowText(row);
    return include.some((pattern) => pattern.test(text)) && !exclude.some((pattern) => pattern.test(text));
  });
}

function evidenceRows(
  file: ReconciliationFile,
  rows: Record<string, string>[],
  label: string,
  amountKeys: string[],
  calculationInput: Record<string, string | number | boolean | null>
): FindingEvidenceRow[] {
  return rows.slice(0, 20).map((row) => ({
    sourceFile: file.upload.fileName,
    sheetName: metaString(row.__sourceSheetName),
    rowIndex: metaNumber(row.__sourceRowIndex),
    accountCode: val(row, ACCOUNT_NAME_KEYS) || label,
    period: file.upload.uploadedAt,
    amount: Math.abs(amount(row, amountKeys)) || undefined,
    sourceRow: stripMeta(row),
    calculationInput: {
      label,
      ...calculationInput,
    },
  }));
}

function stripMeta(row: Record<string, string>) {
  return Object.fromEntries(Object.entries(row).filter(([key]) => !key.startsWith("__")));
}

function metaString(value: string | undefined) {
  return value?.trim() || undefined;
}

function metaNumber(value: string | undefined) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function rowText(row: Record<string, string>) {
  return Object.values(row).join(" ");
}

function sumMatchingRows(rows: Record<string, string>[], include: RegExp[], exclude: RegExp[] = []) {
  return matchingRows(rows, include, exclude).reduce((sum, row) => sum + amount(row, BALANCE_KEYS), 0);
}

function totalLine(rows: Record<string, string>[], patterns: RegExp[]): number | null {
  const row = rows.find((item) => {
    const label = Object.entries(item)
      .filter(([key, value]) => !key.startsWith("__") && !BALANCE_KEYS.includes(key) && !DEBIT_KEYS.includes(key) && !CREDIT_KEYS.includes(key) && !/^-?[£$,\d\s().]+$/.test(value.trim()))
      .map(([, value]) => value)
      .join(" ")
      .trim();
    return patterns.some((pattern) => pattern.test(label));
  });
  return row ? Math.abs(amount(row, BALANCE_KEYS)) : null;
}

function balanceSheetEquation(rows: Record<string, string>[]) {
  const totalAssets = totalLine(rows, [/^total assets?$/i]);
  const totalLiabilities = totalLine(rows, [/^total liabilities?$/i]);
  const totalEquity = totalLine(rows, [/^total equity$/i, /^total shareholders'? funds?$/i, /^total capital and reserves?$/i]);

  if (totalAssets !== null && totalLiabilities !== null && totalEquity !== null) {
    return { assets: totalAssets, liabilities: totalLiabilities, equity: totalEquity, diff: Math.abs(totalAssets - totalLiabilities - totalEquity) };
  }

  const assets = Math.abs(sumMatchingRows(rows, [/asset|cash|bank|debtor|receivable|stock|inventory|prepayment/i], [/liabilit|equity/i]));
  const liabilities = Math.abs(sumMatchingRows(rows, [/liabilit|creditor|payable|loan|borrowing|accrual|vat payable/i], [/asset|equity/i]));
  const equity = Math.abs(sumMatchingRows(rows, [/equity|share capital|retained earnings|capital and reserve|shareholders/i], [/total liabilities/i]));
  return { assets, liabilities, equity, diff: Math.abs(assets - liabilities - equity) };
}

function profitLossMovement(rows: Record<string, string>[]) {
  return rows.reduce((sum, row) => sum + amount(row, BALANCE_KEYS), 0);
}

function tolerance(value: number) {
  return Math.max(100, Math.abs(value) * 0.005);
}

function fc(value: number) {
  return `£${Math.round(Math.abs(value)).toLocaleString()}`;
}

function signedFc(value: number) {
  return `${value < 0 ? "-" : ""}${fc(value)}`;
}
