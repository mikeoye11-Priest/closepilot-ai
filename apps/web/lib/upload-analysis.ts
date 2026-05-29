import { company, tenant } from "./data";
import type { AnalysisResult, Company, Finding, Recommendation, Tenant, Upload, ValidationCheck } from "./types";

type ParsedFile = {
  upload: Upload;
  headers: string[];
  rows: Record<string, string>[];
  isParsed: boolean;
};
export type { ParsedFile };

const fileTypeLabels: Record<Upload["fileType"], string> = {
  trial_balance: "Trial Balance",
  profit_loss: "P&L",
  balance_sheet: "Balance Sheet",
  aged_debtors: "Aged Debtors",
  aged_creditors: "Aged Creditors",
  vat_report: "VAT Report"
};

export async function analyseFinanceFiles(files: File[]): Promise<AnalysisResult> {
  const parsed = await Promise.all(files.map(parseFile));
  return analyseParsedFiles(parsed);
}

export function analyseParsedFiles(parsed: ParsedFile[]): AnalysisResult {
  const validationChecks = buildValidationChecks(parsed);
  const findings = buildFindings(parsed);
  const recommendations = buildRecommendations(findings);

  return {
    uploads: parsed.map((file) => file.upload),
    validationChecks,
    findings,
    recommendations
  };
}

export function scopeAnalysisResult(result: AnalysisResult, scopeTenant: Tenant, scopeCompany: Company): AnalysisResult {
  return {
    uploads: result.uploads.map((upload) => ({ ...upload, tenantId: scopeTenant.id, companyId: scopeCompany.id })),
    validationChecks: result.validationChecks.map((check) => ({ ...check, tenantId: scopeTenant.id, companyId: scopeCompany.id })),
    findings: result.findings.map((finding) => ({ ...finding, tenantId: scopeTenant.id, companyId: scopeCompany.id })),
    recommendations: result.recommendations.map((recommendation) => ({ ...recommendation, tenantId: scopeTenant.id, companyId: scopeCompany.id }))
  };
}

async function parseFile(file: File): Promise<ParsedFile> {
  const fileType = inferFileType(file.name);
  const canParse = /\.(csv|tsv|txt)$/i.test(file.name);
  const upload: Upload = {
    id: `up_${crypto.randomUUID()}`,
    tenantId: tenant.id,
    companyId: company.id,
    fileType,
    fileName: file.name,
    uploadedAt: new Date().toISOString().slice(0, 10)
  };

  if (!canParse) {
    return { upload, headers: [], rows: [], isParsed: false };
  }

  const text = await file.text();
  const { headers, rows } = parseDelimitedText(text, file.name.toLowerCase().endsWith(".tsv") ? "\t" : undefined);

  return { upload: { ...upload, rowCount: rows.length }, headers, rows, isParsed: true };
}

export function createUpload(fileName: string, rowCount?: number): Upload {
  return {
    id: `up_${crypto.randomUUID()}`,
    tenantId: tenant.id,
    companyId: company.id,
    fileType: inferFileType(fileName),
    fileName,
    uploadedAt: new Date().toISOString().slice(0, 10),
    rowCount
  };
}

export function parseDelimitedText(text: string, delimiter?: string) {
  const selectedDelimiter = delimiter ?? detectDelimiter(text);
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const headers = splitLine(lines[0] ?? "", selectedDelimiter).map(normaliseHeader);
  const rows = lines.slice(1).map((line) => {
    const cells = splitLine(line, selectedDelimiter);
    return Object.fromEntries(headers.map((header, index) => [header, cells[index]?.trim() ?? ""]));
  });
  return { headers, rows };
}

function detectDelimiter(text: string) {
  const firstLine = text.split(/\r?\n/)[0] ?? "";
  return firstLine.includes("\t") ? "\t" : ",";
}

function splitLine(line: string, delimiter: string) {
  const result: string[] = [];
  let current = "";
  let quoted = false;

  for (const char of line) {
    if (char === "\"") {
      quoted = !quoted;
      continue;
    }
    if (char === delimiter && !quoted) {
      result.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  result.push(current);
  return result;
}

export function normaliseHeader(header: string) {
  return header.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

export function inferFileType(fileName: string): Upload["fileType"] {
  const name = fileName.toLowerCase();
  if (name.includes("debtor") || name.includes("ar") || name.includes("receivable")) return "aged_debtors";
  if (name.includes("creditor") || name.includes("ap") || name.includes("payable")) return "aged_creditors";
  if (name.includes("vat") || name.includes("tax")) return "vat_report";
  if (name.includes("p&l") || name.includes("profit") || name.includes("loss")) return "profit_loss";
  if (name.includes("balance_sheet") || name.includes("balance-sheet") || name.includes("bs_")) return "balance_sheet";
  return "trial_balance";
}

function buildValidationChecks(files: ParsedFile[]): ValidationCheck[] {
  const checks: ValidationCheck[] = [];
  const required: Upload["fileType"][] = ["trial_balance", "profit_loss", "balance_sheet", "aged_debtors", "aged_creditors", "vat_report"];
  const defaultTenantId = files[0]?.upload.tenantId ?? tenant.id;
  const defaultCompanyId = files[0]?.upload.companyId ?? company.id;

  required.forEach((fileType) => {
    const matching = files.filter((file) => file.upload.fileType === fileType);
    checks.push({
      id: `val_present_${fileType}`,
      tenantId: matching[0]?.upload.tenantId ?? defaultTenantId,
      companyId: matching[0]?.upload.companyId ?? defaultCompanyId,
      name: `${fileTypeLabels[fileType]} uploaded`,
      status: matching.length ? "passed" : "warning",
      detail: matching.length ? `${matching.length} ${fileTypeLabels[fileType]} file(s) available for review.` : `${fileTypeLabels[fileType]} was not uploaded, so related checks are limited.`
    });
  });

  files.filter((file) => !file.isParsed).forEach((file) => {
    checks.push({
      id: `val_parser_${file.upload.id}`,
      tenantId: file.upload.tenantId,
      companyId: file.upload.companyId,
      name: `${file.upload.fileName} parser support`,
      status: "warning",
      detail: "File was registered, but this MVP only performs deterministic row-level analysis on CSV, TSV and TXT exports. Use CSV export for evidence-linked findings."
    });
  });

  const tbFiles = files.filter((file) => file.upload.fileType === "trial_balance" && file.isParsed);
  tbFiles.forEach((file) => {
    const debitTotal = sumColumn(file.rows, ["debit", "debits", "dr"]);
    const creditTotal = sumColumn(file.rows, ["credit", "credits", "cr"]);
    const amountTotal = sumColumn(file.rows, ["amount", "balance", "closing_balance"]);
    const hasDebitCredit = debitTotal > 0 || creditTotal > 0;
    const difference = hasDebitCredit ? debitTotal - creditTotal : amountTotal;
    const passed = Math.abs(difference) <= 1;
    checks.push({
      id: `val_tb_balance_${file.upload.id}`,
      tenantId: file.upload.tenantId,
      companyId: file.upload.companyId,
      name: "Trial balance balances to zero",
      status: passed ? "passed" : "failed",
      detail: hasDebitCredit ? `Debit total ${formatCurrency(debitTotal)} vs credit total ${formatCurrency(creditTotal)}. Difference ${formatCurrency(difference)}.` : `Amount/balance column total is ${formatCurrency(amountTotal)}.`
    });
  });

  const vatFiles = files.filter((file) => file.upload.fileType === "vat_report" && file.isParsed);
  vatFiles.forEach((file) => {
    const missingVatCodes = file.rows.filter((row) => !value(row, ["vat_code", "tax_code", "vat_rate", "tax_rate"])).length;
    checks.push({
      id: `val_vat_codes_${file.upload.id}`,
      tenantId: file.upload.tenantId,
      companyId: file.upload.companyId,
      name: "VAT coding completeness",
      status: missingVatCodes ? "warning" : "passed",
      detail: missingVatCodes ? `${missingVatCodes} transaction(s) have missing VAT/tax code values.` : "All VAT rows include VAT/tax code values."
    });
  });

  return checks;
}

function buildFindings(files: ParsedFile[]): Finding[] {
  return [
    ...buildArFindings(files),
    ...buildApFindings(files),
    ...buildVatFindings(files),
    ...buildMonthEndFindings(files)
  ];
}

function buildArFindings(files: ParsedFile[]): Finding[] {
  const findings: Finding[] = [];
  files.filter((file) => file.upload.fileType === "aged_debtors" && file.isParsed).forEach((file) => {
    const overdueRows = file.rows
      .map((row) => ({
        customer: value(row, ["customer", "debtor", "name", "account_name"]) || "Unknown debtor",
        amount: amount(row, ["over_60", "60_days", "60_plus", "90_days", "overdue", "amount", "balance"]),
        days: amount(row, ["days_overdue", "age", "age_days"])
      }))
      .filter((row) => row.amount > 0 && (row.days >= 60 || row.amount >= 10000))
      .sort((a, b) => b.amount - a.amount);

    const total = overdueRows.reduce((sum, row) => sum + row.amount, 0);
    if (total > 0) {
      const top = overdueRows.slice(0, 3);
      findings.push({
        id: `finding_ar_${file.upload.id}`,
        tenantId: file.upload.tenantId,
        companyId: file.upload.companyId,
        severity: total > 50000 ? "critical" : "high",
        category: "ar",
        title: `${top.length} debtor${top.length === 1 ? "" : "s"} create ${formatCurrency(total)} overdue cash risk`,
        description: "Aged debtor export shows material overdue balances requiring collections review.",
        expectedImpact: `${formatCurrency(total)} collection exposure`,
        status: "open",
        confidence: "high",
        evidence: {
          sourceFile: file.upload.fileName,
          accountCode: top.map((row) => row.customer).join(" / "),
          period: file.upload.uploadedAt,
          calculation: `Rows with 60+ day age or material overdue balance total ${formatCurrency(total)}.`
        }
      });
    }
  });
  return findings;
}

function buildApFindings(files: ParsedFile[]): Finding[] {
  const findings: Finding[] = [];
  files.filter((file) => file.upload.fileType === "aged_creditors" && file.isParsed).forEach((file) => {
    const seen = new Map<string, Record<string, string>[]>();
    file.rows.forEach((row) => {
      const supplier = value(row, ["supplier", "creditor", "vendor", "name"]) || "unknown";
      const invoiceDate = value(row, ["invoice_date", "date", "transaction_date"]) || "unknown";
      const invoiceAmount = amount(row, ["amount", "balance", "gross", "invoice_amount"]);
      if (!invoiceAmount) return;
      const key = `${supplier}|${invoiceDate}|${invoiceAmount.toFixed(2)}`;
      seen.set(key, [...(seen.get(key) ?? []), row]);
    });

    const duplicate = [...seen.entries()].find(([, rows]) => rows.length > 1);
    if (duplicate) {
      const [key, rows] = duplicate;
      const [supplier, invoiceDate, invoiceAmount] = key.split("|");
      findings.push({
        id: `finding_ap_${file.upload.id}`,
        tenantId: file.upload.tenantId,
        companyId: file.upload.companyId,
        severity: "medium",
        category: "ap",
        title: "Possible duplicate supplier invoice",
        description: `${rows.length} AP rows share supplier, date and amount.`,
        expectedImpact: `${formatCurrency(Number(invoiceAmount))} potential leakage avoided`,
        status: "open",
        confidence: "medium",
        evidence: {
          sourceFile: file.upload.fileName,
          accountCode: supplier,
          period: invoiceDate,
          calculation: `${rows.length} rows match supplier ${supplier}, date ${invoiceDate}, amount ${formatCurrency(Number(invoiceAmount))}.`
        }
      });
    }
  });
  return findings;
}

function buildVatFindings(files: ParsedFile[]): Finding[] {
  const findings: Finding[] = [];
  files.filter((file) => file.upload.fileType === "vat_report" && file.isParsed).forEach((file) => {
    const missing = file.rows.filter((row) => !value(row, ["vat_code", "tax_code", "vat_rate", "tax_rate"]));
    if (missing.length) {
      findings.push({
        id: `finding_vat_${file.upload.id}`,
        tenantId: file.upload.tenantId,
        companyId: file.upload.companyId,
        severity: missing.length > 25 ? "high" : "medium",
        category: "vat",
        title: `Missing VAT codes on ${missing.length} transaction${missing.length === 1 ? "" : "s"}`,
        description: "VAT detail contains transactions without a VAT/tax treatment.",
        expectedImpact: "Potential VAT return exception",
        status: "in_review",
        confidence: "high",
        evidence: {
          sourceFile: file.upload.fileName,
          accountCode: "VAT detail",
          period: file.upload.uploadedAt,
          calculation: `${missing.length} row(s) have blank VAT/tax code fields.`
        }
      });
    }
  });
  return findings;
}

function buildMonthEndFindings(files: ParsedFile[]): Finding[] {
  const findings: Finding[] = [];
  files.filter((file) => file.upload.fileType === "trial_balance" && file.isParsed).forEach((file) => {
    const expenseRows = file.rows.filter((row) => /logistics|utilities|professional|freight|rent|insurance/i.test(Object.values(row).join(" ")));
    const amountTotal = Math.abs(expenseRows.reduce((sum, row) => sum + amount(row, ["amount", "balance", "closing_balance", "debit"]), 0));
    if (expenseRows.length && amountTotal < 30000) {
      findings.push({
        id: `finding_close_${file.upload.id}`,
        tenantId: file.upload.tenantId,
        companyId: file.upload.companyId,
        severity: "medium",
        category: "month_end",
        title: "Potential missing accrual review",
        description: "Selected recurring expense categories appear low in the uploaded trial balance.",
        expectedImpact: "Close adjustment may be required",
        status: "open",
        confidence: "low",
        evidence: {
          sourceFile: file.upload.fileName,
          accountCode: "Recurring expense accounts",
          period: file.upload.uploadedAt,
          calculation: `${expenseRows.length} recurring expense row(s) total ${formatCurrency(amountTotal)}. Requires prior-period comparator for higher confidence.`
        }
      });
    }
  });
  return findings;
}

function buildRecommendations(findings: Finding[]): Recommendation[] {
  return findings.map((finding) => ({
    id: `rec_${finding.id}`,
    tenantId: finding.tenantId,
    companyId: finding.companyId,
    findingId: finding.id,
    action: recommendationFor(finding),
    expectedImpact: finding.expectedImpact,
    priority: finding.severity === "critical" || finding.severity === "high" ? "high" : "medium",
    completed: false
  }));
}

function recommendationFor(finding: Finding) {
  if (finding.category === "ar") return "Prioritise collection follow-up for the highest-value overdue debtors.";
  if (finding.category === "ap") return "Hold duplicate invoice candidate pending supplier and invoice reference confirmation.";
  if (finding.category === "vat") return "Review blank VAT/tax code transactions and attach exception notes before VAT submission.";
  if (finding.category === "month_end") return "Assign controller review for recurring expense accruals before management sign-off.";
  return "Assign reviewer and resolve the evidence-linked finding.";
}

function value(row: Record<string, string>, keys: string[]) {
  for (const key of keys) {
    if (row[key]) return row[key].trim();
  }
  return "";
}

function amount(row: Record<string, string>, keys: string[]) {
  const raw = value(row, keys);
  if (!raw) return 0;
  const cleaned = raw.replace(/[£,$,\s]/g, "").replace(/^\((.*)\)$/, "-$1");
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function sumColumn(rows: Record<string, string>[], keys: string[]) {
  return rows.reduce((sum, row) => sum + amount(row, keys), 0);
}

function formatCurrency(value: number) {
  return `£${Math.round(Math.abs(value)).toLocaleString()}`;
}
