import { company, tenant } from "./data";
import type { AnalysisResult, Company, Finding, FindingEvidenceRow, Recommendation, Tenant, Upload, ValidationCheck } from "./types";
import { runRuleEngine } from "./rule-engine";
import { ALL_RULES } from "./rules/index";
import { runStatisticalAnalysis, convertStatisticalFindings } from "./statistical-detection";
import { runReconciliationEngine } from "./reconciliation-engine";
import { runVatEngine } from "./vat-engine";
import {
  normaliseFinanceRows,
  type Creditor,
  type Debtor,
  type ImportMappingProfile,
  type ImportFileType,
  type NormalisedImportResult,
  type TrialBalanceLine,
  type VatTransaction,
} from "./import-engine";

export type ParsedFile = {
  upload: Upload;
  headers: string[];
  rows: Record<string, string>[];
  isParsed: boolean;
  importResult?: NormalisedImportResult;
  trialBalance?: TrialBalanceLine[];
  debtors?: Debtor[];
  creditors?: Creditor[];
  vatTransactions?: VatTransaction[];
};

// ─── Column key aliases — broad coverage for Sage, Xero, QB, FreeAgent, BC ──

const CUSTOMER_KEYS     = ["customer","customer_name","debtor","debtor_name","name","account_name","client","client_name","account","party","contact","contact_name"];
const SUPPLIER_KEYS     = ["supplier","supplier_name","vendor","vendor_name","creditor","creditor_name","name","payee","account_name","party","contact","contact_name"];
const AR_AMOUNT_KEYS    = ["over_60","60_days","60_plus","90_days","120_days","over_90","over_120","days_31_60","days_61_90","days_91_plus","overdue","due","due_local","overdue_balance","amount","balance","outstanding","total","total_outstanding","net_balance"];
const AP_AMOUNT_KEYS    = ["amount","balance","outstanding","invoice_amount","net_amount","total","total_due","due","due_local","days_31_60","days_61_90","days_91_plus","value","gross","net"];
const AR_DAYS_KEYS      = ["days_overdue","days_outstanding","age","age_days","days","days_aged","aging","overdue_days","day_bucket","period_bucket","bucket","ageing_bucket"];
const INVOICE_DATE_KEYS = ["invoice_date","date","transaction_date","posting_date","doc_date","entry_date","created_date","inv_date","invoice_dt"];
const DUE_DATE_KEYS     = ["due_date","payment_due","due","pay_by","payment_date","due_dt","maturity_date"];
const INVOICE_REF_KEYS  = ["invoice_ref","invoice_number","invoice_no","inv_no","inv_ref","reference","ref","doc_no","document_number","doc_number","order_ref","po_number","trans_ref","transaction_number"];
const CREDIT_LIMIT_KEYS = ["credit_limit","limit","approved_limit","credit_terms","credit_facility","credit_line"];
const ACCOUNT_NAME_KEYS = ["account_name","account_description","nominal","gl_account","ledger_account","account","description","item","account_code","nominal_code","acc_name","g_l_account_long_text","gl_account_long_text"];
const ACCOUNT_CODE_KEYS = ["account_code","nominal_code","code","gl_code","acc_code","nominal","account_no","g_l_account","gl_account","g_l_account_no","gl_account_no"];
const DEBIT_KEYS        = ["debit","debits","dr","debit_amount"];
const CREDIT_KEYS       = ["credit","credits","cr","credit_amount"];
const BALANCE_KEYS      = ["balance","closing_balance","balance_at_date","net","amount","amount_company_code_currency","amount_transaction_currency","closing_balance","net_movement","movement","net_change","debit_ytd","credit_ytd"];
const VAT_CODE_KEYS     = ["vat_code","tax_code","vat_rate","tax_rate","vat_treatment","tax_treatment","vat_type","tax_type","vat_class"];
const VAT_AMOUNT_KEYS   = ["vat_amount","tax_amount","vat","tax","gst_amount","vat_value","tax_value"];
const NET_AMOUNT_KEYS   = ["net_amount","net","amount","invoice_amount","value","gross_ex_vat"];
const DESC_KEYS         = ["description","narration","memo","details","particulars","transaction_description","account_name","category","expense_type","journal_narration","account_description","narrative"];
const STATUS_KEYS       = ["status","dispute_flag","on_hold","account_status","payment_status","query_flag"];
const CURRENCY_KEYS     = ["currency","currency_code","ccy","iso_code","curr"];
const USER_KEYS         = ["posted_by","created_by","user","preparer","user_name","entered_by","approved_by","authorised_by"];
const POSTING_DATE_KEYS = ["posting_date","entry_date","created_date","journal_date","posted_date","processed_date","entered_date","document_date"];

// ─── Regex patterns ────────────────────────────────────────────────────────────

const RECURRING_KEYWORDS   = /utilities?|utility|rent|rates|insurance|maintenance|professional\s*fee|service\s*charge|electricity|gas|water|broadband|telephone|phone|cleaning|subscription|retainer|lease/i;
const STANDARD_RATE_CATS   = /service|supply|supplies|professional|consultancy|software|subscription|marketing|advertising|training|maintenance|repair|contract|it\s*support|management\s*fee|consultancy|design|recruitment|logistics|transport|courier/i;
const BLOCKED_VAT_CATS     = /entertainment|client\s*entertain|business\s*entertain|subsistence|hospitality|staff\s*party|christmas\s*party|team\s*event|corporate\s*event|golf|gym|fitness|spa|hotel\s*leisure/i;
const ENTERTAINMENT_CATS   = /entertainment|hospitality|client\s*dinner|client\s*lunch|client\s*breakfast|corporate\s*event|golf|staff\s*event|christmas|celebration|team\s*away|awayday/i;
const EXEMPT_VAT_CODES     = /^(exempt|e|ze|zero|es|ex|out\s*of\s*scope|oos|n\/a|na|outside\s*scope|no\s*vat)$/i;
const REVERSE_CHARGE_CATS  = /reverse\s*charge|rc|rcsl|rcss|ess|import|overseas|eu\s*|european|non.?uk|foreign\s*supplier|cross\s*border/i;
const EU_SUPPLIER_KEYWORDS = /\b(eu|europe|european|france|germany|spain|italy|netherlands|belgium|ireland|poland|portugal|sweden|denmark|austria|finland|import|overseas|non-uk|international)\b/i;
const ASSET_KEYWORDS       = /fixed\s*asset|tangible|property|plant|equipment|motor\s*vehicle|computer|furniture|freehold|leasehold|prepayment|capital\s*expenditure|capex|machinery|tooling/i;
const DEPN_KEYWORDS        = /depreciation|amortis|amortiz|impairment|write.?down|nbv\s*charge/i;
const SUSPENSE_KEYWORDS    = /suspense|clearing|holding|temp(orary)?|query|error|misc(ellaneous)?|unallocated|unknown|tbc|to\s*be\s*allocated|control\s*account/i;
const INTERCO_KEYWORDS     = /intercompany|intra.?group|due\s*from|due\s*to|related\s*party|loan\s*-\s*director|directors?\s*loan|dla|group\s*loan|loan\s*account/i;
const GOODWILL_KEYWORDS    = /goodwill|intangible|brand|patent|licence|trademark|intellectual\s*property|customer\s*list/i;
const FUEL_KEYWORDS        = /fuel|petrol|diesel|mileage|fuel\s*card|motor\s*expenses|car\s*expenses/i;
const FUEL_SCALE_KEYWORDS  = /fuel\s*scale|fsc|scale\s*charge/i;
const PAYROLL_KEYWORDS     = /payroll|wages|salary|salaries|staff\s*cost|employee|labour|nlc|ni\s*contribution|employer.s\s*nic|paye|national\s*insurance/i;
const PROVISION_KEYWORDS   = /provision|allowance\s*for|bad\s*debt|impairment\s*loss|doubtful\s*debt|write.?off\s*provision/i;
const PERSONAL_PAYEE_RE    = /^(mr\.?|mrs\.?|ms\.?|miss\.?|dr\.?|prof\.?)\s+[a-z]+/i;
const ROUND_NUMBER_RE      = /^[0-9,]+\.00$|^[0-9,]+\.0{1,2}$|^[0-9]+000$/;

// ─── Core entry points ─────────────────────────────────────────────────────────

const fileTypeLabels: Record<Upload["fileType"], string> = {
  trial_balance: "Trial Balance", profit_loss: "P&L", balance_sheet: "Balance Sheet",
  aged_debtors: "Aged Debtors", aged_creditors: "Aged Creditors", vat_report: "VAT Report",
  bank_reconciliation: "Bank Reconciliation", cashflow_forecast: "Cashflow Forecast",
  payroll_summary: "Payroll Summary", fixed_asset_register: "Fixed Asset Register",
};

const CORE_RULE_FILE_TYPES: Upload["fileType"][] = ["trial_balance", "profit_loss", "balance_sheet", "aged_debtors", "aged_creditors", "vat_report"];
const STATISTICAL_FILE_TYPES: Upload["fileType"][] = ["aged_debtors", "aged_creditors", "vat_report"];

export async function analyseFinanceFiles(files: File[], options: { savedProfiles?: ImportMappingProfile[] } = {}): Promise<AnalysisResult> {
  const parsed = await Promise.all(files.map(parseFinanceFile));
  return analyseParsedFiles(parsed, options);
}

export function analyseParsedFiles(parsed: ParsedFile[], options: { savedProfiles?: ImportMappingProfile[] } = {}): AnalysisResult {
  const canonicalParsed = parsed.map((file) => attachCanonicalImport(file, options.savedProfiles));
  const ruleReadyParsed = canonicalParsed.filter(isRuleReadyFile);
  const vatReview = runVatEngine(ruleReadyParsed);

  // Trust layer: cross-file reconciliations used by readiness and review packs
  const reconciliation = runReconciliationEngine(ruleReadyParsed);

  // Layer 1: Validation checks (data integrity)
  const validationChecks = [...reconciliation.validationChecks, ...buildValidationChecks(canonicalParsed)];

  // Layer 2-7: Complex code-based findings (existing engine)
  const codeFindings = buildFindings(ruleReadyParsed);

  // Layer 2-8: Declarative rule engine (350+ rules)
  const engineFiles = ruleReadyParsed
    .filter((f) => CORE_RULE_FILE_TYPES.includes(f.upload.fileType))
    .map((f) => ({ upload: f.upload, rows: f.rows, isParsed: f.isParsed }));
  const ruleFindings = runRuleEngine(ALL_RULES, engineFiles);

  // Layer 8: Statistical detection (Z-scores, Benford, clustering)
  const statisticalFiles = engineFiles.filter((f) => STATISTICAL_FILE_TYPES.includes(f.upload.fileType));
  const statFindings = runStatisticalAnalysis(statisticalFiles);
  const statFindingsConverted = canonicalParsed[0]
    ? convertStatisticalFindings(statFindings, canonicalParsed[0].upload.tenantId, canonicalParsed[0].upload.companyId)
    : [];

  // Deduplicate by category+severity+file to avoid noise
  const allFindings = prioritiseReviewFindings(deduplicateFindings([...reconciliation.findings, ...codeFindings, ...ruleFindings, ...statFindingsConverted]));

  return {
    uploads: canonicalParsed.map((f) => f.upload),
    validationChecks,
    findings: allFindings,
    importProfiles: buildImportProfiles(canonicalParsed),
    recommendations: buildRecommendations(allFindings),
    vatReview
  };
}

const IMPORT_ENGINE_FILE_TYPES: ImportFileType[] = ["trial_balance", "aged_debtors", "aged_creditors", "vat_report"];

function attachCanonicalImport(file: ParsedFile, savedProfiles: ImportMappingProfile[] = []): ParsedFile {
  if (!file.isParsed || !IMPORT_ENGINE_FILE_TYPES.includes(file.upload.fileType as ImportFileType)) return file;
  if (file.upload.fileType === "vat_report" && isExplicitVatReturnFile(file)) return file;
  const importResult = file.importResult ?? normaliseFinanceRows({
    fileType: file.upload.fileType as ImportFileType,
    headers: file.headers,
    rows: file.rows,
    sourceFile: file.upload.fileName,
    vendor: file.upload.detectedVendor,
    savedProfiles,
    tenantId: file.upload.tenantId,
    companyId: file.upload.companyId,
  });
  return {
    ...file,
    upload: {
      ...file.upload,
      mappingProfileId: importResult.profile?.id,
      mappingProfileName: importResult.profile?.profileName,
      mappingProfileStatus: importResult.profile?.status,
      mappingConfidence: importResult.profile?.confidence,
      importConfidence: importResult.importConfidence,
      importGateStatus: importResult.gateStatus,
    },
    importResult,
    trialBalance: importResult.trialBalance,
    debtors: importResult.debtors,
    creditors: importResult.creditors,
    vatTransactions: importResult.vatTransactions,
  };
}

function isRuleReadyFile(file: ParsedFile) {
  if (!file.isParsed) return false;
  if (!IMPORT_ENGINE_FILE_TYPES.includes(file.upload.fileType as ImportFileType)) return true;
  if (file.upload.fileType === "vat_report") return true;
  return file.importResult?.gateStatus === "ready";
}

function isExplicitVatReturnFile(file: ParsedFile) {
  const boxes = new Set<string>();
  for (const row of file.rows) {
    const match = Object.values(row).join(" ").match(/box\s*([1-9])/i);
    if (match) boxes.add(match[1]);
  }
  return boxes.size >= 5;
}

function buildImportProfiles(files: ParsedFile[]): ImportMappingProfile[] {
  const profiles = files.flatMap((file) => file.importResult?.profile ? [{
    ...file.importResult.profile,
    tenantId: file.upload.tenantId,
    companyId: file.upload.companyId,
    vendor: file.upload.detectedVendor ?? file.importResult.profile.vendor,
    lastUsedAt: new Date().toISOString(),
  }] : []);
  return Array.from(new Map(profiles.map((profile) => [profile.id, profile])).values());
}

function deduplicateFindings(findings: Finding[]): Finding[] {
  const seen = new Set<string>();
  return findings.filter((f) => {
    // Create a key based on title similarity and source file
    const key = `${f.category}_${f.severity}_${f.evidence.sourceFile}_${f.title.slice(0, 40).toLowerCase().replace(/\W+/g, "_")}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const PARTNER_REVIEW_RULES = new Set([
  "REC_001", "REC_003", "REC_005",
  "AR_001", "AR_002", "AR_003", "AR_008", "AR_009", "AR_011",
  "AP_001", "AP_004", "AP_006", "AP_007", "AP_018", "AP_045",
  "VAT_001", "VAT_004", "VAT_005", "VAT_009", "VAT_010", "VAT_012", "VAT_019", "VAT_048", "VAT_051",
  "CR_004", "CR_008", "CR_031", "CR_033",
  "FS_005", "FS_045",
  "CF_001", "CF_002", "CF_009", "CF_016", "CF_054",
  "ST_028",
]);

function prioritiseReviewFindings(findings: Finding[]): Finding[] {
  if (findings.length <= 60) return findings;

  const candidates = findings
    .filter((finding) => finding.evidenceStrength !== "advisory")
    .filter((finding) => {
      if (PARTNER_REVIEW_RULES.has(finding.ruleId ?? "")) return true;
      if (/^(ar_overdue|ar_conc|ap_dup|ap_personal|vat_missing|tb_suspense|support_)/.test(finding.id)) return true;
      if (finding.evidenceStrength === "deterministic" && (finding.severity === "critical" || finding.severity === "high")) return true;
      return false;
    });

  return deduplicatePriorityFindings(candidates.sort((a, b) => findingPriorityScore(b) - findingPriorityScore(a)))
    .slice(0, 35);
}

function deduplicatePriorityFindings(findings: Finding[]): Finding[] {
  const seen = new Set<string>();
  return findings.filter((finding) => {
    const key = priorityDeduplicationKey(finding);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function priorityDeduplicationKey(finding: Finding): string {
  if (finding.ruleId?.startsWith("REC_")) return finding.ruleId;
  if (/payroll/i.test(finding.title)) return "payroll_missing";
  if (/depreciation/i.test(finding.title)) return "depreciation_missing";
  if (/vat.*control|vat report/i.test(finding.title)) return "vat_control";
  if (/bank reconciliation/i.test(finding.title)) return "bank_reconciliation";
  if (/debtors control|ar aging/i.test(finding.title)) return "ar_control";
  if (/duplicate supplier|duplicate vendor|duplicate.*invoice/i.test(finding.title)) return "ap_duplicate";
  if (/individual|personal payee|persons/i.test(finding.title)) return "personal_payee";
  return `${finding.ruleId ?? finding.category}_${finding.title.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 60)}`;
}

function findingPriorityScore(finding: Finding): number {
  const severityScore: Record<Finding["severity"], number> = { critical: 400, high: 300, medium: 200, low: 100 };
  const evidenceScore = finding.evidenceStrength === "deterministic" ? 80 : finding.evidenceStrength === "indicator" ? 35 : 0;
  const partnerScore = PARTNER_REVIEW_RULES.has(finding.ruleId ?? "") ? 250 : 0;
  const exposure = finding.evidence.matchValue ?? parseCurrencyFromText(`${finding.expectedImpact} ${finding.evidence.calculation}`);
  return severityScore[finding.severity] + evidenceScore + partnerScore + Math.min(50, Math.log10(Math.max(1, exposure)) * 10);
}

function parseCurrencyFromText(text: string): number {
  const matches = [...text.matchAll(/£\s*([\d,]+(?:\.\d+)?)(k|m)?/gi)];
  return matches.reduce((max, match) => {
    const base = Number(match[1].replace(/,/g, ""));
    const suffix = match[2]?.toLowerCase();
    const amount = suffix === "m" ? base * 1_000_000 : suffix === "k" ? base * 1_000 : base;
    return Number.isFinite(amount) ? Math.max(max, amount) : max;
  }, 0);
}

export function scopeAnalysisResult(result: AnalysisResult, scopeTenant: Tenant, scopeCompany: Company): AnalysisResult {
  return {
    uploads: result.uploads.map((u) => ({ ...u, tenantId: scopeTenant.id, companyId: scopeCompany.id })),
    validationChecks: result.validationChecks.map((v) => ({ ...v, tenantId: scopeTenant.id, companyId: scopeCompany.id })),
    findings: result.findings.map((f) => ({ ...f, tenantId: scopeTenant.id, companyId: scopeCompany.id })),
    importProfiles: result.importProfiles?.map((profile) => ({ ...profile, tenantId: scopeTenant.id, companyId: scopeCompany.id })),
    recommendations: result.recommendations.map((r) => ({ ...r, tenantId: scopeTenant.id, companyId: scopeCompany.id })),
    vatReview: result.vatReview
  };
}

// ─── File parsing ──────────────────────────────────────────────────────────────

export async function parseFinanceFile(file: File): Promise<ParsedFile> {
  const fileType = inferFileType(file.name);
  const canParse = /\.(csv|tsv|txt)$/i.test(file.name);
  const upload: Upload = { id: `up_${crypto.randomUUID()}`, tenantId: tenant.id, companyId: company.id, fileType, fileName: file.name, uploadedAt: new Date().toISOString().slice(0, 10) };
  if (!canParse) return { upload, headers: [], rows: [], isParsed: false };
  const text = await file.text();
  const { headers, rows } = parseDelimitedText(text, file.name.toLowerCase().endsWith(".tsv") ? "\t" : undefined);
  return { upload: { ...upload, rowCount: rows.length }, headers, rows, isParsed: true };
}

export function createUpload(fileName: string, rowCount?: number): Upload {
  return { id: `up_${crypto.randomUUID()}`, tenantId: tenant.id, companyId: company.id, fileType: inferFileType(fileName), fileName, uploadedAt: new Date().toISOString().slice(0, 10), rowCount };
}

export function parseDelimitedText(text: string, delimiter?: string) {
  const d = delimiter ?? (text.split(/\r?\n/)[0]?.includes("\t") ? "\t" : ",");
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const headers = splitLine(lines[0] ?? "", d).map(normaliseHeader);
  const rows = lines.slice(1).map((line, index) => {
    const cells = splitLine(line, d);
    return {
      ...Object.fromEntries(headers.map((h, i) => [h, cells[i]?.trim() ?? ""])),
      __sourceRowIndex: String(index + 2),
    };
  });
  return { headers, rows };
}

function splitLine(line: string, delimiter: string) {
  const result: string[] = []; let current = ""; let quoted = false;
  for (const char of line) {
    if (char === "\"") { quoted = !quoted; continue; }
    if (char === delimiter && !quoted) { result.push(current); current = ""; continue; }
    current += char;
  }
  result.push(current); return result;
}

export function normaliseHeader(h: string) { return h.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""); }

export function inferFileType(fileName: string): Upload["fileType"] {
  const n = fileName.toLowerCase();
  if (n.includes("debtor") || n.includes("aged_ar") || n.includes("receivable") || n.includes("aged debtor")) return "aged_debtors";
  if (n.includes("creditor") || n.includes("aged_ap") || n.includes("payable") || n.includes("aged creditor")) return "aged_creditors";
  if (n.includes("bank_reconciliation") || n.includes("bank-reconciliation") || n.includes("bank recon") || n.includes("bank_rec")) return "bank_reconciliation";
  if (n.includes("cashflow_forecast") || n.includes("cash-flow") || n.includes("cashflow") || n.includes("cash flow")) return "cashflow_forecast";
  if (n.includes("payroll")) return "payroll_summary";
  if (n.includes("fixed_asset") || n.includes("fixed-asset") || n.includes("asset_register") || n.includes("asset register")) return "fixed_asset_register";
  if (n.includes("vat") || n.includes("tax_detail") || n.includes("tax_report")) return "vat_report";
  if (n.includes("p&l") || n.includes("profit") || n.includes("loss") || n.includes("income") || n.includes("pnl") || n.includes("profit_loss")) return "profit_loss";
  if (n.includes("balance_sheet") || n.includes("balance-sheet") || n.includes("bs_") || n.includes("balancesheet") || n.includes("balance sheet")) return "balance_sheet";
  return "trial_balance";
}

// ─── Validation checks ─────────────────────────────────────────────────────────

function buildValidationChecks(files: ParsedFile[]): ValidationCheck[] {
  const checks: ValidationCheck[] = [];
  const dTenantId = files[0]?.upload.tenantId ?? tenant.id;
  const dCompanyId = files[0]?.upload.companyId ?? company.id;
  const required: Upload["fileType"][] = ["trial_balance","profit_loss","balance_sheet","aged_debtors","aged_creditors","vat_report"];

  required.forEach((ft) => {
    const matching = files.filter((f) => f.upload.fileType === ft);
    checks.push({ id: `val_present_${ft}`, tenantId: matching[0]?.upload.tenantId ?? dTenantId, companyId: matching[0]?.upload.companyId ?? dCompanyId, name: `${fileTypeLabels[ft]} uploaded`, status: matching.length ? "passed" : "warning", detail: matching.length ? `${matching.length} ${fileTypeLabels[ft]} file(s) available for review.` : `${fileTypeLabels[ft]} not uploaded — related checks limited.` });
  });

  files.filter((f) => !f.isParsed).forEach((f) => {
    checks.push({ id: `val_parser_${f.upload.id}`, tenantId: f.upload.tenantId, companyId: f.upload.companyId, name: `${f.upload.fileName} parser`, status: "warning", detail: "File registered but analysis requires CSV, TSV, TXT or XLSX. Use CSV export for best results." });
  });

  files.filter(hasCanonicalImport).forEach((f) => {
    const result = f.importResult;
    if (!result) return;
    const requiredFields = requiredCanonicalFields(result);
    const confidenceWarnings = result.suggestions.filter((suggestion) => requiredFields.includes(suggestion.targetField) && suggestion.confidence < 0.8);
    const mappingErrors = result.validation.errors.filter((error) => /Required column|Invalid numeric/.test(error));
    const status: ValidationCheck["status"] = mappingErrors.length ? "failed" : confidenceWarnings.length ? "warning" : "passed";
    checks.push({
      id: `val_import_mapping_${f.upload.id}`,
      tenantId: f.upload.tenantId,
      companyId: f.upload.companyId,
      name: `${fileTypeLabels[f.upload.fileType]} import mapping`,
      status,
      detail: mappingErrors.length
        ? mappingErrors.slice(0, 4).join(" ")
        : `${formatProfileStatus(result)} ${formatMappingConfidence(result)}${confidenceWarnings.length ? " Low-confidence mappings need reviewer confirmation." : ""}`,
    });

    checks.push({
      id: `val_import_gate_${f.upload.id}`,
      tenantId: f.upload.tenantId,
      companyId: f.upload.companyId,
      name: `${fileTypeLabels[f.upload.fileType]} rule execution gate`,
      status: result.gateStatus === "ready" ? "passed" : "failed",
      detail: result.gateStatus === "ready"
        ? `Rules enabled. Import confidence ${result.importConfidence}% and validation passed.`
        : result.gateStatus === "review_required"
          ? `Rules paused. Import confidence ${result.importConfidence}% is below the 70% threshold; confirm mapping before findings are generated.`
          : `Rules blocked. Import validation failed: ${result.validation.errors.slice(0, 3).join(" ")}`,
    });
  });

  // TB integrity
  files.filter((f) => f.upload.fileType === "trial_balance" && f.isParsed).forEach((f) => {
    const canonical = f.importResult ?? normaliseFinanceRows({ fileType: "trial_balance", headers: f.headers, rows: f.rows, sourceFile: f.upload.fileName });
    const diff = canonical.trialBalance?.reduce((sum, line) => sum + line.balance, 0) ?? 0;
    const mapped = canonical.mapping.balance ? "signed balance" : "debit/credit";
    const mappingErrors = canonical.validation.errors.filter((error) => /Required column|Invalid numeric/.test(error));
    checks.push({
      id: `val_tb_${f.upload.id}`,
      tenantId: f.upload.tenantId,
      companyId: f.upload.companyId,
      name: "Trial balance balances to zero",
      status: canonical.validation.passed ? "passed" : "failed",
      detail: mappingErrors.length ? mappingErrors.join(" ") : `Normalised via ${mapped}. Difference ${fc(diff)}.`,
    });
  });

  // BS integrity is validated by REC_004 (reconciliation-engine), which is signed
  // and reads the section structure. The name-based totalLine fallback here set
  // liabilities/equity to 0 for section-grouped exports (e.g. Xero), producing a
  // false "does not balance" blocker — so this duplicate check was removed.

  // VAT coding completeness
  files.filter((f) => f.upload.fileType === "vat_report" && f.isParsed).forEach((f) => {
    const missing = f.vatTransactions?.filter((transaction) => !transaction.vatCode).length ?? f.rows.filter((r) => !val(r, VAT_CODE_KEYS)).length;
    checks.push({ id: `val_vat_${f.upload.id}`, tenantId: f.upload.tenantId, companyId: f.upload.companyId, name: "VAT coding completeness", status: missing ? "warning" : "passed", detail: missing ? `${missing} transaction(s) have missing VAT/tax code values.` : "All VAT rows include VAT/tax code values." });
  });

  // Cross-file: AR ledger vs TB debtors control
  const arFile = files.find((f) => f.upload.fileType === "aged_debtors" && f.isParsed);
  const tbFile = files.find((f) => f.upload.fileType === "trial_balance" && f.isParsed);
  if (arFile && tbFile) {
    const arTotal = canonicalDebtorTotal(arFile);
    const debtorControlRow = tbFile.trialBalance?.find((line) => /trade\s*debtor|accounts\s*receivable|debtor\s*control|receivables/i.test(line.accountName))
      ?? tbFile.rows.find((r) => /trade\s*debtor|accounts\s*receivable|debtor\s*control|receivables/i.test(val(r, ACCOUNT_NAME_KEYS)));
    if (debtorControlRow) {
      const ctrl = Math.abs(isCanonicalTrialBalanceLine(debtorControlRow) ? debtorControlRow.balance : amnt(debtorControlRow, BALANCE_KEYS));
      const diff = Math.abs(arTotal - ctrl);
      checks.push({ id: `val_ar_ctrl_${arFile.upload.id}`, tenantId: arFile.upload.tenantId, companyId: arFile.upload.companyId, name: "AR ledger agrees to debtors control", status: diff <= 100 ? "passed" : "warning", detail: diff <= 100 ? `AR ledger ${fc(arTotal)} agrees to debtors control.` : `AR ledger ${fc(arTotal)} vs TB control ${fc(ctrl)} — difference ${fc(diff)}.` });
    }
  }

  // Cross-file: AP ledger vs TB creditors control
  const apFile = files.find((f) => f.upload.fileType === "aged_creditors" && f.isParsed);
  if (apFile && tbFile) {
    const apTotal = canonicalCreditorTotal(apFile);
    const credControlRow = tbFile.trialBalance?.find((line) => /trade\s*creditor|accounts\s*payable|creditor\s*control|payables/i.test(line.accountName))
      ?? tbFile.rows.find((r) => /trade\s*creditor|accounts\s*payable|creditor\s*control|payables/i.test(val(r, ACCOUNT_NAME_KEYS)));
    if (credControlRow) {
      const ctrl = Math.abs(isCanonicalTrialBalanceLine(credControlRow) ? credControlRow.balance : amnt(credControlRow, BALANCE_KEYS));
      const diff = Math.abs(apTotal - ctrl);
      checks.push({ id: `val_ap_ctrl_${apFile.upload.id}`, tenantId: apFile.upload.tenantId, companyId: apFile.upload.companyId, name: "AP ledger agrees to creditors control", status: diff <= 100 ? "passed" : "warning", detail: diff <= 100 ? `AP ledger ${fc(apTotal)} agrees to creditors control.` : `AP ledger ${fc(apTotal)} vs TB control ${fc(ctrl)} — difference ${fc(diff)}.` });
    }
  }

  const bsFile = files.find((f) => f.upload.fileType === "balance_sheet" && f.isParsed);
  const plFile = files.find((f) => f.upload.fileType === "profit_loss" && f.isParsed);
  const vatFile = files.find((f) => f.upload.fileType === "vat_report" && f.isParsed);

  if (tbFile && bsFile) {
    const matched = [
      compareNamedBalance("cash / bank", tbFile.rows, bsFile.rows, [/cash|bank|current account/i], [/overdraft|loan/i]),
      compareNamedBalance("trade debtors", tbFile.rows, bsFile.rows, [/trade debtor|accounts receivable|debtor control|receivables/i]),
      compareNamedBalance("trade creditors", tbFile.rows, bsFile.rows, [/trade creditor|accounts payable|creditor control|payables/i]),
      compareNamedBalance("VAT control", tbFile.rows, bsFile.rows, [/vat|tax control|tax payable/i]),
      compareNamedBalance("bank loan", tbFile.rows, bsFile.rows, [/bank loan|borrowings|loan/i], [/intercompany|director/i]),
    ].filter((item): item is BalanceComparison => Boolean(item));
    const failures = matched.filter((item) => item.diff > reconciliationTolerance(item.tb));
    checks.push({
      id: `val_xfile_tb_bs_${tbFile.upload.id}`,
      tenantId: tbFile.upload.tenantId,
      companyId: tbFile.upload.companyId,
      name: "TB agrees to balance sheet extract",
      status: matched.length === 0 ? "warning" : failures.length ? "warning" : "passed",
      detail: matched.length === 0
        ? "No matching balance sheet control lines were identified for TB cross-check."
        : failures.length
          ? `${failures.length} balance sheet line(s) do not agree to the TB: ${failures.map((item) => `${item.label} ${fc(item.diff)}`).join("; ")}.`
          : `${matched.length} key balance sheet lines agree to the TB: ${matched.map((item) => item.label).join(", ")}.`
    });
  }

  if (tbFile && plFile) {
    const tbMovement = profitLossMovement(tbFile.rows.filter(isProfitLossRow));
    const plMovement = profitLossMovement(plFile.rows.filter((row) => !isSubtotalRow(row)));
    const diff = Math.abs(tbMovement - plMovement);
    checks.push({
      id: `val_xfile_pl_tb_${plFile.upload.id}`,
      tenantId: plFile.upload.tenantId,
      companyId: plFile.upload.companyId,
      name: "P&L agrees to trial balance movement",
      status: diff <= reconciliationTolerance(plMovement) ? "passed" : "warning",
      detail: diff <= reconciliationTolerance(plMovement)
        ? `P&L movement ${signedFc(plMovement)} agrees to TB profit and loss accounts.`
        : `P&L movement ${signedFc(plMovement)} vs TB profit and loss movement ${signedFc(tbMovement)} — difference ${fc(diff)}.`
    });
  }

  if (vatFile && tbFile) {
    const vatTotal = netVatReportTotal(vatFile);
    const vatControlPattern = /\bvat\b|\bgst\b|sales\s*tax|vat\s*control|vat\s*liabilit|tax\s*control|vat payable/i;
    const vatControlTotal = Math.abs(tbFile.trialBalance
      ?.filter((line) => vatControlPattern.test(line.accountName))
      .reduce((sum, line) => sum + line.balance, 0) ?? sumMatchingRows(tbFile.rows, [vatControlPattern]));
    const diff = Math.abs(Math.abs(vatTotal) - vatControlTotal);
    checks.push({
      id: `val_xfile_vat_ctrl_${vatFile.upload.id}`,
      tenantId: vatFile.upload.tenantId,
      companyId: vatFile.upload.companyId,
      name: "VAT report agrees to VAT control",
      status: vatControlTotal === 0 ? "warning" : diff <= reconciliationTolerance(vatTotal) ? "passed" : "warning",
      detail: vatControlTotal === 0
        ? "VAT report uploaded, but no VAT control account was identified in the TB."
        : diff <= reconciliationTolerance(vatTotal)
          ? `VAT report total ${fc(vatTotal)} agrees to TB VAT control ${fc(vatControlTotal)}.`
          : `VAT report total ${fc(vatTotal)} vs TB VAT control ${fc(vatControlTotal)} — difference ${fc(diff)}.`
    });
  }

  if (tbFile) {
    const bankRows = tbFile.rows.filter((row) => /cash|bank|current account/i.test(rowText(row)) && !/loan|borrow|overdraft/i.test(rowText(row)));
    const reconcilingRows = tbFile.rows.filter((row) => /unreconciled|uncleared|outstanding cheque|outstanding payment|bank reconciling|timing difference|in transit/i.test(rowText(row)));
    checks.push({
      id: `val_xfile_cash_bank_${tbFile.upload.id}`,
      tenantId: tbFile.upload.tenantId,
      companyId: tbFile.upload.companyId,
      name: "Cash accounts ready for bank reconciliation sign-off",
      status: bankRows.length === 0 ? "warning" : reconcilingRows.length ? "warning" : "passed",
      detail: bankRows.length === 0
        ? "No bank or cash account was identified in the TB."
        : reconcilingRows.length
          ? `${reconcilingRows.length} possible unreconciled bank item(s) detected — clear or evidence before sign-off.`
          : `${bankRows.length} bank/cash account(s) identified and no unreconciled item wording detected.`
    });
  }

  return checks;
}

function hasCanonicalImport(file: ParsedFile) {
  return Boolean(file.importResult);
}

function formatMappingConfidence(result: NormalisedImportResult) {
  if (!result.suggestions.length) return "No confident column mappings detected.";
  const requiredFields = requiredCanonicalFields(result);
  const suggestions = result.suggestions.filter((item) => requiredFields.includes(item.targetField));
  if (!suggestions.length) return "No confident required column mappings detected.";
  return suggestions
    .map((item) => `${item.targetField} from ${item.sourceColumn} (${Math.round(item.confidence * 100)}%)`)
    .join(", ");
}

function formatProfileStatus(result: NormalisedImportResult) {
  if (result.profile?.status === "confirmed") return `Reviewer-confirmed profile reused: ${result.profile.profileName}.`;
  if (result.profile?.status === "known_profile") return `Known profile applied: ${result.profile.profileName}.`;
  if (result.profile?.status === "needs_confirmation") return "Mapping profile needs reviewer confirmation.";
  return "Mapping profile suggested.";
}

function requiredCanonicalFields(result: NormalisedImportResult): Array<NonNullable<NormalisedImportResult["suggestions"][number]>["targetField"]> {
  if (result.fileType === "trial_balance") return result.mapping.balance ? ["accountName", "balance"] : ["accountName", "debit", "credit"];
  if (result.fileType === "aged_debtors") return result.mapping.invoiceNumber ? ["customerName", "invoiceNumber", "amount"] : ["customerName", "amount"];
  if (result.fileType === "aged_creditors") return result.mapping.invoiceNumber ? ["supplierName", "invoiceNumber", "amount"] : ["supplierName", "amount"];
  return ["vatCode", "netAmount", "vatAmount"];
}

function canonicalDebtorTotal(file: ParsedFile) {
  return file.debtors?.reduce((sum, debtor) => sum + debtor.amount, 0)
    ?? file.rows.reduce((sum, row) => sum + amnt(row, AR_AMOUNT_KEYS), 0);
}

function canonicalCreditorTotal(file: ParsedFile) {
  return file.creditors?.reduce((sum, creditor) => sum + creditor.amount, 0)
    ?? file.rows.reduce((sum, row) => sum + amnt(row, AP_AMOUNT_KEYS), 0);
}

function canonicalVatTotal(file: ParsedFile) {
  return file.vatTransactions?.reduce((sum, transaction) => sum + transaction.vatAmount, 0)
    ?? file.rows.reduce((sum, row) => sum + amnt(row, VAT_AMOUNT_KEYS), 0);
}

// Net VAT (output minus input) using each row's transaction type, mirroring the
// reconciliation engine so this cross-check agrees with REC_003 rather than
// summing both VAT sides gross. Falls back to the canonical sum without types.
function netVatReportTotal(file: ParsedFile) {
  const typeKeys = ["type", "transaction_type", "direction", "supply_type"];
  if (!file.rows.some((row) => val(row, typeKeys))) return Math.abs(canonicalVatTotal(file));
  return Math.abs(file.rows.reduce((sum, row) => {
    const vat = amnt(row, VAT_AMOUNT_KEYS);
    const isInput = /purchase|input|payable|accpay|bill|expense/i.test(val(row, typeKeys));
    return sum + (isInput ? -vat : vat);
  }, 0));
}

function isCanonicalTrialBalanceLine(value: TrialBalanceLine | Record<string, string>): value is TrialBalanceLine {
  return typeof (value as TrialBalanceLine).balance === "number";
}

// ─── Finding detection ─────────────────────────────────────────────────────────

function buildFindings(files: ParsedFile[]): Finding[] {
  return [
    ...buildArFindings(files),
    ...buildApFindings(files),
    ...buildVatFindings(files),
    ...buildTbFindings(files),
    ...buildPlFindings(files),
    ...buildBsFindings(files),
    ...buildControlsFindings(files),
    ...buildTargetedPatternFindings(files),
    ...buildSupportSheetFindings(files),
    ...buildDataQualityFindings(files),
    ...buildCrossFileFindings(files),
  ];
}

// ─── AR findings ───────────────────────────────────────────────────────────────

function buildArFindings(files: ParsedFile[]): Finding[] {
  const findings: Finding[] = [];
  const arFiles = files.filter((f) => f.upload.fileType === "aged_debtors" && f.isParsed);

  arFiles.forEach((file) => {
    const today = new Date();
    const rows = file.rows;
    const totalAR = rows.reduce((s, r) => s + amnt(r, AR_AMOUNT_KEYS), 0);

    // AR-01: Overdue balances
    const overdueRows = rows.map((r) => ({
      customer: val(r, CUSTOMER_KEYS) || "Unknown debtor",
      amount: amnt(r, AR_AMOUNT_KEYS),
      days: parseDayBucket(val(r, AR_DAYS_KEYS)),
    })).filter((r) => r.amount > 0 && (r.days >= 60 || r.amount >= 5000)).sort((a, b) => b.amount - a.amount);

    if (overdueRows.length > 0) {
      const total = overdueRows.reduce((s, r) => s + r.amount, 0);
      const critical120 = overdueRows.filter((r) => r.days >= 120);
      const top = overdueRows.slice(0, 5);
      findings.push(makeFinding(`ar_overdue_${file.upload.id}`, "ar", critical120.length > 0 || total > 50000 ? "critical" : "high", "high",
        `${overdueRows.length} debtor${overdueRows.length > 1 ? "s" : ""} — ${fc(total)} overdue${critical120.length > 0 ? `, ${critical120.length} exceed 120 days` : ""}`,
        critical120.length > 0 ? `${critical120.length} debtor(s) exceed 120 days. Recoverability provisions may be required.` : "Material overdue balances require collections review.",
        fc(total) + " collection exposure", file,
        { accountCode: top.map((r) => r.customer).join(" / "), calculation: `${overdueRows.length} rows with 60+ day age or balance ≥ £5,000 total ${fc(total)}.` }
      ));
    }

    // AR-02: Debtor concentration risk (single debtor > 25% of total AR)
    if (totalAR > 0) {
      const byCustomer = new Map<string, number>();
      rows.forEach((r) => {
        const name = val(r, CUSTOMER_KEYS) || "Unknown";
        byCustomer.set(name, (byCustomer.get(name) ?? 0) + amnt(r, AR_AMOUNT_KEYS));
      });
      byCustomer.forEach((bal, name) => {
        if (bal / totalAR > 0.25 && bal > 5000) {
          findings.push(makeFinding(`ar_conc_${file.upload.id}_${name.slice(0,20)}`, "ar", "high", "high",
            `Debtor concentration risk — ${name} is ${Math.round(bal / totalAR * 100)}% of total AR`,
            `${name} represents ${Math.round(bal / totalAR * 100)}% of total AR (${fc(bal)} of ${fc(totalAR)}). Concentration above 25% creates material collection risk.`,
            fc(bal) + " at risk from single debtor", file,
            { accountCode: name, calculation: `${fc(bal)} / ${fc(totalAR)} = ${Math.round(bal / totalAR * 100)}% of total outstanding AR.` }
          ));
        }
      });
    }

    // AR-03: Credit limit breach
    rows.forEach((r) => {
      const limit = amnt(r, CREDIT_LIMIT_KEYS);
      const bal = amnt(r, AR_AMOUNT_KEYS);
      const name = val(r, CUSTOMER_KEYS) || "Unknown debtor";
      if (limit > 0 && bal > limit) {
        findings.push(makeFinding(`ar_climit_${file.upload.id}_${name.slice(0,20)}`, "ar", bal / limit > 1.1 ? "high" : "medium", "high",
          `Credit limit exceeded — ${name} owes ${fc(bal)} against ${fc(limit)} limit`,
          `${name} has an outstanding balance of ${fc(bal)} against an approved credit limit of ${fc(limit)} — ${Math.round((bal/limit - 1)*100)}% over limit.`,
          "Credit review required", file,
          { accountCode: name, calculation: `Balance ${fc(bal)} > Credit limit ${fc(limit)}. Breach: ${fc(bal - limit)}.` }
        ));
      }
    });

    // AR-04: Negative debtor balances (credit note exceeding invoices)
    const negRows = rows.filter((r) => amnt(r, AR_AMOUNT_KEYS) < -1);
    if (negRows.length > 0) {
      const total = negRows.reduce((s, r) => s + amnt(r, AR_AMOUNT_KEYS), 0);
      const names = negRows.slice(0, 3).map((r) => val(r, CUSTOMER_KEYS)).filter(Boolean).join(", ");
      findings.push(makeFinding(`ar_negative_${file.upload.id}`, "ar", "medium", "high",
        `${negRows.length} negative debtor balance${negRows.length > 1 ? "s" : ""} — ${fc(Math.abs(total))} credit balance on AR ledger`,
        "Negative AR balances suggest credit notes exceed invoices or customer has overpaid. Review for refund or netting opportunities.",
        "Refund or netting review required", file,
        { accountCode: names || "Multiple", calculation: `${negRows.length} debtors with net credit balance totalling ${fc(Math.abs(total))}.` }
      ));
    }

    // AR-06: Stale invoices > 12 months outstanding
    const staleRows = rows.filter((r) => {
      const dt = parseDate(val(r, INVOICE_DATE_KEYS));
      return dt && (today.getTime() - dt.getTime()) > 365 * 24 * 3600 * 1000 && amnt(r, AR_AMOUNT_KEYS) > 0;
    });
    if (staleRows.length > 0) {
      const total = staleRows.reduce((s, r) => s + amnt(r, AR_AMOUNT_KEYS), 0);
      const names = staleRows.slice(0, 3).map((r) => val(r, CUSTOMER_KEYS)).filter(Boolean).join(", ");
      findings.push(makeFinding(`ar_stale_${file.upload.id}`, "ar", "high", "high",
        `${staleRows.length} invoice${staleRows.length > 1 ? "s" : ""} over 12 months old — ${fc(total)} possibly irrecoverable`,
        "Invoices outstanding more than 12 months may need to be written off or provided against. Review recoverability and consider bad debt provision.",
        "Bad debt provision review required", file,
        { accountCode: names || "Multiple debtors", calculation: `${staleRows.length} invoices dated > 365 days ago with balances totalling ${fc(total)}.` }
      ));
    }

    // AR-08: Disputed / on-hold debtors with aged balance
    const disputedRows = rows.filter((r) => {
      const st = val(r, STATUS_KEYS).toLowerCase();
      return (st.includes("disput") || st.includes("hold") || st.includes("query") || st.includes("stopped")) && amnt(r, AR_AMOUNT_KEYS) > 0;
    });
    if (disputedRows.length > 0) {
      const total = disputedRows.reduce((s, r) => s + amnt(r, AR_AMOUNT_KEYS), 0);
      const names = disputedRows.slice(0, 3).map((r) => val(r, CUSTOMER_KEYS)).filter(Boolean).join(", ");
      findings.push(makeFinding(`ar_dispute_${file.upload.id}`, "ar", "medium", "high",
        `${disputedRows.length} disputed or on-hold debtor${disputedRows.length > 1 ? "s" : ""} — ${fc(total)} requires resolution`,
        "Disputed or on-hold invoices with outstanding balances require formal resolution before sign-off.",
        "Dispute resolution required", file,
        { accountCode: names || "Multiple", calculation: `${disputedRows.length} rows with disputed/on-hold status and non-zero balance totalling ${fc(total)}.` }
      ));
    }

    // AR-07: Data quality — missing customer names
    const blankCust = rows.filter((r) => !val(r, CUSTOMER_KEYS) && amnt(r, AR_AMOUNT_KEYS) > 0);
    if (blankCust.length > rows.length * 0.05) {
      findings.push(makeFinding(`dq_ar_name_${file.upload.id}`, "data_quality", "medium", "high",
        `${blankCust.length} AR rows have no customer name`,
        "Missing customer names prevent collections follow-up and audit trail completeness.",
        "Data cleanse required", file,
        { accountCode: "AR ledger", calculation: `${blankCust.length} of ${rows.length} rows (${Math.round(blankCust.length/rows.length*100)}%) have no customer name.` }
      ));
    }
  });

  // AR-05: Contra account risk (debtor also appears as creditor)
  const arFile = files.find((f) => f.upload.fileType === "aged_debtors" && f.isParsed);
  const apFile = files.find((f) => f.upload.fileType === "aged_creditors" && f.isParsed);
  if (arFile && apFile) {
    const debtors = new Set(arFile.rows.map((r) => normaliseName(val(r, CUSTOMER_KEYS))).filter(Boolean));
    const contraMatches: string[] = [];
    apFile.rows.forEach((r) => {
      const name = normaliseName(val(r, SUPPLIER_KEYS));
      if (name && debtors.has(name) && amnt(r, AP_AMOUNT_KEYS) > 0) contraMatches.push(val(r, SUPPLIER_KEYS));
    });
    if (contraMatches.length > 0) {
      const unique = [...new Set(contraMatches)].slice(0, 4).join(", ");
      findings.push(makeFinding(`ar_contra_${arFile.upload.id}`, "ar", "medium", "medium",
        `Contra account risk — ${[...new Set(contraMatches)].length} party/parties appear in both AR and AP`,
        "Parties that appear as both debtor and creditor may be eligible for contra netting, reducing settlement risk and improving cash position.",
        "Contra netting review recommended", arFile,
        { accountCode: unique, calculation: `${[...new Set(contraMatches)].length} supplier name(s) match debtor names after normalisation: ${unique}.` }
      ));
    }
  }

  return findings;
}

// ─── AP findings ───────────────────────────────────────────────────────────────

function buildApFindings(files: ParsedFile[]): Finding[] {
  const findings: Finding[] = [];
  files.filter((f) => f.upload.fileType === "aged_creditors" && f.isParsed).forEach((file) => {
    const rows = file.rows;
    const today = new Date();

    // AP-01: Duplicate payment by supplier + invoice reference + amount
    const byRef = new Map<string, Record<string, string>[]>();
    rows.forEach((r) => {
      const ref = val(r, INVOICE_REF_KEYS);
      const supplier = normaliseName(val(r, SUPPLIER_KEYS));
      const amount = amnt(r, AP_AMOUNT_KEYS);
      if (!ref || ref.length < 2 || !supplier || !amount) return;
      const key = `${supplier}|${ref.trim().toLowerCase()}|${amount.toFixed(2)}`;
      byRef.set(key, [...(byRef.get(key) ?? []), r]);
    });
    const dupRefs = [...byRef.entries()].filter(([, rs]) => rs.length > 1);
    dupRefs.slice(0, 3).forEach(([key, rs]) => {
      const [, ref] = key.split("|");
      const invoiceAmt = amnt(rs[0], AP_AMOUNT_KEYS);
      const supplier = val(rs[0], SUPPLIER_KEYS) || "Unknown supplier";
      findings.push(makeFinding(`ap_dup_pay_${file.upload.id}_${ref.slice(0,20)}`, "ap", "high", "high",
        `Duplicate payment — invoice ${ref} appears ${rs.length} times`,
        `Invoice reference "${ref}" from ${supplier} appears ${rs.length} times in the AP ledger — likely duplicate payment.`,
        invoiceAmt ? `${fc(invoiceAmt * (rs.length - 1))} potential overpayment` : "Review required", file,
        { accountCode: supplier, calculation: `Invoice ref "${ref}" matched on ${rs.length} rows. Unit amount ${fc(invoiceAmt)}.` }
      ));
    });

    // AP-02: Duplicate by supplier + date + amount (fallback)
    if (dupRefs.length === 0) {
      const byKey = new Map<string, Record<string, string>[]>();
      rows.forEach((r) => {
        const s = val(r, SUPPLIER_KEYS) || "unknown";
        const d = val(r, INVOICE_DATE_KEYS) || "unknown";
        const a = amnt(r, AP_AMOUNT_KEYS);
        if (!a) return;
        const key = `${normaliseName(s)}|${d}|${a.toFixed(2)}`;
        byKey.set(key, [...(byKey.get(key) ?? []), r]);
      });
      const dupKey = [...byKey.entries()].find(([, rs]) => rs.length > 1);
      if (dupKey) {
        const [key, rs] = dupKey;
        const [, , amt] = key.split("|");
        const supplier = val(rs[0], SUPPLIER_KEYS) || "Unknown";
        const date = val(rs[0], INVOICE_DATE_KEYS);
        findings.push(makeFinding(`ap_dup_sa_${file.upload.id}`, "ap", "medium", "medium",
          "Possible duplicate supplier invoice — same supplier, date and amount",
          `${rs.length} AP rows share supplier "${supplier}", date ${date} and amount ${fc(Number(amt))}.`,
          `${fc(Number(amt))} potential leakage avoided`, file,
          { accountCode: supplier, calculation: `${rs.length} rows: supplier ${supplier}, date ${date}, amount ${fc(Number(amt))}.` }
        ));
      }
    }

    // AP-03: Duplicate vendor master
    const supplierCount = new Map<string, { original: string; count: number }>();
    rows.forEach((r) => {
      const name = val(r, SUPPLIER_KEYS);
      if (!name || name.length < 2) return;
      const key = normaliseName(name);
      const ex = supplierCount.get(key);
      ex ? ex.count++ : supplierCount.set(key, { original: name, count: 1 });
    });
    const dupVendors = [...supplierCount.entries()].filter(([, v]) => v.count > 1);
    if (dupVendors.length > 0) {
      const names = dupVendors.map(([, v]) => v.original).slice(0, 3).join(", ");
      findings.push(makeFinding(`ap_dup_vendor_${file.upload.id}`, "ap", "medium", "medium",
        `Duplicate vendor risk — ${dupVendors.length} supplier${dupVendors.length > 1 ? "s" : ""} appear multiple times`,
        "Duplicate or near-duplicate vendor names may indicate vendor master gaps or duplicate payment risk.",
        "Vendor master cleanup required", file,
        { accountCode: names, calculation: `${dupVendors.length} supplier name(s) resolve to the same vendor after normalisation: ${names}.` }
      ));
    }

    // AP-04: Old uncleared creditor items > 90 days
    const oldRows = rows.filter((r) => {
      const dt = parseDate(val(r, INVOICE_DATE_KEYS));
      const daysBucket = parseDayBucket(val(r, AR_DAYS_KEYS));
      const old = dt ? (today.getTime() - dt.getTime()) > 90 * 24 * 3600 * 1000 : daysBucket >= 90;
      return old && amnt(r, AP_AMOUNT_KEYS) > 0;
    });
    if (oldRows.length > 0) {
      const total = oldRows.reduce((s, r) => s + amnt(r, AP_AMOUNT_KEYS), 0);
      const names = [...new Set(oldRows.map((r) => val(r, SUPPLIER_KEYS)).filter(Boolean))].slice(0, 3).join(", ");
      findings.push(makeFinding(`ap_old_${file.upload.id}`, "ap", oldRows.some((r) => parseDayBucket(val(r, AR_DAYS_KEYS)) >= 120) ? "high" : "medium", "high",
        `${oldRows.length} uncleared creditor item${oldRows.length > 1 ? "s" : ""} over 90 days — ${fc(total)} outstanding`,
        "Long-outstanding creditor items may indicate payment disputes, lost invoices or supplier relationship issues requiring resolution.",
        "Supplier reconciliation and clearance required", file,
        { accountCode: names || "Multiple suppliers", calculation: `${oldRows.length} AP rows aged > 90 days with balances totalling ${fc(total)}.` }
      ));
    }

    // AP-05: Negative creditor balances (overpayments)
    const negRows = rows.filter((r) => amnt(r, AP_AMOUNT_KEYS) < -1);
    if (negRows.length > 0) {
      const total = negRows.reduce((s, r) => s + amnt(r, AP_AMOUNT_KEYS), 0);
      const names = negRows.slice(0, 3).map((r) => val(r, SUPPLIER_KEYS)).filter(Boolean).join(", ");
      findings.push(makeFinding(`ap_neg_${file.upload.id}`, "ap", "medium", "high",
        `${negRows.length} negative creditor balance${negRows.length > 1 ? "s" : ""} — ${fc(Math.abs(total))} overpaid`,
        "Debit balances on creditor accounts suggest overpayment or unapplied credit notes. Recover balances or apply to future invoices.",
        `${fc(Math.abs(total))} recovery opportunity`, file,
        { accountCode: names || "Multiple", calculation: `${negRows.length} creditors with debit balance totalling ${fc(Math.abs(total))}.` }
      ));
    }

    // AP-06: Below-threshold invoice splitting (approval limit avoidance)
    const thresholds = [1000, 5000, 10000];
    const bySupplierDate = new Map<string, { rows: Record<string, string>[]; total: number }>();
    rows.forEach((r) => {
      const supplier = normaliseName(val(r, SUPPLIER_KEYS)) || "unknown";
      const date = val(r, INVOICE_DATE_KEYS) || "unknown";
      const key = `${supplier}|${date}`;
      const existing = bySupplierDate.get(key);
      if (existing) { existing.rows.push(r); existing.total += amnt(r, AP_AMOUNT_KEYS); }
      else bySupplierDate.set(key, { rows: [r], total: amnt(r, AP_AMOUNT_KEYS) });
    });
    bySupplierDate.forEach(({ rows: grpRows, total }, key) => {
      if (grpRows.length < 3) return;
      for (const threshold of thresholds) {
        const allBelow = grpRows.every((r) => amnt(r, AP_AMOUNT_KEYS) < threshold);
        if (allBelow && total > threshold) {
          const [supplier] = key.split("|");
          const names = val(grpRows[0], SUPPLIER_KEYS) || supplier;
          findings.push(makeFinding(`ap_split_${file.upload.id}_${supplier.slice(0,20)}`, "controls", "high", "medium",
            `Possible approval limit avoidance — ${grpRows.length} invoices from ${val(grpRows[0], SUPPLIER_KEYS) || supplier} on same date, each below £${threshold.toLocaleString()}, total ${fc(total)}`,
            `${grpRows.length} invoices from the same supplier on the same date are each below the £${threshold.toLocaleString()} approval threshold, but total ${fc(total)}. May indicate deliberate splitting to avoid authorisation.`,
            "Management approval and review required", file,
            { accountCode: names, calculation: `${grpRows.length} invoices × avg ${fc(total / grpRows.length)}, each < £${threshold.toLocaleString()}, combined ${fc(total)}.` }
          ));
          return;
        }
      }
    });

    // AP-07: New vendor with high-value first invoice
    const vendorFreq = new Map<string, number>();
    rows.forEach((r) => { const n = normaliseName(val(r, SUPPLIER_KEYS)); if (n) vendorFreq.set(n, (vendorFreq.get(n) ?? 0) + 1); });
    rows.forEach((r) => {
      const n = normaliseName(val(r, SUPPLIER_KEYS));
      const amt = amnt(r, AP_AMOUNT_KEYS);
      if (n && vendorFreq.get(n) === 1 && amt > 5000) {
        findings.push(makeFinding(`ap_new_vendor_${file.upload.id}_${n.slice(0,20)}`, "controls", "medium", "medium",
          `New vendor — ${val(r, SUPPLIER_KEYS) || n} has a single high-value invoice of ${fc(amt)}`,
          "A first-time vendor with a high-value invoice warrants due diligence on vendor legitimacy, payment details and approval authorisation.",
          "Vendor due diligence required", file,
          { accountCode: val(r, SUPPLIER_KEYS) || n, calculation: `Single invoice from new vendor, amount ${fc(amt)}.` }
        ));
      }
    });

    // AP-08: Round number invoices pattern
    const roundRows = rows.filter((r) => { const a = amnt(r, AP_AMOUNT_KEYS); return a > 0 && a % 1000 === 0; });
    if (rows.length >= 20 && roundRows.length / rows.length > 0.2) {
      findings.push(makeFinding(`ap_round_${file.upload.id}`, "controls", "low", "low",
        `Round number invoice pattern — ${Math.round(roundRows.length/rows.length*100)}% of AP invoices are multiples of £1,000`,
        "A high proportion of round-number invoice amounts may indicate estimated accruals rather than actual invoiced amounts, or manual invoice creation.",
        "Review for estimated vs actual invoices", file,
        { accountCode: "AP ledger", calculation: `${roundRows.length} of ${rows.length} invoices (${Math.round(roundRows.length/rows.length*100)}%) are exact multiples of £1,000.` }
      ));
    }

    // AP-12: Payments to personal/individual payees
    const personalRows = rows.filter((r) => {
      const name = val(r, SUPPLIER_KEYS);
      return name && (PERSONAL_PAYEE_RE.test(name) || (!/(ltd|llp|plc|inc|co\.|group|limited|solutions|services|consulting)$/i.test(name) && /^[A-Z][a-z]+ [A-Z][a-z]+$/.test(name))) && amnt(r, AP_AMOUNT_KEYS) > 500;
    });
    if (personalRows.length > 0) {
      const total = personalRows.reduce((s, r) => s + amnt(r, AP_AMOUNT_KEYS), 0);
      const names = personalRows.slice(0, 3).map((r) => val(r, SUPPLIER_KEYS)).filter(Boolean).join(", ");
      findings.push(makeFinding(`ap_personal_${file.upload.id}`, "controls", "medium", "low",
        `${personalRows.length} payment${personalRows.length > 1 ? "s" : ""} to individual payees — ${fc(total)} total`,
        "Payments to individuals rather than companies warrant review for PAYE implications, IR35 considerations, or potential fraud risk.",
        "PAYE/IR35/fraud review recommended", file,
        { accountCode: names || "Multiple", calculation: `${personalRows.length} rows with person-name payees totalling ${fc(total)}.` }
      ));
    }

    // Missing accrual — recurring supplier with zero/no invoice
    const recurringZero = rows.filter((r) => RECURRING_KEYWORDS.test(val(r, SUPPLIER_KEYS)) && amnt(r, AP_AMOUNT_KEYS) === 0);
    if (recurringZero.length > 0) {
      const names = recurringZero.slice(0, 3).map((r) => val(r, SUPPLIER_KEYS)).filter(Boolean).join(", ");
      findings.push(makeFinding(`me_ap_accrual_${file.upload.id}`, "month_end", "high", "high",
        `Missing accrual — ${recurringZero.length} recurring supplier${recurringZero.length > 1 ? "s" : ""} with no invoice amount`,
        "Recurring suppliers (utilities, rent, maintenance) appear in the AP ledger with zero balance — invoices may not have been received or accrued.",
        "Accrual entries required before close", file,
        { accountCode: names, calculation: `${recurringZero.length} recurring supplier row(s) with zero invoice amount: ${names}.` }
      ));
    }
  });

  return findings;
}

// ─── VAT findings ─────────────────────────────────────────────────────────────

function buildVatFindings(files: ParsedFile[]): Finding[] {
  const findings: Finding[] = [];
  files.filter((f) => f.upload.fileType === "vat_report" && f.isParsed).forEach((file) => {
    const rows = file.rows;

    // VAT-01: Missing VAT codes
    const missing = rows.filter((r) => !val(r, VAT_CODE_KEYS));
    if (missing.length) {
      findings.push(makeFinding(`vat_missing_${file.upload.id}`, "vat", missing.length > 25 ? "high" : "medium", "high",
        `Missing VAT codes on ${missing.length} transaction${missing.length > 1 ? "s" : ""}`,
        "Transactions without VAT/tax treatment codes cannot be correctly included in the VAT return.",
        "Potential VAT return exception", file,
        { accountCode: "VAT detail", calculation: `${missing.length} row(s) have blank VAT/tax code fields.` }
      ));
    }

    // VAT-02: Exempt/zero coding on standard-rate categories
    const suspectCoding = rows.filter((r) => {
      const code = val(r, VAT_CODE_KEYS);
      const desc = val(r, DESC_KEYS);
      return code && EXEMPT_VAT_CODES.test(code.trim()) && desc && STANDARD_RATE_CATS.test(desc);
    });
    if (suspectCoding.length > 0) {
      const examples = suspectCoding.slice(0, 3).map((r) => val(r, DESC_KEYS)).filter(Boolean).join(", ");
      findings.push(makeFinding(`vat_coding_${file.upload.id}`, "vat", "high", "high",
        `VAT anomaly — ${suspectCoding.length} transaction${suspectCoding.length > 1 ? "s" : ""} coded exempt on standard-rate expense categories`,
        "Standard-rated service expenses coded as exempt/zero-rated will cause under-claimed input VAT on the return.",
        "VAT return error — under-claimed input VAT", file,
        { accountCode: examples || "VAT detail", calculation: `${suspectCoding.length} row(s) carry exempt/zero code on standard-rate categories: ${examples}.` }
      ));
    }

    // VAT-03: Reverse charge not applied
    const reverseChargeRisk = rows.filter((r) => {
      const supplier = val(r, SUPPLIER_KEYS);
      const desc = val(r, DESC_KEYS);
      const code = val(r, VAT_CODE_KEYS);
      const isOverseas = EU_SUPPLIER_KEYWORDS.test(supplier) || EU_SUPPLIER_KEYWORDS.test(desc);
      const notReverseCharged = code && !REVERSE_CHARGE_CATS.test(code);
      return isOverseas && notReverseCharged;
    });
    if (reverseChargeRisk.length > 0) {
      const total = reverseChargeRisk.reduce((s, r) => s + amnt(r, NET_AMOUNT_KEYS), 0);
      const examples = reverseChargeRisk.slice(0, 3).map((r) => val(r, SUPPLIER_KEYS) || val(r, DESC_KEYS)).filter(Boolean).join(", ");
      findings.push(makeFinding(`vat_reverse_${file.upload.id}`, "vat", "high", "medium",
        `Reverse charge VAT not applied on ${reverseChargeRisk.length} overseas transaction${reverseChargeRisk.length > 1 ? "s" : ""} — ${fc(total)} net`,
        "Overseas/EU supplier transactions may require reverse charge VAT accounting. Incorrect treatment could result in penalties and interest.",
        "Reverse charge review required before VAT submission", file,
        { accountCode: examples || "VAT detail", calculation: `${reverseChargeRisk.length} overseas transactions totalling ${fc(total)} not coded as reverse charge.` }
      ));
    }

    // VAT-04: Input VAT on blocked items (entertainment)
    const blockedVat = rows.filter((r) => {
      const desc = val(r, DESC_KEYS);
      const code = val(r, VAT_CODE_KEYS);
      const vatAmt = amnt(r, VAT_AMOUNT_KEYS);
      return BLOCKED_VAT_CATS.test(desc) && code && !EXEMPT_VAT_CODES.test(code.trim()) && vatAmt > 0;
    });
    if (blockedVat.length > 0) {
      const totalVat = blockedVat.reduce((s, r) => s + amnt(r, VAT_AMOUNT_KEYS), 0);
      findings.push(makeFinding(`vat_blocked_${file.upload.id}`, "vat", "high", "high",
        `Input VAT claimed on ${blockedVat.length} blocked item${blockedVat.length > 1 ? "s" : ""} — ${fc(totalVat)} non-reclaimable VAT`,
        "VAT on entertainment and business hospitality is blocked under HMRC rules — input tax cannot be reclaimed. Inclusion in the VAT return could trigger penalties.",
        `${fc(totalVat)} non-reclaimable input VAT to remove`, file,
        { accountCode: "Entertainment / blocked items", calculation: `${blockedVat.length} entertainment rows with input VAT totalling ${fc(totalVat)}.` }
      ));
    }

    // VAT-05: VAT rounding differences
    const vatRoundingDiff = Math.abs(rows.reduce((s, r) => {
      const vatAmt = amnt(r, VAT_AMOUNT_KEYS);
      const netAmt = amnt(r, NET_AMOUNT_KEYS);
      const code = val(r, VAT_CODE_KEYS);
      const rate = code?.includes("20") ? 0.20 : code?.includes("5") ? 0.05 : 0;
      return s + (vatAmt - Math.round(netAmt * rate * 100) / 100);
    }, 0));
    if (vatRoundingDiff > 5) {
      findings.push(makeFinding(`vat_rounding_${file.upload.id}`, "vat", "medium", "medium",
        `VAT rounding difference — ${fc(vatRoundingDiff)} discrepancy between VAT amounts and calculated VAT`,
        "The sum of VAT amounts does not reconcile to the expected VAT based on net amounts and rates. May indicate miscoded rates or rounding errors in the source system.",
        "VAT reconciliation review required", file,
        { accountCode: "VAT report totals", calculation: `Sum of VAT amounts vs net × rate produces ${fc(vatRoundingDiff)} discrepancy.` }
      ));
    }

    // VAT-06: Entertainment with standard-rate VAT
    const entertainmentVat = rows.filter((r) => ENTERTAINMENT_CATS.test(val(r, DESC_KEYS)) && amnt(r, VAT_AMOUNT_KEYS) > 0);
    if (entertainmentVat.length > 0 && entertainmentVat.some((r) => !BLOCKED_VAT_CATS.test(val(r, DESC_KEYS)))) {
      const total = entertainmentVat.reduce((s, r) => s + amnt(r, VAT_AMOUNT_KEYS), 0);
      findings.push(makeFinding(`vat_entertain_${file.upload.id}`, "vat", "high", "high",
        `Entertainment VAT — ${fc(total)} input VAT on ${entertainmentVat.length} entertainment transaction${entertainmentVat.length > 1 ? "s" : ""}`,
        "Entertainment expenses with reclaimable VAT require careful review. HMRC blocks input tax on client entertainment — only staff-only events may qualify.",
        `${fc(total)} VAT in dispute — review before submission`, file,
        { accountCode: "Entertainment", calculation: `${entertainmentVat.length} entertainment rows with total input VAT of ${fc(total)}.` }
      ));
    }

    // VAT-07: Fuel VAT without fuel scale charge
    const hasFuelVat = rows.some((r) => FUEL_KEYWORDS.test(val(r, DESC_KEYS)) && amnt(r, VAT_AMOUNT_KEYS) > 0);
    const hasFuelScale = rows.some((r) => FUEL_SCALE_KEYWORDS.test(val(r, DESC_KEYS)));
    if (hasFuelVat && !hasFuelScale) {
      findings.push(makeFinding(`vat_fuel_scale_${file.upload.id}`, "vat", "medium", "medium",
        "Fuel input VAT claimed but no fuel scale charge found",
        "When reclaiming VAT on business fuel for company cars, HMRC requires a fuel scale charge to account for private mileage. No fuel scale charge row detected in this period.",
        "Fuel scale charge may be required", file,
        { accountCode: "Fuel / motor expenses", calculation: "Fuel VAT reclaimed but no matching fuel scale charge row detected in the VAT report." }
      ));
    }
  });

  return findings;
}

// ─── Trial Balance / P&L / Balance Sheet findings ─────────────────────────────

function buildTbFindings(files: ParsedFile[]): Finding[] {
  const findings: Finding[] = [];
  files.filter((f) => f.upload.fileType === "trial_balance" && f.isParsed).forEach((file) => {
    const rows = file.rows;

    // TB-03: Suspense account balances
    const suspenseRows = rows.filter((r) => SUSPENSE_KEYWORDS.test(val(r, ACCOUNT_NAME_KEYS)) && Math.abs(amnt(r, BALANCE_KEYS)) > 1);
    if (suspenseRows.length > 0) {
      const total = suspenseRows.reduce((s, r) => s + Math.abs(amnt(r, BALANCE_KEYS)), 0);
      const names = suspenseRows.slice(0, 3).map((r) => val(r, ACCOUNT_NAME_KEYS)).filter(Boolean).join(", ");
      findings.push(makeFinding(`tb_suspense_${file.upload.id}`, "controls", "high", "high",
        `Suspense/clearing account${suspenseRows.length > 1 ? "s" : ""} with ${fc(total)} outstanding balance`,
        "Uncleared suspense or clearing account balances indicate unresolved transactions that must be allocated before period-end sign-off.",
        "Clear suspense balances before sign-off", file,
        { accountCode: names, calculation: `${suspenseRows.length} suspense/clearing account(s) with total balance ${fc(total)}.` }
      ));
    }

    // TB-04: Zero depreciation on fixed asset accounts
    const assetRows = rows.filter((r) => ASSET_KEYWORDS.test(val(r, ACCOUNT_NAME_KEYS)) && Math.abs(amnt(r, BALANCE_KEYS)) > 0);
    const depnRows = rows.filter((r) => DEPN_KEYWORDS.test(val(r, ACCOUNT_NAME_KEYS)) && Math.abs(amnt(r, BALANCE_KEYS)) > 0);
    if (assetRows.length > 0 && depnRows.length === 0) {
      const assetTotal = assetRows.reduce((s, r) => s + Math.abs(amnt(r, BALANCE_KEYS)), 0);
      findings.push(makeFinding(`tb_depn_${file.upload.id}`, "month_end", "high", "medium",
        `Zero depreciation — fixed assets of ${fc(assetTotal)} with no depreciation charge in the period`,
        "Fixed asset accounts have material balances but no depreciation/amortisation charge has been posted this period. This may understate expenses and overstate asset values.",
        "Post depreciation charge before sign-off", file,
        { accountCode: "Fixed assets / Depreciation", calculation: `Fixed assets ${fc(assetTotal)} but no depreciation account row with non-zero balance found.` }
      ));
    }

    // TB-02: Negative asset balances
    const negAssets = rows.filter((r) => ASSET_KEYWORDS.test(val(r, ACCOUNT_NAME_KEYS)) && !DEPN_KEYWORDS.test(val(r, ACCOUNT_NAME_KEYS)) && amnt(r, BALANCE_KEYS) < -100);
    if (negAssets.length > 0) {
      const total = negAssets.reduce((s, r) => s + amnt(r, BALANCE_KEYS), 0);
      const names = negAssets.slice(0, 3).map((r) => val(r, ACCOUNT_NAME_KEYS)).join(", ");
      findings.push(makeFinding(`tb_neg_asset_${file.upload.id}`, "month_end", "high", "medium",
        `Negative asset balance — ${fc(Math.abs(total))} credit balance on asset accounts`,
        "Asset accounts with credit balances (negative NBV) may indicate over-depreciation, incorrect posting or account misclassification.",
        "Review and correct asset account postings", file,
        { accountCode: names, calculation: `${negAssets.length} asset account(s) with credit balance totalling ${fc(Math.abs(total))}.` }
      ));
    }

    // TB-05: Intercompany account imbalance
    const intercoRows = rows.filter((r) => INTERCO_KEYWORDS.test(val(r, ACCOUNT_NAME_KEYS)));
    if (intercoRows.length > 0) {
      const netBalance = intercoRows.reduce((s, r) => s + amnt(r, BALANCE_KEYS), 0);
      if (Math.abs(netBalance) > 100) {
        findings.push(makeFinding(`tb_interco_${file.upload.id}`, "controls", "high", "medium",
          `Intercompany / director loan account balance — ${fc(Math.abs(netBalance))} net`,
          "Intercompany or director loan account balances require disclosure and may have tax implications (benefit in kind, transfer pricing, s455 charge).",
          "Tax and disclosure review required", file,
          { accountCode: intercoRows.map((r) => val(r, ACCOUNT_NAME_KEYS)).slice(0, 3).join(", "), calculation: `Intercompany/DLA accounts net to ${fc(netBalance)}.` }
        ));
      }
    }

    // TB-08: Director loan account balance
    const dlaRows = rows.filter((r) => /director|dla|director.s\s*loan|shareholder\s*loan/i.test(val(r, ACCOUNT_NAME_KEYS)) && Math.abs(amnt(r, BALANCE_KEYS)) > 5000);
    if (dlaRows.length > 0) {
      const total = dlaRows.reduce((s, r) => s + amnt(r, BALANCE_KEYS), 0);
      const names = dlaRows.map((r) => val(r, ACCOUNT_NAME_KEYS)).join(", ");
      findings.push(makeFinding(`tb_dla_${file.upload.id}`, "controls", "medium", "high",
        `Director loan account — ${fc(Math.abs(total))} balance requires disclosure`,
        total < 0 ? `Director owes the company ${fc(Math.abs(total))}. S455 tax charge may apply if outstanding at year-end.` : `Company owes director ${fc(total)}. Ensure proper documentation and interest treatment.`,
        "Tax advice and board disclosure required", file,
        { accountCode: names, calculation: `Director loan account(s) balance: ${fc(total)}.` }
      ));
    }

    // TB-09: Goodwill / intangible not being amortised
    const goodwillRows = rows.filter((r) => GOODWILL_KEYWORDS.test(val(r, ACCOUNT_NAME_KEYS)) && Math.abs(amnt(r, BALANCE_KEYS)) > 0);
    const amortRows = rows.filter((r) => /amortis|amortiz/i.test(val(r, ACCOUNT_NAME_KEYS)) && Math.abs(amnt(r, BALANCE_KEYS)) > 0);
    if (goodwillRows.length > 0 && amortRows.length === 0) {
      const total = goodwillRows.reduce((s, r) => s + Math.abs(amnt(r, BALANCE_KEYS)), 0);
      findings.push(makeFinding(`tb_goodwill_${file.upload.id}`, "month_end", "high", "medium",
        `Goodwill/intangibles of ${fc(total)} with no amortisation charge`,
        "Goodwill and intangible assets must be amortised (or tested for impairment) under UK GAAP and IFRS. No amortisation charge detected this period.",
        "Review amortisation policy and post charge", file,
        { accountCode: goodwillRows.map((r) => val(r, ACCOUNT_NAME_KEYS)).slice(0, 2).join(", "), calculation: `Goodwill/intangibles ${fc(total)}, amortisation account balance = zero.` }
      ));
    }

    // TB-11: Missing accruals (recurring expense categories at low balance)
    const expenseRows = rows.filter((r) => RECURRING_KEYWORDS.test(val(r, ACCOUNT_NAME_KEYS)));
    const expenseTotal = Math.abs(expenseRows.reduce((s, r) => s + amnt(r, BALANCE_KEYS), 0));
    if (expenseRows.length > 0 && expenseTotal < 30000) {
      findings.push(makeFinding(`me_tb_accrual_${file.upload.id}`, "month_end", "medium", "low",
        `Potential missing accruals — recurring expense accounts total only ${fc(expenseTotal)}`,
        "Recurring expense categories (utilities, rent, professional fees) appear below expected levels — accruals may be missing.",
        "Accrual review required before sign-off", file,
        { accountCode: "Recurring expense accounts", calculation: `${expenseRows.length} recurring expense account(s) total ${fc(expenseTotal)} — below expected run-rate.` }
      ));
    }

    // CTL-03: Late journal entries
    const today = new Date();
    const periodEndDate = inferPeriodEnd(rows);
    if (periodEndDate) {
      const lateRows = rows.filter((r) => {
        const postDate = parseDate(val(r, POSTING_DATE_KEYS));
        return postDate && postDate > periodEndDate && amnt(r, BALANCE_KEYS) > 1000 && (postDate.getTime() - periodEndDate.getTime()) > 5 * 24 * 3600 * 1000;
      });
      if (lateRows.length > 0) {
        const total = lateRows.reduce((s, r) => s + Math.abs(amnt(r, BALANCE_KEYS)), 0);
        findings.push(makeFinding(`ctl_late_jnl_${file.upload.id}`, "controls", "medium", "medium",
          `${lateRows.length} late journal${lateRows.length > 1 ? "s" : ""} posted after period end — ${fc(total)} total`,
          "Journals posted significantly after period end may indicate backdated entries or unauthorised post-period adjustments.",
          "Review and authorise late journal entries", file,
          { accountCode: "Post-period journals", calculation: `${lateRows.length} rows with posting date > 5 days after inferred period end, totalling ${fc(total)}.` }
        ));
      }
    }

    // CTL-04: Journals with no description
    const noDescRows = rows.filter((r) => !val(r, DESC_KEYS) && Math.abs(amnt(r, BALANCE_KEYS)) > 500);
    if (noDescRows.length > rows.length * 0.1) {
      findings.push(makeFinding(`ctl_no_desc_${file.upload.id}`, "controls", "low", "high",
        `${noDescRows.length} journal entries with no description or narration`,
        "Missing journal narrations reduce audit trail quality and make reviews harder. All material entries should have a description.",
        "Add narrations to undescribed journal entries", file,
        { accountCode: "TB — undescribed rows", calculation: `${noDescRows.length} of ${rows.length} rows have no description and amount > £500.` }
      ));
    }

    // CTL-06: Weekend transaction postings
    const weekendRows = rows.filter((r) => {
      const d = parseDate(val(r, POSTING_DATE_KEYS));
      return d && (d.getDay() === 0 || d.getDay() === 6) && Math.abs(amnt(r, BALANCE_KEYS)) > 1000;
    });
    if (weekendRows.length > 0) {
      const total = weekendRows.reduce((s, r) => s + Math.abs(amnt(r, BALANCE_KEYS)), 0);
      findings.push(makeFinding(`ctl_weekend_${file.upload.id}`, "controls", "medium", "high",
        `${weekendRows.length} material journal${weekendRows.length > 1 ? "s" : ""} posted on a weekend — ${fc(total)} total`,
        "Transactions posted on weekends may indicate unauthorised system access or errors. All weekend postings above £1,000 should be reviewed.",
        "Review authorisation for weekend journal entries", file,
        { accountCode: "Weekend postings", calculation: `${weekendRows.length} entries posted Saturday/Sunday with combined value ${fc(total)}.` }
      ));
    }

    void today;
  });

  return findings;
}

function buildPlFindings(files: ParsedFile[]): Finding[] {
  const findings: Finding[] = [];
  files.filter((f) => f.upload.fileType === "profit_loss" && f.isParsed).forEach((file) => {
    const rows = file.rows;

    // PL-04: Payroll absent
    const payrollRows = rows.filter((r) => PAYROLL_KEYWORDS.test(val(r, ACCOUNT_NAME_KEYS)));
    const payrollTotal = payrollRows.reduce((s, r) => s + Math.abs(amnt(r, BALANCE_KEYS)), 0);
    if (payrollRows.length === 0 || payrollTotal === 0) {
      findings.push(makeFinding(`pl_payroll_${file.upload.id}`, "month_end", "high", "medium",
        "Payroll / salary costs absent from P&L",
        "No payroll, wages or salary cost rows detected in the P&L. This may indicate PAYE has not been posted, or data is incomplete.",
        "Confirm payroll has been posted and included", file,
        { accountCode: "Payroll / wages", calculation: "No row matching payroll, wages, salary, PAYE or NIC found with a non-zero balance." }
      ));
    }

    // PL-01: Gross margin check
    const revenueRows = rows.filter((r) => /revenue|turnover|sales|income/i.test(val(r, ACCOUNT_NAME_KEYS)));
    const cogsRows = rows.filter((r) => /cost\s*of\s*sale|cogs|direct\s*cost|cost\s*of\s*good/i.test(val(r, ACCOUNT_NAME_KEYS)));
    const revenue = revenueRows.reduce((s, r) => s + Math.abs(amnt(r, BALANCE_KEYS)), 0);
    const cogs = cogsRows.reduce((s, r) => s + Math.abs(amnt(r, BALANCE_KEYS)), 0);
    if (revenue > 0 && cogs > 0) {
      const margin = (revenue - cogs) / revenue * 100;
      if (margin < 10) {
        findings.push(makeFinding(`pl_margin_${file.upload.id}`, "month_end", "high", "medium",
          `Gross margin critically low — ${Math.round(margin)}% (Revenue ${fc(revenue)}, COGS ${fc(cogs)})`,
          "Gross margin below 10% suggests pricing pressure, cost over-run or revenue recognition issues requiring management attention.",
          "Management review of pricing and cost structure", file,
          { accountCode: "Revenue / COGS", calculation: `Gross margin = (${fc(revenue)} - ${fc(cogs)}) / ${fc(revenue)} = ${Math.round(margin)}%.` }
        ));
      } else if (margin < 20) {
        findings.push(makeFinding(`pl_margin_med_${file.upload.id}`, "month_end", "medium", "medium",
          `Gross margin below 20% — ${Math.round(margin)}%`,
          "Gross margin below 20% warrants review of pricing, supplier costs and cost allocation.",
          "Review pricing and cost structure", file,
          { accountCode: "Revenue / COGS", calculation: `Gross margin = ${Math.round(margin)}%. Revenue ${fc(revenue)}, COGS ${fc(cogs)}.` }
        ));
      }
    }

    // PL-05: Exceptional one-off items
    const exceptionalRows = rows.filter((r) => /exceptional|extraordinary|one.?off|non.?recurring|write.?off|impairment|restructur/i.test(val(r, ACCOUNT_NAME_KEYS)) && Math.abs(amnt(r, BALANCE_KEYS)) > 10000);
    if (exceptionalRows.length > 0) {
      const total = exceptionalRows.reduce((s, r) => s + Math.abs(amnt(r, BALANCE_KEYS)), 0);
      const names = exceptionalRows.map((r) => val(r, ACCOUNT_NAME_KEYS)).slice(0, 3).join(", ");
      findings.push(makeFinding(`pl_exceptional_${file.upload.id}`, "month_end", "medium", "high",
        `Exceptional items — ${fc(total)} in one-off/non-recurring charges`,
        "Material exceptional items require separate disclosure in financial statements and board reporting.",
        "Ensure board disclosure and separate presentation in accounts", file,
        { accountCode: names, calculation: `${exceptionalRows.length} exceptional item row(s) totalling ${fc(total)}.` }
      ));
    }
  });

  return findings;
}

function buildBsFindings(files: ParsedFile[]): Finding[] {
  const findings: Finding[] = [];
  files.filter((f) => f.upload.fileType === "balance_sheet" && f.isParsed).forEach((file) => {
    const rows = file.rows;

    // BS-02: Negative equity
    const equityRows = rows.filter((r) => /total\s*equity|net\s*asset|shareholders?(\s*fund)?|capital\s*and\s*reserve|retained\s*earning|accumulated\s*(surplus|deficit)/i.test(val(r, ACCOUNT_NAME_KEYS)));
    const totalEquity = equityRows.reduce((s, r) => s + amnt(r, BALANCE_KEYS), 0);
    if (totalEquity < -1000) {
      findings.push(makeFinding(`bs_neg_equity_${file.upload.id}`, "cashflow", "critical", "high",
        `Negative equity — net assets are ${fc(Math.abs(totalEquity))} negative`,
        "The business has negative net assets, meaning total liabilities exceed total assets. This is a going concern indicator requiring urgent attention.",
        "Going concern assessment and director action required", file,
        { accountCode: "Equity / net assets", calculation: `Total equity = ${fc(totalEquity)} (negative).` }
      ));
    }

    // BS-01: Liquidity risk (current liabilities > current assets)
    const currentAssets = rows.filter((r) => /current\s*asset|debtor|cash\s*at\s*bank|bank\s*account|stock|inventory|prepayment|short.?term\s*asset/i.test(val(r, ACCOUNT_NAME_KEYS)));
    const currentLiabs = rows.filter((r) => /current\s*liabilit|creditor|accrual|overdraft|short.?term\s*liabilit|tax\s*liabilit|vat\s*liabilit|deferred\s*income/i.test(val(r, ACCOUNT_NAME_KEYS)));
    const caTotal = currentAssets.reduce((s, r) => s + Math.abs(amnt(r, BALANCE_KEYS)), 0);
    const clTotal = currentLiabs.reduce((s, r) => s + Math.abs(amnt(r, BALANCE_KEYS)), 0);
    if (caTotal > 0 && clTotal > 0 && caTotal < clTotal) {
      const ratio = caTotal / clTotal;
      findings.push(makeFinding(`bs_liquidity_${file.upload.id}`, "cashflow", ratio < 0.75 ? "critical" : "high", "medium",
        `Liquidity risk — current ratio ${ratio.toFixed(2)} (current assets ${fc(caTotal)} vs current liabilities ${fc(clTotal)})`,
        `Current liabilities (${fc(clTotal)}) exceed current assets (${fc(caTotal)}). A current ratio below 1.0 indicates the business may struggle to meet short-term obligations.`,
        "Cash flow plan and working capital review required", file,
        { accountCode: "Current assets vs Current liabilities", calculation: `Current ratio = ${fc(caTotal)} / ${fc(clTotal)} = ${ratio.toFixed(2)}.` }
      ));
    }
  });

  return findings;
}

// ─── Controls findings ────────────────────────────────────────────────────────

function buildControlsFindings(files: ParsedFile[]): Finding[] {
  const findings: Finding[] = [];

  files.filter((f) => f.isParsed).forEach((file) => {
    const rows = file.rows;

    // DQ-01: Future-dated transactions
    const today = new Date();
    const futureRows = rows.filter((r) => {
      const dt = parseDate(val(r, INVOICE_DATE_KEYS));
      return dt && dt > today;
    });
    if (futureRows.length > 0) {
      findings.push(makeFinding(`dq_future_${file.upload.id}`, "data_quality", "medium", "high",
        `${futureRows.length} future-dated transaction${futureRows.length > 1 ? "s" : ""} in ${file.upload.fileName}`,
        "Transactions dated in the future may indicate data entry errors or system date issues.",
        "Review and correct transaction dates", file,
        { accountCode: "Multiple", calculation: `${futureRows.length} row(s) with invoice/transaction date after today.` }
      ));
    }

    // DQ-02: Exact duplicate rows
    const rowKeys = rows.map((r) => JSON.stringify(Object.values(r).map((v) => String(v).trim()).sort()));
    const dupRows = rowKeys.filter((k, i) => rowKeys.indexOf(k) !== i);
    if (dupRows.length > 0) {
      findings.push(makeFinding(`dq_dup_rows_${file.upload.id}`, "data_quality", "medium", "high",
        `${dupRows.length} exact duplicate row${dupRows.length > 1 ? "s" : ""} found in ${file.upload.fileName}`,
        "Identical rows in a finance export indicate potential double-counting, import errors or system duplication.",
        "Remove duplicate rows and investigate root cause", file,
        { accountCode: "Entire file", calculation: `${dupRows.length} row(s) are exact duplicates of another row in the same file.` }
      ));
    }

    // DQ-05: Implausible amounts
    const implausible = rows.filter((r) => {
      const a = amnt(r, [...AP_AMOUNT_KEYS, ...AR_AMOUNT_KEYS]);
      return a > 10_000_000;
    });
    if (implausible.length > 0) {
      findings.push(makeFinding(`dq_implausible_${file.upload.id}`, "data_quality", "medium", "medium",
        `${implausible.length} transaction${implausible.length > 1 ? "s" : ""} with implausibly large amounts (>£10M) in ${file.upload.fileName}`,
        "Amounts over £10 million on a single transaction may indicate misplaced decimal points, currency symbol parsing errors or data corruption.",
        "Verify and correct implausible transaction amounts", file,
        { accountCode: "Multiple", calculation: `${implausible.length} row(s) with parsed amount > £10,000,000.` }
      ));
    }

    // DQ-04: Currency mismatch
    const foreignRows = rows.filter((r) => {
      const ccy = val(r, CURRENCY_KEYS).toUpperCase();
      return ccy && ccy !== "GBP" && ccy !== "£" && ccy.length === 3;
    });
    if (foreignRows.length > 0) {
      const currencies = [...new Set(foreignRows.map((r) => val(r, CURRENCY_KEYS).toUpperCase()))].join(", ");
      findings.push(makeFinding(`dq_currency_${file.upload.id}`, "data_quality", "medium", "high",
        `Foreign currency transactions detected — ${foreignRows.length} row${foreignRows.length > 1 ? "s" : ""} in ${currencies}`,
        "Non-GBP transactions require FX translation at the correct rate. Ensure all amounts are translated and FX gains/losses are recorded.",
        "Confirm FX translation and revaluation", file,
        { accountCode: currencies, calculation: `${foreignRows.length} row(s) with non-GBP currency codes: ${currencies}.` }
      ));
    }

    // CTL-01: Round number pattern (Benford's law proxy)
    const amountColKey = [...AP_AMOUNT_KEYS, ...AR_AMOUNT_KEYS].find((k) => rows.some((r) => r[k]));
    if (amountColKey && rows.length >= 20) {
      const roundCount = rows.filter((r) => { const a = amnt(r, [amountColKey]); return a > 0 && a % 1000 === 0; }).length;
      if (roundCount / rows.length > 0.25) {
        findings.push(makeFinding(`ctl_round_${file.upload.id}`, "controls", "low", "low",
          `High proportion of round-number amounts in ${file.upload.fileName} — ${Math.round(roundCount/rows.length*100)}%`,
          "When more than 25% of transaction amounts are exact multiples of £1,000, it may indicate estimated rather than actual figures, or manual data entry.",
          "Verify that transaction amounts are actual rather than estimated", file,
          { accountCode: "All transactions", calculation: `${roundCount} of ${rows.length} rows (${Math.round(roundCount/rows.length*100)}%) are exact £1,000 multiples.` }
        ));
      }
    }
  });

  return findings;
}

// ─── Targeted pattern findings ────────────────────────────────────────────────

function buildTargetedPatternFindings(files: ParsedFile[]): Finding[] {
  const findings: Finding[] = [];

  files.filter((f) => f.upload.fileType === "trial_balance" && f.isParsed).forEach((file) => {
    const roundSuspenseRows = file.rows.filter((row) => {
      const text = rowText(row);
      const amount = Math.abs(amnt(row, BALANCE_KEYS));
      return amount >= 10000 && amount % 1000 === 0 && /suspense|manual adjustment|round|director/i.test(text);
    });
    if (roundSuspenseRows.length) {
      const total = roundSuspenseRows.reduce((sum, row) => sum + Math.abs(amnt(row, BALANCE_KEYS)), 0);
      findings.push({
        ...makeFinding(
          `target_round_posting_${file.upload.id}`,
          "controls",
          "low",
          "medium",
          `${roundSuspenseRows.length} round-number suspense/manual posting indicators`,
          "Round-number manual or suspense postings should be checked to confirm they are actual amounts, not estimates.",
          `${fc(total)} round-number posting exposure`,
          file,
          { accountCode: roundSuspenseRows.slice(0, 4).map((row) => val(row, ACCOUNT_NAME_KEYS)).filter(Boolean).join(" / "), calculation: `${roundSuspenseRows.length} round-number suspense/manual row(s); total ${fc(total)}.` }
        ),
        ruleId: "CF_002",
        evidenceStrength: "indicator",
        confidenceScore: 75,
      });
    }
  });

  files.filter((f) => f.upload.fileType === "aged_creditors" && f.isParsed).forEach((file) => {
    const duplicateRows = file.rows.filter((row) => /duplicate/i.test(rowText(row)));
    if (duplicateRows.length) {
      const total = duplicateRows.reduce((sum, row) => sum + amnt(row, AP_AMOUNT_KEYS), 0);
      findings.push({
        ...makeFinding(
          `target_ap_duplicate_${file.upload.id}`,
          "ap",
          "medium",
          "high",
          `Duplicate supplier invoice indicator — ${duplicateRows[0]?.supplier_name || duplicateRows[0]?.supplier || "supplier"} appears duplicated`,
          "Supplier ledger contains a duplicate marker or repeated supplier/amount combination.",
          `${fc(total)} possible duplicate supplier payment exposure`,
          file,
          { accountCode: duplicateRows.map((row) => val(row, SUPPLIER_KEYS)).filter(Boolean).join(" / "), calculation: `${duplicateRows.length} AP row(s) flagged as duplicate; total ${fc(total)}.` }
        ),
        ruleId: "AP_001",
        evidenceStrength: "deterministic",
        confidenceScore: 95,
      });
    }

    const staleRows = file.rows.filter((row) => parseDayBucket(val(row, AR_DAYS_KEYS)) >= 180 && amnt(row, AP_AMOUNT_KEYS) > 0);
    if (staleRows.length) {
      const total = staleRows.reduce((sum, row) => sum + amnt(row, AP_AMOUNT_KEYS), 0);
      findings.push({
        ...makeFinding(
          `target_ap_180_${file.upload.id}`,
          "ap",
          "medium",
          "high",
          `${staleRows.length} supplier balance over 180 days — consider write-back`,
          "Aged creditor balances over 180 days require supplier statement review and possible write-back assessment.",
          `${fc(total)} stale creditor balance`,
          file,
          { accountCode: staleRows.map((row) => val(row, SUPPLIER_KEYS)).filter(Boolean).join(" / "), calculation: `${staleRows.length} AP row(s) aged 180+ days; total ${fc(total)}.` }
        ),
        ruleId: "AP_004",
        evidenceStrength: "deterministic",
        confidenceScore: 95,
      });
    }

    const personalRows = file.rows.filter((row) => /personal|^mr\.?\s|^mrs\.?\s|^ms\.?\s|^miss\.?\s/i.test(`${val(row, SUPPLIER_KEYS)} ${row.status ?? ""} ${row.notes ?? ""}`));
    if (personalRows.length) {
      const total = personalRows.reduce((sum, row) => sum + amnt(row, AP_AMOUNT_KEYS), 0);
      findings.push({
        ...makeFinding(
          `target_personal_payee_${file.upload.id}`,
          "controls",
          "medium",
          "high",
          `${personalRows.length} personal payee requires IR35/PAYE review`,
          "Supplier ledger includes an individual payee or personal supplier marker.",
          `${fc(total)} personal payee exposure`,
          file,
          { accountCode: personalRows.map((row) => val(row, SUPPLIER_KEYS)).filter(Boolean).join(" / "), calculation: `${personalRows.length} personal payee row(s); total ${fc(total)}.` }
        ),
        ruleId: "CF_009",
        evidenceStrength: "indicator",
        confidenceScore: 85,
      });
    }
  });

  files.filter((f) => f.upload.fileType === "vat_report" && f.isParsed).forEach((file) => {
    const constructionRows = file.rows.filter((row) => /construction|domestic reverse charge|buildright|steelframe/i.test(rowText(row)));
    if (constructionRows.length) {
      findings.push(vatPatternFinding(file, constructionRows, "VAT_009", "high", "Construction reverse charge transactions require review", "Construction services are flagged for domestic reverse charge treatment.", "Construction reverse charge exposure"));
    }

    const digitalRows = file.rows.filter((row) => /google|amazon web services|aws|azure|salesforce|adobe|digital service|saas|cloud/i.test(rowText(row)));
    if (digitalRows.length) {
      findings.push(vatPatternFinding(file, digitalRows, "VAT_010", "high", "Digital services reverse charge transactions require review", "Overseas digital services should be checked for reverse charge accounting.", "Digital services reverse charge exposure"));
    }

    const entertainmentRows = file.rows.filter((row) => /entertain|corporate golf|christmas staff party|business lunch/i.test(rowText(row)));
    if (entertainmentRows.length) {
      findings.push(vatPatternFinding(file, entertainmentRows, "VAT_004", "medium", "Blocked VAT on entertainment requires review", "Entertainment VAT is normally blocked or restricted and should be confirmed before filing.", "Blocked VAT exposure"));
    }

    const carRows = file.rows.filter((row) => /company car|private use|50%\s*blocked|bmw/i.test(rowText(row)));
    if (carRows.length) {
      findings.push(vatPatternFinding(file, carRows, "VAT_012", "medium", "Company car VAT restriction requires review", "Company car VAT recovery may be restricted where private use is available.", "Company car VAT restriction"));
    }

    const fuelRows = file.rows.filter((row) => /fuel scale|company cars|fuel/i.test(rowText(row)));
    if (fuelRows.length) {
      findings.push(vatPatternFinding(file, fuelRows, "VAT_005", "medium", "Fuel scale charge may be required", "Company car fuel VAT claims require fuel scale charge consideration.", "Fuel scale charge exposure"));
    }
  });

  files.filter((f) => f.upload.fileType === "profit_loss" && f.isParsed).forEach((file) => {
    const interest = Math.abs(file.rows.filter((row) => /interest|finance charge|loan interest|bank interest/i.test(rowText(row))).reduce((sum, row) => sum + amnt(row, BALANCE_KEYS), 0));
    const ebit = Math.abs(file.rows.filter((row) => /operating profit|ebit\b|profit before interest/i.test(rowText(row))).reduce((sum, row) => sum + amnt(row, BALANCE_KEYS), 0));
    if (interest > 0 && ebit > 0 && ebit / interest < 2) {
      findings.push({
        ...makeFinding(
          `target_interest_cover_${file.upload.id}`,
          "cashflow",
          "high",
          "high",
          `Interest cover at risk — ${(ebit / interest).toFixed(1)}x`,
          "Interest cover is below a typical 2.0x covenant threshold and should be reviewed before sign-off.",
          `${fc(interest)} finance cost covenant exposure`,
          file,
          { accountCode: "Interest cover", calculation: `EBIT ${fc(ebit)} / interest ${fc(interest)} = ${(ebit / interest).toFixed(1)}x.` }
        ),
        ruleId: "ST_028",
        evidenceStrength: "deterministic",
        confidenceScore: 90,
      });
    }
  });

  files.filter((f) => f.upload.fileType === "cashflow_forecast" && f.isParsed).forEach((file) => {
    const noteRows = file.rows.filter((row) => /negative cash|cash balance projected|action required/i.test(rowText(row)));
    if (noteRows.length) {
      findings.push({
        ...makeFinding(
          `target_cash_negative_note_${file.upload.id}`,
          "cashflow",
          "medium",
          "high",
          "Cashflow forecast flags a negative cash position",
          "Forecast notes indicate a projected negative cash position requiring action.",
          "Cashflow action required",
          file,
          { accountCode: "Cashflow Forecast", calculation: noteRows.map(rowText).join(" ") }
        ),
        ruleId: "CF_001",
        evidenceStrength: "deterministic",
        confidenceScore: 95,
      });
    }
  });

  return findings;
}

function vatPatternFinding(file: ParsedFile, rows: Record<string, string>[], ruleId: string, severity: Finding["severity"], title: string, description: string, impact: string): Finding {
  const total = rows.reduce((sum, row) => sum + amnt(row, NET_AMOUNT_KEYS), 0);
  return {
    ...makeFinding(
      `target_${ruleId.toLowerCase()}_${file.upload.id}`,
      "vat",
      severity,
      "high",
      title,
      description,
      `${fc(total)} ${impact.toLowerCase()}`,
      file,
      { accountCode: rows.slice(0, 4).map((row) => val(row, DESC_KEYS) || val(row, SUPPLIER_KEYS)).filter(Boolean).join(" / "), calculation: `${rows.length} VAT row(s) matched; net total ${fc(total)}.` }
    ),
    ruleId,
    evidenceStrength: "indicator",
    confidenceScore: 85,
  };
}

// ─── Support-sheet findings ───────────────────────────────────────────────────

function buildSupportSheetFindings(files: ParsedFile[]): Finding[] {
  const findings: Finding[] = [];

  files.filter((f) => f.upload.fileType === "payroll_summary" && f.isParsed).forEach((file) => {
    const unposted = file.rows.filter((row) => /not\s*posted|no|missing/i.test(row.tb_posted ?? row.status ?? row.notes ?? ""));
    if (unposted.length) {
      const total = unposted.reduce((sum, row) => sum + amnt(row, ["total_cost", "gross_pay", "amount"]), 0);
      const departments = unposted.map((row) => row.department || row.description || "Payroll").join(", ");
      findings.push({
        ...makeFinding(
          `support_payroll_not_posted_${file.upload.id}`,
          "month_end",
          "high",
          "high",
          `${departments} payroll not posted to the TB`,
          "Payroll summary indicates one or more payroll departments have not been posted to the trial balance.",
          `${fc(total)} payroll posting exposure`,
          file,
          { accountCode: departments, calculation: `${unposted.length} payroll row(s) marked not posted; total cost ${fc(total)}.` }
        ),
        ruleId: "CR_008",
        evidenceStrength: "deterministic",
        confidenceScore: 95,
      });
    }
  });

  files.filter((f) => f.upload.fileType === "fixed_asset_register" && f.isParsed).forEach((file) => {
    const zeroDepnRows = file.rows.filter((row) => amnt(row, ["cost", "cost_"]) > 10000 && amnt(row, ["annual_depn", "annual_depn_", "annual_depreciation"]) === 0);
    if (zeroDepnRows.length) {
      const total = zeroDepnRows.reduce((sum, row) => sum + amnt(row, ["cost", "cost_"]), 0);
      const assets = zeroDepnRows.slice(0, 3).map((row) => row.asset_description || row.description || row.asset_code || "Asset").join(" / ");
      findings.push({
        ...makeFinding(
          `support_zero_depreciation_${file.upload.id}`,
          "month_end",
          "high",
          "high",
          `${zeroDepnRows.length} fixed assets have zero depreciation charge`,
          "Fixed asset register shows material assets with no annual depreciation charge.",
          `${fc(total)} asset value requires depreciation review`,
          file,
          { accountCode: assets, calculation: `${zeroDepnRows.length} asset(s) over £10k have annual depreciation of £0; cost total ${fc(total)}.` }
        ),
        ruleId: "FS_005",
        evidenceStrength: "deterministic",
        confidenceScore: 95,
      });
    }
  });

  files.filter((f) => f.upload.fileType === "cashflow_forecast" && f.isParsed).forEach((file) => {
    const negativeRows = file.rows.filter((row) => amnt(row, ["closing_cash", "closing_cash_", "cash", "amount"]) < 0);
    if (negativeRows.length) {
      const worst = negativeRows.reduce((min, row) => Math.min(min, amnt(row, ["closing_cash", "closing_cash_", "cash", "amount"])), 0);
      const periods = negativeRows.map((row) => row.week || row.period || "Forecast period").join(", ");
      findings.push({
        ...makeFinding(
          `support_negative_cash_${file.upload.id}`,
          "cashflow",
          "medium",
          "high",
          `Cashflow forecast turns negative in ${periods}`,
          "13-week cashflow forecast shows one or more periods with negative closing cash.",
          `${fc(worst)} forecast cash shortfall`,
          file,
          { accountCode: periods, calculation: `${negativeRows.length} forecast row(s) have negative closing cash; worst position ${fc(worst)}.` }
        ),
        ruleId: "CF_001",
        evidenceStrength: "deterministic",
        confidenceScore: 95,
      });
    }
  });

  return findings;
}

// ─── Data quality findings ─────────────────────────────────────────────────────

function buildDataQualityFindings(files: ParsedFile[]): Finding[] {
  const findings: Finding[] = [];

  files.filter((f) => f.isParsed && CORE_RULE_FILE_TYPES.includes(f.upload.fileType)).forEach((file) => {
    const rows = file.rows;
    const ft = file.upload.fileType;

    // DQ-03: Missing critical identifier fields
    const primaryKeys: Partial<Record<Upload["fileType"], string[]>> = {
      aged_debtors: CUSTOMER_KEYS, aged_creditors: SUPPLIER_KEYS,
      vat_report: VAT_CODE_KEYS, trial_balance: ACCOUNT_NAME_KEYS,
      profit_loss: ACCOUNT_NAME_KEYS, balance_sheet: ACCOUNT_NAME_KEYS
    };
    const primaryKey = primaryKeys[ft];
    if (primaryKey) {
      const missingPrimary = rows.filter((r) => !val(r, primaryKey));
      if (missingPrimary.length / rows.length > 0.05) {
        findings.push(makeFinding(`dq_missing_id_${file.upload.id}`, "data_quality", missingPrimary.length / rows.length > 0.15 ? "high" : "medium", "high",
          `${missingPrimary.length} rows (${Math.round(missingPrimary.length/rows.length*100)}%) in ${file.upload.fileName} missing the primary identifier`,
          "Missing key identifiers (account name, customer name, supplier name) prevent proper analysis and reduce audit trail quality.",
          "Enrich data with missing identifiers before final review", file,
          { accountCode: "Entire file", calculation: `${missingPrimary.length} of ${rows.length} rows missing primary identifier field.` }
        ));
      }
    }
  });

  return findings;
}

// ─── Cross-file findings ───────────────────────────────────────────────────────

function buildCrossFileFindings(files: ParsedFile[]): Finding[] {
  const findings: Finding[] = [];
  const arFile = files.find((f) => f.upload.fileType === "aged_debtors" && f.isParsed);
  const apFile = files.find((f) => f.upload.fileType === "aged_creditors" && f.isParsed);
  const tbFile = files.find((f) => f.upload.fileType === "trial_balance" && f.isParsed);
  const vatFile = files.find((f) => f.upload.fileType === "vat_report" && f.isParsed);

  // CROSS-01: VAT report vs TB VAT control account
  if (vatFile && tbFile) {
    const vatTotal = vatFile.rows.reduce((s, r) => s + amnt(r, VAT_AMOUNT_KEYS), 0);
    const vatControlRow = tbFile.rows.find((r) => /vat\s*control|vat\s*liabilit|vat\s*output|vat\s*input|tax\s*control/i.test(val(r, ACCOUNT_NAME_KEYS)));
    if (vatControlRow) {
      const ctrl = Math.abs(amnt(vatControlRow, BALANCE_KEYS));
      const diff = Math.abs(vatTotal - ctrl);
      if (diff > 5) {
        findings.push(makeFinding(`cross_vat_ctrl_${vatFile.upload.id}`, "vat", "high", "medium",
          `VAT report vs TB control mismatch — ${fc(diff)} discrepancy`,
          `VAT report total ${fc(vatTotal)} does not reconcile to TB VAT control account balance ${fc(ctrl)}. Difference of ${fc(diff)} requires investigation before VAT return submission.`,
          "Reconcile VAT report to control account before submission", vatFile,
          {
            accountCode: val(vatControlRow, ACCOUNT_NAME_KEYS),
            calculation: `VAT report total ${fc(vatTotal)} vs TB control ${fc(ctrl)} = difference ${fc(diff)}.`,
            rows: [
              ...evidenceRowsForFile(vatFile, vatFile.rows, "VAT report total", VAT_AMOUNT_KEYS, { side: "subledger", total: vatTotal }),
              ...evidenceRowsForFile(tbFile, [vatControlRow], "TB VAT control", BALANCE_KEYS, { side: "control", total: ctrl }),
            ],
          }
        ));
      }
    }
  }

  // CF-01: High days sales outstanding (DSO)
  if (arFile) {
    const arTotal = arFile.rows.reduce((s, r) => s + amnt(r, AR_AMOUNT_KEYS), 0);
    const plFile = files.find((f) => f.upload.fileType === "profit_loss" && f.isParsed);
    if (plFile && arTotal > 0) {
      const revenueRows = plFile.rows.filter((r) => /revenue|turnover|sales/i.test(val(r, ACCOUNT_NAME_KEYS)));
      const revenue = revenueRows.reduce((s, r) => s + Math.abs(amnt(r, BALANCE_KEYS)), 0);
      if (revenue > 0) {
        const dso = (arTotal / revenue) * 365;
        if (dso > 60) {
          findings.push(makeFinding(`cf_dso_${arFile.upload.id}`, "cashflow", dso > 120 ? "critical" : dso > 90 ? "high" : "medium", "medium",
          `High debtor days — DSO of ${Math.round(dso)} days (AR ${fc(arTotal)}, Revenue ${fc(revenue)})`,
          `Days Sales Outstanding of ${Math.round(dso)} days exceeds the 60-day target. High DSO creates working capital pressure and increases bad debt risk.`,
          "Collections improvement required to reduce DSO", arFile,
            {
              accountCode: "AR vs Revenue",
              calculation: `DSO = (${fc(arTotal)} / ${fc(revenue)}) × 365 = ${Math.round(dso)} days.`,
              rows: [
                ...evidenceRowsForFile(arFile, arFile.rows, "AR total", AR_AMOUNT_KEYS, { side: "ar", total: arTotal }),
                ...evidenceRowsForFile(plFile, revenueRows, "Revenue total", BALANCE_KEYS, { side: "revenue", total: revenue }),
              ],
            }
          ));
        }
      }
    }
  }

  // CF-03: Large uncleared AP items creating cashflow risk
  if (apFile) {
    const oldAP = apFile.rows.filter((r) => parseDayBucket(val(r, AR_DAYS_KEYS)) >= 60 && amnt(r, AP_AMOUNT_KEYS) > 0);
    const oldTotal = oldAP.reduce((s, r) => s + amnt(r, AP_AMOUNT_KEYS), 0);
    if (oldTotal > 50000) {
      findings.push(makeFinding(`cf_old_ap_${apFile.upload.id}`, "cashflow", "high", "medium",
        `${fc(oldTotal)} in AP items over 60 days — cash flow risk`,
        "Large overdue creditor balances may create cash flow pressure if suppliers demand settlement or withhold credit.",
        "Prioritise AP clearance to protect supplier relationships", apFile,
        {
          accountCode: "Aged creditors > 60 days",
          calculation: `${oldAP.length} AP rows aged 60+ days totalling ${fc(oldTotal)}.`,
          rows: evidenceRowsForFile(apFile, oldAP, "AP aged 60+ total", AP_AMOUNT_KEYS, { side: "ap", total: oldTotal, age_threshold_days: 60 }),
        }
      ));
    }
  }

  void tbFile;
  return findings;
}

// ─── Recommendations ──────────────────────────────────────────────────────────

function buildRecommendations(findings: Finding[]): Recommendation[] {
  return findings.map((f) => ({
    id: `rec_${f.id}`,
    tenantId: f.tenantId,
    companyId: f.companyId,
    findingId: f.id,
    action: recommendationFor(f),
    expectedImpact: f.expectedImpact,
    priority: f.severity === "critical" || f.severity === "high" ? "high" : "medium",
    completed: false
  }));
}

function recommendationFor(f: Finding): string {
  if (f.id.includes("ar_overdue"))     return "Prioritise collection calls for overdue debtors — escalate 120+ day balances to senior management.";
  if (f.id.includes("ar_conc"))        return "Reduce debtor concentration risk — review credit terms and consider credit insurance for high-value customers.";
  if (f.id.includes("ar_climit"))      return "Place account on hold and review credit limit — seek management approval before further sales on credit.";
  if (f.id.includes("ar_negative"))    return "Review negative AR balances — issue refund or offset against future invoices.";
  if (f.id.includes("ar_stale"))       return "Review stale invoices for collectability — provide against irrecoverable balances and consider write-off.";
  if (f.id.includes("ar_contra"))      return "Review contra netting opportunity — agree offset with parties that appear in both AR and AP ledgers.";
  if (f.id.includes("ar_dispute"))     return "Formally resolve disputed invoices — obtain written resolution or escalate to legal if unresolved.";
  if (f.id.includes("dup_pay"))        return "Investigate duplicate invoice reference — hold second payment pending supplier confirmation and credit note.";
  if (f.id.includes("dup_vendor"))     return "Consolidate duplicate vendor master entries and block duplicates before next payment run.";
  if (f.id.includes("ap_old"))         return "Reconcile old uncleared creditor items with suppliers — clear or write back stale items.";
  if (f.id.includes("ap_neg"))         return "Recover overpaid creditor balances — contact suppliers for refund or apply to next invoice.";
  if (f.id.includes("ap_split"))       return "Escalate split invoices for management review — verify business purpose and obtain combined approval.";
  if (f.id.includes("ap_new_vendor"))  return "Perform vendor due diligence — verify bank details, company registration and obtain management approval.";
  if (f.id.includes("ap_personal"))    return "Review payments to individuals — confirm IR35/PAYE status and obtain management approval.";
  if (f.id.includes("me_ap_accrual"))  return "Post accrual entries for recurring suppliers with zero or missing invoice amounts before close.";
  if (f.id.includes("me_tb_accrual"))  return "Review recurring expense accounts and post accruals where invoices have not been received.";
  if (f.id.includes("vat_missing"))    return "Review blank VAT/tax code transactions and attach correct treatment before VAT return submission.";
  if (f.id.includes("vat_coding"))     return "Correct VAT coding on standard-rate categories coded as exempt — recalculate input VAT entitlement.";
  if (f.id.includes("vat_reverse"))    return "Apply reverse charge VAT accounting to overseas supplier transactions before return submission.";
  if (f.id.includes("vat_blocked"))    return "Remove input VAT on blocked entertainment items from the VAT return to avoid penalties.";
  if (f.id.includes("vat_rounding"))   return "Reconcile VAT amounts to net amounts and rates — correct rounding or mis-coded transactions.";
  if (f.id.includes("vat_entertain"))  return "Review entertainment VAT claims — remove client entertainment input tax before submission.";
  if (f.id.includes("vat_fuel_scale")) return "Post fuel scale charge for the period to account for private use of company fuel.";
  if (f.ruleId === "REC_001")          return "Reconcile aged debtors to the TB debtors control account and document the difference before manager sign-off.";
  if (f.ruleId === "REC_002")          return "Reconcile aged creditors to the TB creditors control account and document supplier statement differences.";
  if (f.ruleId === "REC_003")          return "Reconcile VAT report totals to the TB VAT control account before treating the VAT return as ready.";
  if (f.ruleId === "REC_004")          return "Block sign-off until the balance sheet equation is corrected or the complete balance sheet is re-exported.";
  if (f.ruleId === "REC_005")          return "Complete the bank reconciliation and clear or evidence all reconciling differences before sign-off.";
  if (f.ruleId === "REC_006")          return "Reconcile current-period profit/loss to retained earnings movement and document dividends or adjustments.";
  if (f.id.includes("cross_vat"))      return "Reconcile VAT report to TB control account — investigate and resolve difference before return submission.";
  if (f.id.includes("tb_suspense"))    return "Allocate all suspense/clearing account balances to correct nominal codes before sign-off.";
  if (f.id.includes("tb_depn"))        return "Post depreciation charge for the period — confirm rates and calculations with the fixed asset register.";
  if (f.id.includes("tb_neg_asset"))   return "Review negative asset account balances — correct postings or reassess depreciation calculations.";
  if (f.id.includes("tb_interco"))     return "Confirm intercompany balance with the counterpart entity and ensure reciprocal agreement.";
  if (f.id.includes("tb_dla"))         return "Review director loan account — confirm tax treatment, interest requirements and disclosure.";
  if (f.id.includes("tb_goodwill"))    return "Post amortisation charge or perform impairment test on goodwill/intangible assets.";
  if (f.id.includes("bs_neg_equity"))  return "Prepare going concern assessment — directors must confirm viability before accounts are signed.";
  if (f.id.includes("bs_liquidity"))   return "Prepare cash flow forecast for next 12 months — identify working capital requirements and funding options.";
  if (f.id.includes("pl_payroll"))     return "Confirm payroll has been posted and included in the P&L — check payroll journal entries.";
  if (f.id.includes("pl_margin"))      return "Review pricing strategy and cost structure — investigate root cause of gross margin deterioration.";
  if (f.id.includes("pl_exceptional")) return "Ensure exceptional items are separately disclosed in financial statements and board reporting.";
  if (f.id.includes("ctl_suspense"))   return "Allocate suspense balances to correct accounts and implement controls to prevent recurrence.";
  if (f.id.includes("ctl_late_jnl"))  return "Review and authorise all late journal entries — ensure post-period adjustments are properly approved.";
  if (f.id.includes("ctl_weekend"))    return "Investigate weekend postings above £1,000 — confirm authorisation and business purpose.";
  if (f.id.includes("ctl_no_desc"))    return "Add narrations to all undescribed journal entries to maintain audit trail quality.";
  if (f.id.includes("ctl_round"))      return "Verify that round-number transaction amounts represent actual invoiced amounts rather than estimates.";
  if (f.id.includes("ctl_ap_split"))   return "Escalate split payment pattern for management and board-level review.";
  if (f.id.includes("dq_future"))      return "Correct future-dated transactions — verify correct system date settings and transaction entry.";
  if (f.id.includes("dq_dup_rows"))    return "Remove duplicate rows from the source system export and investigate cause of duplication.";
  if (f.id.includes("dq_missing_id"))  return "Enrich data with missing identifiers — update source system records before re-export.";
  if (f.id.includes("dq_currency"))    return "Translate foreign currency transactions at the correct rate and post FX gains/losses.";
  if (f.id.includes("dq_implausible")) return "Verify implausible transaction amounts — check for decimal point or currency symbol parsing errors.";
  if (f.id.includes("cf_dso"))         return "Implement collections improvement programme — target DSO reduction to below 60 days.";
  if (f.id.includes("cf_old_ap"))      return "Prepare AP payment schedule — clear overdue creditors to protect supplier relationships and credit terms.";
  return "Assign reviewer and resolve the evidence-linked finding before sign-off.";
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeFinding(id: string, category: Finding["category"], severity: Finding["severity"], confidence: Finding["confidence"], title: string, description: string, expectedImpact: string, file: ParsedFile, evidence: { accountCode: string; calculation: string; rows?: FindingEvidenceRow[] }): Finding {
  return {
    id,
    tenantId: file.upload.tenantId,
    companyId: file.upload.companyId,
    severity,
    category,
    title,
    description,
    expectedImpact,
    status: "open",
    confidence,
    evidence: {
      sourceFile: file.upload.fileName,
      period: file.upload.uploadedAt,
      rows: evidence.rows ?? inferEvidenceRows(file, evidence.accountCode, expectedImpact),
      ...evidence
    }
  };
}

function evidenceRowsForFile(
  file: ParsedFile,
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
    amount: Math.abs(amnt(row, amountKeys)) || undefined,
    sourceRow: stripMeta(row),
    calculationInput: {
      label,
      ...calculationInput,
    },
  }));
}

function inferEvidenceRows(file: ParsedFile, accountCode: string, expectedImpact: string): FindingEvidenceRow[] {
  const terms = accountCode
    .split(/[\/,;|]+/)
    .map((term) => term.trim().toLowerCase())
    .filter((term) => term.length >= 3 && !/^multiple|n\/a|unknown$/i.test(term));

  const candidates = terms.length
    ? file.rows.filter((row) => {
        const text = rowText(stripMeta(row)).toLowerCase();
        return terms.some((term) => text.includes(term));
      })
    : file.rows;

  const rows = candidates.slice(0, 10);
  return rows.map((row) => ({
    sourceFile: file.upload.fileName,
    sheetName: metaString(row.__sourceSheetName),
    rowIndex: metaNumber(row.__sourceRowIndex),
    accountCode,
    period: file.upload.uploadedAt,
    amount: firstAmount(row),
    sourceRow: stripMeta(row),
    calculationInput: {
      expectedImpact,
    },
  }));
}

function val(row: Record<string, string>, keys: string[]): string {
  for (const k of keys) { if (row[k]) return row[k].trim(); } return "";
}

function amnt(row: Record<string, string>, keys: string[]): number {
  const raw = val(row, keys); if (!raw) return 0;
  const cleaned = raw.replace(/[£$,\s]/g, "").replace(/^\((.*)\)$/, "-$1");
  const parsed = Number(cleaned); return Number.isFinite(parsed) ? parsed : 0;
}

function sumCol(rows: Record<string, string>[], keys: string[]): number {
  return rows.reduce((s, r) => s + amnt(r, keys), 0);
}

type BalanceComparison = { label: string; tb: number; bs: number; diff: number };

function rowText(row: Record<string, string>): string {
  return Object.values(row).join(" ");
}

function stripMeta(row: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(row).filter(([key]) => !key.startsWith("__")));
}

function metaString(value: string | undefined) {
  return value?.trim() || undefined;
}

function metaNumber(value: string | undefined) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function firstAmount(row: Record<string, string>) {
  const amount = amnt(row, [...BALANCE_KEYS, ...AR_AMOUNT_KEYS, ...AP_AMOUNT_KEYS, ...VAT_AMOUNT_KEYS, ...NET_AMOUNT_KEYS]);
  return amount || undefined;
}

function sumMatchingRows(rows: Record<string, string>[], include: RegExp[], exclude: RegExp[] = []): number {
  return rows
    .filter((row) => {
      const text = rowText(row);
      return include.some((pattern) => pattern.test(text)) && !exclude.some((pattern) => pattern.test(text));
    })
    .reduce((sum, row) => sum + signedAmount(row), 0);
}

function signedAmount(row: Record<string, string>): number {
  const debit = amnt(row, DEBIT_KEYS);
  const credit = amnt(row, CREDIT_KEYS);
  if (debit || credit) return debit - credit;
  return amnt(row, BALANCE_KEYS);
}

function balanceSheetEquation(rows: Record<string, string>[]) {
  const totalAssets = totalLine(rows, [/^total assets?$/i]);
  const totalLiabilities = totalLine(rows, [/^total liabilities?$/i]);
  const totalEquity = totalLine(rows, [/^total equity$/i, /^total shareholders'? funds?$/i, /^total capital and reserves?$/i]);

  if (totalAssets !== null && totalLiabilities !== null && totalEquity !== null) {
    return { assets: totalAssets, liabilities: totalLiabilities, equity: totalEquity, diff: Math.abs(totalAssets - totalLiabilities - totalEquity) };
  }

  const fallbackTotal = Math.abs(sumCol(rows, BALANCE_KEYS));
  return { assets: fallbackTotal, liabilities: 0, equity: 0, diff: fallbackTotal };
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
  return row ? Math.abs(amnt(row, BALANCE_KEYS)) : null;
}

function compareNamedBalance(label: string, tbRows: Record<string, string>[], bsRows: Record<string, string>[], include: RegExp[], exclude: RegExp[] = []): BalanceComparison | null {
  const tb = Math.abs(sumMatchingRows(tbRows, include, exclude));
  const bs = Math.abs(sumMatchingRows(bsRows, include, exclude));
  if (tb === 0 && bs === 0) return null;
  return { label, tb, bs, diff: Math.abs(tb - bs) };
}

function isProfitLossRow(row: Record<string, string>): boolean {
  const text = rowText(row);
  const code = val(row, ACCOUNT_CODE_KEYS);
  if (/^[4-9]\d{2,}/.test(code)) return true;
  return /revenue|turnover|sales|income|cost of sales|cogs|direct cost|payroll|wages|salary|rent|utilities|marketing|depreciation|amortis|professional fee|operating|expense|finance cost|interest/i.test(text);
}

function isSubtotalRow(row: Record<string, string>): boolean {
  return /gross profit|operating profit|ebit|ebitda|net profit|profit before tax|profit after tax|total revenue|total cost|total expense/i.test(rowText(row));
}

function profitLossMovement(rows: Record<string, string>[]): number {
  return rows.reduce((sum, row) => {
    const debit = amnt(row, DEBIT_KEYS);
    const credit = amnt(row, CREDIT_KEYS);
    if (debit || credit) return sum + credit - debit;
    return sum + amnt(row, BALANCE_KEYS);
  }, 0);
}

function reconciliationTolerance(value: number): number {
  return Math.max(100, Math.abs(value) * 0.005);
}

function fc(v: number): string { return `£${Math.round(Math.abs(v)).toLocaleString()}`; }
function signedFc(v: number): string { return `${v < 0 ? "-" : ""}${fc(v)}`; }

function normaliseName(name: string): string {
  return name.toLowerCase().replace(/\s+(ltd|llp|plc|inc|limited|co|group|services|solutions|consulting|associates)\.?$/i, "").replace(/[^a-z0-9]/g, "").trim();
}

function parseDayBucket(raw: string): number {
  if (!raw) return 0;
  if (raw.includes("120")) return 120;
  if (raw.includes("90")) return 90;
  if (raw.includes("60")) return 60;
  const n = Number(raw.replace(/[^0-9.]/g, "")); return Number.isFinite(n) ? n : 0;
}

function parseDate(raw: string): Date | null {
  if (!raw) return null;
  const cleaned = raw.trim().replace(/[\/\-\.]/g, "-");
  const parts = cleaned.split("-");
  if (parts.length !== 3) return null;
  const [a, b, c] = parts.map(Number);
  if (c > 2000) { const d = new Date(c, b - 1, a); return isNaN(d.getTime()) ? null : d; }
  if (a > 2000) { const d = new Date(a, b - 1, c); return isNaN(d.getTime()) ? null : d; }
  return null;
}

function inferPeriodEnd(rows: Record<string, string>[]): Date | null {
  const dates = rows.map((r) => parseDate(val(r, INVOICE_DATE_KEYS))).filter(Boolean) as Date[];
  if (dates.length === 0) return null;
  const max = dates.reduce((a, b) => a > b ? a : b);
  return new Date(max.getFullYear(), max.getMonth() + 1, 0); // Last day of max month
}
