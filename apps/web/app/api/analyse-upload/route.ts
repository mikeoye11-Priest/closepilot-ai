import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import * as XLSX from "@e965/xlsx";
import { requireApiSession } from "@/lib/api-auth";
import { canonicalImportHeader, recogniseFinanceDocument } from "@/lib/import-engine";
import { createClient } from "@/lib/supabase-server";
import { analyseParsedFiles, createUpload, normaliseHeader, scopeAnalysisResult, type ParsedFile } from "@/lib/upload-analysis";
import type { Company, ImportMappingProfile, Tenant, Upload } from "@/lib/types";

export const runtime = "nodejs";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UPLOAD_BUCKET = process.env.CLOSEPILOT_UPLOAD_BUCKET || "finance-uploads";

export async function POST(request: Request) {
  const session = await requireApiSession();
  if (!session.ok) return session.response;

  const form = await request.formData();
  const files = form.getAll("files").filter((item): item is File => item instanceof File);
  const scope = readAnalysisScope(form);
  const savedProfiles = readMappingProfiles(form);

  if (!files.length) {
    return NextResponse.json({ error: "No files uploaded" }, { status: 400 });
  }

  const parsed = (await Promise.all(files.map(parseServerFileSafely))).flat();
  const storedFiles = await storeUploadedFiles(files, scope, session.authDisabled);
  const parsedWithStorage = attachStoredFileMetadata(parsed, storedFiles);
  const result = analyseParsedFiles(parsedWithStorage, { savedProfiles });
  return NextResponse.json(scope ? scopeAnalysisResult(result, scope.tenant, scope.company) : result);
}

function readAnalysisScope(form: FormData): { tenant: Tenant; company: Company } | null {
  const tenantId = stringField(form, "tenantId");
  const tenantName = stringField(form, "tenantName");
  const tenantType = stringField(form, "tenantType") === "company" ? "company" : "accounting_practice";
  const tenantPlan = stringField(form, "tenantPlan") || "practice";
  const companyId = stringField(form, "companyId");
  const companyName = stringField(form, "companyName");

  if (!tenantId || !tenantName || !companyId || !companyName) return null;

  return {
    tenant: { id: tenantId, name: tenantName, type: tenantType, plan: tenantPlan },
    company: {
      id: companyId,
      tenantId,
      name: companyName,
      industry: stringField(form, "companyIndustry"),
      accountingSystem: stringField(form, "accountingSystem") || "Unknown",
      currency: stringField(form, "currency") || "GBP",
      country: stringField(form, "country") || "United Kingdom"
    }
  };
}

function stringField(form: FormData, key: string) {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function readMappingProfiles(form: FormData): ImportMappingProfile[] {
  const raw = stringField(form, "mappingProfiles");
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isMappingProfile) : [];
  } catch {
    return [];
  }
}

function isMappingProfile(value: unknown): value is ImportMappingProfile {
  return Boolean(value && typeof value === "object" && "fileType" in value && "mapping" in value && "status" in value);
}

async function parseServerFileSafely(file: File): Promise<ParsedFile[]> {
  try {
    const parsed = await parseServerFile(file);
    return parsed.map((item) => ({
      ...item,
      upload: { ...item.upload, originalFileName: file.name }
    }));
  } catch (error) {
    console.error(`Failed to parse uploaded file "${file.name}"`, error);
    const unparsed = createUnparsedFile(file.name);
    return [{ ...unparsed, upload: { ...unparsed.upload, originalFileName: file.name } }];
  }
}

type StoredFile = {
  bucket: string;
  key: string;
  url: string;
  status: Upload["storageStatus"];
};

async function storeUploadedFiles(files: File[], scope: { tenant: Tenant; company: Company } | null, authDisabled: boolean): Promise<Map<string, StoredFile>> {
  const stored = new Map<string, StoredFile>();
  if (authDisabled || !scope || !UUID_RE.test(scope.tenant.id) || !UUID_RE.test(scope.company.id)) return stored;

  const supabase = await createClient();
  await Promise.all(files.map(async (file) => {
    const uploadId = crypto.randomUUID();
    const safeName = safeStorageName(file.name);
    const key = `tenants/${scope.tenant.id}/companies/${scope.company.id}/uploads/${uploadId}/${safeName}`;
    try {
      const { error } = await supabase.storage.from(UPLOAD_BUCKET).upload(key, file, {
        contentType: file.type || "application/octet-stream",
        upsert: false,
      });
      if (error) {
        console.warn(`Upload storage failed for ${file.name}`, error.message);
        stored.set(file.name, { bucket: UPLOAD_BUCKET, key, url: `supabase-storage://${UPLOAD_BUCKET}/${key}`, status: "failed" });
        return;
      }
      stored.set(file.name, { bucket: UPLOAD_BUCKET, key, url: `supabase-storage://${UPLOAD_BUCKET}/${key}`, status: "stored" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Storage upload failed";
      console.warn(`Upload storage failed for ${file.name}`, message);
      stored.set(file.name, { bucket: UPLOAD_BUCKET, key, url: `supabase-storage://${UPLOAD_BUCKET}/${key}`, status: "failed" });
    }
  }));

  return stored;
}

function attachStoredFileMetadata(parsed: ParsedFile[], storedFiles: Map<string, StoredFile>): ParsedFile[] {
  if (!storedFiles.size) return parsed;
  return parsed.map((item) => {
    const original = item.upload.originalFileName ?? item.upload.fileName;
    const stored = storedFiles.get(original);
    if (!stored) return item;
    return {
      ...item,
      upload: {
        ...item.upload,
        storageBucket: stored.bucket,
        storageKey: stored.key,
        fileUrl: stored.url,
        storageStatus: stored.status
      }
    };
  });
}

function safeStorageName(fileName: string) {
  return fileName.trim().replace(/[/\\]+/g, "_").replace(/[^a-zA-Z0-9._ -]+/g, "_").slice(0, 180) || "upload";
}

async function parseServerFile(file: File): Promise<ParsedFile[]> {
  const lowerName = file.name.toLowerCase();

  if (lowerName.endsWith(".csv") || lowerName.endsWith(".tsv") || lowerName.endsWith(".txt")) {
    const text = await file.text();
    return [parseDelimitedUpload(file.name, text, lowerName.endsWith(".tsv") ? "\t" : undefined)];
  }

  if (lowerName.endsWith(".xlsx")) {
    return parseWorkbook(file);
  }

  if (lowerName.endsWith(".xls")) {
    const workbookData = await file.arrayBuffer();
    return parseWorkbookWithSheetJs(file.name, workbookData);
  }

  return [createUnparsedFile(file.name)];
}

function parseDelimitedUpload(fileName: string, text: string, delimiter?: string): ParsedFile {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const selectedDelimiter = delimiter ?? (lines[0]?.includes("\t") ? "\t" : ",");
  const matrix = lines.map((line) => splitDelimitedLine(line, selectedDelimiter));
  const parsed = rowsFromMatrix(matrix, fileName);
  const headers = parsed?.headers ?? [];
  const rawRows = parsed?.rows ?? [];
  const preliminaryDetection = detectFinanceDocument(fileName, headers, rawRows);
  const rows = cleanRowsForSheet(`${fileName} ${preliminaryDetection.fileType}`, rawRows);
  const detection = detectFinanceDocument(fileName, headers, rows);

  return {
    upload: { ...createUpload(fileName, rows.length), ...detection },
    headers,
    rows,
    isParsed: true
  };
}

async function parseWorkbook(file: File): Promise<ParsedFile[]> {
  const workbook = new ExcelJS.Workbook();
  const workbookData = await file.arrayBuffer();
  try {
    await workbook.xlsx.load(workbookData as never);
  } catch {
    return parseWorkbookWithSheetJs(file.name, workbookData);
  }

  const results: ParsedFile[] = [];

  for (const worksheet of workbook.worksheets) {
    if (!worksheet || worksheet.rowCount < 2) continue;

    const sheetName = worksheet.name ?? "";
    if (!shouldAnalyseSheet(sheetName)) continue;

    const inferredName = inferSheetFileName(file.name, sheetName);
    const matrix: string[][] = [];

    worksheet.eachRow((row, rowNumber) => {
      matrix[rowNumber - 1] = Array.from({ length: worksheet.columnCount }, (_, index) => cellToString(row.getCell(index + 1).value));
    });

    const parsed = rowsFromMatrix(matrix, sheetName);
    if (!parsed) continue;
    const { headers } = parsed;
    const rows = cleanRowsForSheet(sheetName, parsed.rows);
    if (rows.length === 0) continue;
    const detection = detectFinanceDocument(sheetName, headers, rows);

    results.push({
      upload: { ...createUpload(inferredName, rows.length), ...detection },
      headers,
      rows,
      isParsed: true
    });
  }

  if (results.length === 0) {
    return [createUnparsedFile(file.name)];
  }

  return results;
}

function parseWorkbookWithSheetJs(fileName: string, workbookData: ArrayBuffer): ParsedFile[] {
  const workbook = XLSX.read(workbookData, { type: "array", cellDates: true });
  const results: ParsedFile[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    if (!shouldAnalyseSheet(sheetName)) continue;

    const matrix = XLSX.utils.sheet_to_json<string[]>(sheet, {
      header: 1,
      defval: "",
      raw: false,
    });
    const parsed = rowsFromMatrix(matrix, sheetName);
    if (!parsed) continue;

    const { headers } = parsed;
    const rows = cleanRowsForSheet(sheetName, parsed.rows);
    if (!rows.length) continue;

    const inferredName = inferSheetFileName(fileName, sheetName);
    const detection = detectFinanceDocument(sheetName, headers, rows);
    results.push({
      upload: { ...createUpload(inferredName, rows.length), ...detection },
      headers,
      rows,
      isParsed: true
    });
  }

  return results.length ? results : [createUnparsedFile(fileName)];
}

function rowsFromMatrix(matrix: Array<unknown[] | undefined>, sheetName: string): { headers: string[]; rows: Record<string, string>[] } | null {
  const headerRowIndex = findHeaderRowIndex(matrix, sheetName);
  if (headerRowIndex < 0) return null;

  const rawHeaders = matrix[headerRowIndex] ?? [];
  const headers = dedupeHeaders(rawHeaders.map((cell, index) => normaliseWorkbookHeader(cell, index)));
  const parsedRows = matrix.slice(headerRowIndex + 1).map((row, offset) => {
    const values = headers.map((header, index) => [header, String(row?.[index] ?? "").trim()] as const);
    const parsedRow = Object.fromEntries(values);
    if (!Object.values(parsedRow).some((value) => value.trim())) return null;
    return {
      ...parsedRow,
      __sourceRowIndex: String(headerRowIndex + offset + 2),
      __sourceSheetName: sheetName,
    };
  });
  const rows = parsedRows.filter((row): row is NonNullable<(typeof parsedRows)[number]> => Boolean(row));

  return { headers, rows };
}

function findHeaderRowIndex(matrix: Array<unknown[] | undefined>, sheetName: string): number {
  if (/bank recon/i.test(sheetName) || looksLikeBankReconciliation(matrix)) {
    const firstBankTable = matrix.findIndex((row) => {
      const labels = (row ?? []).map(normaliseMatrixLabel).filter(Boolean);
      return labels.includes("item") && labels.includes("status");
    });
    if (firstBankTable >= 0) return firstBankTable;
  }

  let bestIndex = -1;
  let bestScore = 0;

  matrix.forEach((row, index) => {
    const labels = (row ?? []).map(normaliseMatrixLabel).filter(Boolean);
    if (labels.length > 1 && new Set(labels).size === 1) return;
    const score = labels.reduce((sum, label) => sum + headerScore(label), 0);
    if (score > bestScore && labels.length >= 2) {
      bestIndex = index;
      bestScore = score;
    }
  });

  return bestScore >= 2 ? bestIndex : -1;
}

function looksLikeBankReconciliation(matrix: Array<unknown[] | undefined>) {
  const text = matrix.flatMap((row) => row ?? []).join(" ").toLowerCase();
  return /bank reconciliation|tb bank balance|bank statement balance|reconciling difference|unreconciled items/.test(text);
}

function headerScore(label: string): number {
  const strongHeaders = new Set([
    "account", "account_code", "account_name", "balance", "balance", "dr_cr", "category",
    "customer_name", "supplier_name", "invoice_ref", "outstanding", "days_overdue", "days_aged",
    "credit_limit", "date", "description", "debit", "credit", "vat_code",
    "net", "net_amount", "vat", "vat_amount", "gross", "box", "amount", "type", "item", "status",
    "asset_code", "asset_description", "cost", "annual_depn", "closing_cash",
    "department", "headcount", "gross_pay", "employer_nic", "pension", "total_cost", "tb_posted",
  ]);
  if (strongHeaders.has(label)) return 2;
  if (/account|customer|supplier|balance|amount|outstanding|days|date|description|debit|credit|vat|gross|net|status|category|code|box|asset|cash|payroll|posted|department|headcount|pension|nic|cost/.test(label)) return 1;
  return 0;
}

function normaliseMatrixLabel(cell: unknown): string {
  const raw = String(cell ?? "").trim();
  if (/^[£$€]$/.test(raw) || /amount\s*[£$€]/i.test(raw)) return "amount";
  return canonicalHeader(normaliseHeader(raw));
}

function normaliseWorkbookHeader(cell: unknown, index: number): string {
  const raw = String(cell ?? "").trim();
  if (/^[£$€]$/.test(raw) || /amount\s*[£$€]/i.test(raw)) return "amount";
  return canonicalHeader(normaliseHeader(raw || `column_${index + 1}`)) || `column_${index + 1}`;
}

function dedupeHeaders(headers: string[]): string[] {
  const seen = new Map<string, number>();
  return headers.map((header, index) => {
    const fallback = header || `column_${index + 1}`;
    const count = seen.get(fallback) ?? 0;
    seen.set(fallback, count + 1);
    return count === 0 ? fallback : `${fallback}_${count + 1}`;
  });
}

function shouldAnalyseSheet(sheetName: string): boolean {
  const sheet = sheetName.toLowerCase();
  if (/company profile|expected findings|review pack summary|cross.?file|budget|12 month|history|bank transaction/.test(sheet)) return false;
  return /trial|tb|balance sheet|profit|loss|p&l|ar aging|ap aging|debtor|creditor|vat|bank recon|payroll|fixed asset|asset register|cashflow|cash flow/.test(sheet);
}

function cleanRowsForSheet(sheetName: string, rows: Record<string, string>[]): Record<string, string>[] {
  const sheet = sheetName.toLowerCase();
  if (/ar aging|ap aging|debtor|creditor/.test(sheet)) {
    return rows.filter((row) => {
      const firstValue = Object.values(row)[0] ?? "";
      return !/total|reconciliation|control|difference/i.test(firstValue);
    });
  }
  if (/trial|tb/.test(sheet)) {
    return rows.filter((row) => !/^totals?$/i.test(row.account_code ?? Object.values(row)[0] ?? "")).map((row) => {
      const direction = row.dr_cr?.trim().toLowerCase();
      if (!row.balance || !direction?.startsWith("c")) return row;
      const numeric = Number(row.balance.replace(/[£$€,\s]/g, ""));
      if (!Number.isFinite(numeric)) return row;
      return { ...row, balance: String(-Math.abs(numeric)) };
    });
  }
  return rows;
}

function detectFinanceDocument(contextName: string, headers: string[], rows: Record<string, string>[]): Pick<Upload, "fileType" | "detectionConfidence" | "detectedVendor" | "detectionBasis"> {
  return recogniseFinanceDocument(contextName, headers, rows);
}

function canonicalHeader(header: string): string {
  return canonicalImportHeader(header);
}

function createUnparsedFile(fileName: string): ParsedFile {
  return {
    upload: createUpload(fileName),
    headers: [],
    rows: [],
    isParsed: false
  };
}

function inferSheetFileName(fileName: string, sheetName: string): string {
  const base = fileName.replace(/\.(xlsx|xls)$/i, "");
  const sheet = sheetName.toLowerCase();

  if (sheet.includes("bank recon") || sheet.includes("bank rec")) return `${base}_bank_reconciliation.csv`;
  if (sheet.includes("bank transaction") || sheet.includes("cashbook")) return `${base}_bank_transactions.csv`;
  if (sheet.includes("cashflow") || sheet.includes("cash flow")) return `${base}_cashflow_forecast.csv`;
  if (sheet.includes("payroll")) return `${base}_payroll_summary.csv`;
  if (sheet.includes("fixed asset") || sheet.includes("asset register")) return `${base}_fixed_asset_register.csv`;
  if (sheet.includes("trial") || sheet.includes("tb") || sheet === "tb") return `${base}_trial_balance.csv`;
  if (sheet.includes("p&l") || sheet.includes("profit") || sheet.includes("pnl") || sheet.includes("income") || sheet.includes("pl")) return `${base}_profit_loss.csv`;
  if (sheet.includes("balance") || sheet.includes("bs")) return `${base}_balance_sheet.csv`;
  if (sheet.includes("debtor") || sheet.includes("ar") || sheet.includes("receivable")) return `${base}_aged_debtors.csv`;
  if (sheet.includes("creditor") || sheet.includes("ap") || sheet.includes("payable")) return `${base}_aged_creditors.csv`;
  if (sheet.includes("vat") || sheet.includes("tax")) return `${base}_vat_report.csv`;

  // Fall back to sheet name as part of filename — infer from sheet name directly
  return `${base}_${sheetName.toLowerCase().replace(/[^a-z0-9]+/g, "_")}.csv`;
}

function cellToString(value: ExcelJS.CellValue) {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    if ("text" in value && typeof value.text === "string") return value.text;
    if ("result" in value) return String(value.result ?? "");
    if ("richText" in value && Array.isArray(value.richText)) return value.richText.map((part) => part.text).join("");
    if ("hyperlink" in value && "text" in value) return String(value.text ?? value.hyperlink ?? "");
  }
  return String(value);
}

function splitDelimitedLine(line: string, delimiter: string) {
  const result: string[] = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === "\"" && quoted && next === "\"") {
      current += "\"";
      index += 1;
      continue;
    }
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
