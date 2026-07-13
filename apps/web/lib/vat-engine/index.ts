import type { ParsedFile } from "../upload-analysis";
import { classifyVatTransaction } from "./classification";
import { computeVatReturnWithContributions, emptyVatReturn } from "./computation";
import { calculateVatScoreBreakdown, vatReviewStatus } from "./health-score";
import { reconcileVatReturn } from "./reconciliation";
import type { VatAssuranceCheck, VatAssuranceProfile, VatBoxContribution, VatExceptionDashboard, VatFilingSignOff, VatFinding, VatReturn, VatTransaction, VatReviewResult } from "./types";
import { fc, money, rowText, text } from "./utils";
import { vatRule } from "./rule-catalog";
import { normaliseCountry } from "./country";
import { runVatAssurance } from "./assurance";

const boxKeys = ["box", "box_number", "vat_box"];
const amountKeys = ["amount", "amount_gbp", "net_amount", "value"];
const netKeys = ["net_amount", "net", "amount", "value", "gross_ex_vat", "amount_company_code_currency"];
const vatKeys = ["vat_amount", "tax_amount", "vat", "tax"];
const grossKeys = ["gross", "gross_amount", "amount_inc_vat", "gross_amount_gbp", "gross_value"];
const vatCodeKeys = ["vat_code", "tax_code", "vat_rate", "tax_rate", "vat_treatment"];
const typeKeys = ["type", "transaction_type", "source_type"];
const partyKeys = ["supplier", "supplier_name", "customer", "customer_name", "customer_supplier", "supplier_customer", "contact", "party", "account_name"];
const supplierIdentityKeys = ["supplier", "supplier_name", "vendor", "vendor_name", "creditor", "creditor_name"];
const customerIdentityKeys = ["customer", "customer_name", "debtor", "debtor_name"];
const descKeys = ["description", "details", "notes", "narration", "account_name"];
const dateKeys = ["date", "transaction_date", "posting_date", "document_date"];
const taxPointKeys = ["tax_point", "tax_point_date", "invoice_date", "document_date"];
const paidDateKeys = ["paid_date", "payment_date", "settled_date", "cleared_date"];
const referenceKeys = ["reference", "invoice_number", "invoice_no", "document_number", "transaction_id", "source_id"];
const statusKeys = ["status", "payment_status", "paid_status"];
const nominalKeys = ["nominal_code", "account_code", "g_l_account", "gl_account"];
const countryKeys = ["country", "customer_country", "supplier_country", "ship_to_country", "bill_to_country"];
const supplyTypeKeys = ["supply_type", "goods_services", "goods_or_services", "item_type"];
const balanceKeys = ["balance", "closing_balance", "net_balance", "net_movement", "movement", "amount", "value"];
const debitKeys = ["debit", "debits", "dr", "debit_amount"];
const creditKeys = ["credit", "credits", "cr", "credit_amount"];

export function runVatEngine(files: ParsedFile[]): VatReviewResult {
  const vatFiles = files.filter((file) => file.upload.fileType === "vat_report" && file.isParsed);
  if (!vatFiles.length) {
    return { vatReturn: emptyVatReturn, findings: [], healthScore: 0, readinessScore: 0, scoreBreakdown: undefined, status: "VAT Data Required", reconciliationResults: [], boxContributions: [], blockedVatRisk: 0, highRiskCount: 0, exceptionsCount: 0, reconciliationStatus: "REVIEW", transactionsAnalysed: 0, source: "empty" };
  }

  const identifiedCurrentFiles = vatFiles.filter((file) => !isPriorPeriodVatFile(file));
  const currentVatFiles = identifiedCurrentFiles.length ? identifiedCurrentFiles : vatFiles;
  const priorVatFiles = identifiedCurrentFiles.length ? vatFiles.filter(isPriorPeriodVatFile) : [];
  const explicitReturn = extractExplicitVatReturn(currentVatFiles);
  const transactions = currentVatFiles.flatMap(normaliseVatTransactions);
  const computed = computeVatReturnWithContributions(transactions);
  const vatReturn = explicitReturn ?? computed.vatReturn;
  if (transactions.length === 0 && (!explicitReturn || isEmptyVatReturn(explicitReturn))) {
    return { vatReturn: emptyVatReturn, findings: [], healthScore: 0, readinessScore: 0, scoreBreakdown: undefined, status: "VAT Data Required", reconciliationResults: [], boxContributions: [], reviewActions: [], blockedVatRisk: 0, highRiskCount: 0, exceptionsCount: 0, reconciliationStatus: "REVIEW", transactionsAnalysed: 0, source: "empty" };
  }
  const priorTransactions = priorVatFiles.flatMap(normaliseVatTransactions);
  const priorComputed = computeVatReturnWithContributions(priorTransactions).vatReturn;
  const explicitPriorReturn = extractExplicitVatReturn(priorVatFiles);
  const previousVatReturn = explicitPriorReturn ?? (priorTransactions.length && !isEmptyVatReturn(priorComputed) ? priorComputed : undefined);
  const vatControl = extractVatControl(files);
  const hmrcPayment = extractHmrcPayment(vatFiles);
  const reconciliationResults = reconcileVatReturn(vatReturn, vatControl, computed.boxContributions, transactions, hmrcPayment);
  const profile = inferVatAssuranceProfile(files, transactions, vatReturn);
  const findings = buildVatEngineFindings(vatReturn, transactions, reconciliationResults, profile);
  const assurance = runVatAssurance({
    vatReturn,
    transactions,
    contributions: computed.boxContributions,
    vatControlBalance: vatControl,
    hasExplicitReturn: Boolean(explicitReturn),
    evidenceReviewed: buildEvidenceReviewed(files, transactions),
    previousVatReturn,
    profile,
  });
  const score = calculateVatScoreBreakdown(findings, reconciliationResults, transactions);
  const healthScore = score.overall;
  const blockedVatRisk = findings.filter((finding) => finding.layer === 4).reduce((sum, finding) => sum + (finding.exposure ?? 0), 0);
  const assuranceExceptions = assurance.checks.filter((check) => check.status === "failed" || check.status === "review");
  const highRiskCount = findings.filter((finding) => finding.severity === "critical" || finding.severity === "high").length + assuranceExceptions.filter((check) => check.severity === "critical" || check.severity === "high").length;
  const reconciliationStatus = reconciliationResults.some((item) => item.status === "failed") ? "FAIL" : reconciliationResults.some((item) => item.status === "warning") ? "REVIEW" : "PASS";
  const hasHighAssuranceFailure = assurance.checks.some((check) => check.status === "failed" && (check.severity === "critical" || check.severity === "high"));
  const exceptionDashboard = buildVatExceptionDashboard(findings, assurance.checks, reconciliationResults);
  const filingSignOff = buildVatFilingSignOff(healthScore, assurance.readinessScore, findings, assurance.checks, reconciliationResults);

  return {
    vatReturn,
    assuranceProfile: profile,
    findings,
    healthScore,
    readinessScore: assurance.readinessScore,
    readinessDrivers: assurance.readinessDrivers,
    assuranceChecks: assurance.checks,
    workpaper: assurance.workpaper,
    periodComparison: assurance.periodComparison,
    exceptionDashboard,
    filingSignOff,
    scoreBreakdown: score,
    status: hasHighAssuranceFailure || assurance.readinessScore < 85 ? "Review Required Before Submission" : vatReviewStatus(healthScore, reconciliationResults),
    reconciliationResults,
    boxContributions: computed.boxContributions,
    reviewActions: buildVatReviewActions(findings, reconciliationResults, vatReturn),
    blockedVatRisk,
    highRiskCount,
    exceptionsCount: findings.length + assuranceExceptions.length,
    reconciliationStatus,
    transactionsAnalysed: transactions.length,
    source: explicitReturn ? "explicit_return" : "computed_transactions",
  };
}

function isPriorPeriodVatFile(file: ParsedFile) {
  const name = `${file.upload.fileName} ${file.upload.originalFileName ?? ""}`;
  if (/prior|previous|comparative|comparison/i.test(name)) return true;
  const roles = file.rows.map((row) => text(row, ["period_role", "comparison_period", "period_type"])).filter(Boolean);
  return roles.length > 0 && roles.every((role) => /prior|previous|comparative/i.test(role));
}

function buildVatExceptionDashboard(findings: VatFinding[], checks: VatAssuranceCheck[], reconciliations: ReturnType<typeof reconcileVatReturn>): VatExceptionDashboard {
  const exceptionChecks = checks.filter((check) => check.status === "failed" || check.status === "review");
  const severityItems = [
    ...findings.map((finding) => finding.severity),
    ...exceptionChecks.map((check) => check.severity),
    ...reconciliations.filter((item) => item.status === "failed").map(() => "high" as const),
  ];
  const categoryCount = (category: VatAssuranceCheck["category"]) => exceptionChecks.filter((check) => check.category === category).length;
  const codingAndRates = findings.filter((finding) => /VAT100|VAT101|VAT102|VAT104|VAT207|missing|code|rate|duplicate/i.test(`${finding.id ?? ""} ${finding.finding}`)).length;
  const categories = {
    boxValidation: categoryCount("box_validation"),
    controlReconciliation: categoryCount("control_reconciliation") + reconciliations.filter((item) => item.status === "failed").length,
    manualJournals: categoryCount("manual_journals"),
    reverseCharge: categoryCount("reverse_charge"),
    piva: categoryCount("piva"),
    trendAnalysis: categoryCount("trend_analysis"),
    codingAndRates,
    schemeCompliance: categoryCount("scheme_compliance"),
    evidenceQuality: categoryCount("evidence_quality"),
  };
  return {
    high: severityItems.filter((severity) => severity === "critical" || severity === "high").length,
    medium: severityItems.filter((severity) => severity === "medium").length,
    low: severityItems.filter((severity) => severity === "low").length,
    total: severityItems.length,
    categories,
  };
}

function buildVatFilingSignOff(healthScore: number, readinessScore: number, findings: VatFinding[], checks: VatAssuranceCheck[], reconciliations: ReturnType<typeof reconcileVatReturn>): VatFilingSignOff {
  const blockers = [
    ...reconciliations.filter((item) => item.status === "failed").map((item) => item.name),
    ...checks.filter((check) => check.status === "failed" && (check.severity === "critical" || check.severity === "high")).map((check) => `${check.id}: ${check.title}`),
    ...findings.filter((finding) => finding.severity === "critical" || finding.severity === "high").map((finding) => finding.finding),
  ];
  const risks = [
    ...checks.filter((check) => check.status === "review").map((check) => `${check.id}: ${check.title}`),
    ...checks.filter((check) => check.status === "not_tested" && (check.category === "control_reconciliation" || check.category === "trend_analysis")).map((check) => `${check.id}: ${check.title} not tested`),
    ...findings.filter((finding) => finding.severity === "medium" || finding.severity === "low").map((finding) => finding.finding),
  ];
  if (readinessScore < 70) blockers.push(`VAT Readiness is ${readinessScore}%, below the 70% filing threshold.`);
  else if (readinessScore < 85) risks.push(`VAT Readiness is ${readinessScore}%, below the 85% ready threshold.`);
  if (healthScore < 70) blockers.push(`VAT Health is ${healthScore}%, below the 70% filing threshold.`);

  const uniqueBlockers = [...new Set(blockers)];
  const uniqueRisks = [...new Set(risks)];
  if (uniqueBlockers.length) return { status: "not_ready", label: "Not Ready", blockers: uniqueBlockers, risks: uniqueRisks, detail: `${uniqueBlockers.length} filing blocker(s) must be resolved.` };
  if (uniqueRisks.length) return { status: "ready_with_risks", label: "Ready with Risks", blockers: [], risks: uniqueRisks, detail: `${uniqueRisks.length} residual risk(s) require reviewer acknowledgement.` };
  return { status: "ready_to_submit", label: "Ready to Submit", blockers: [], risks: [], detail: "No filing blockers or unreviewed material risks were identified." };
}

function isEmptyVatReturn(vatReturn: VatReturn) {
  return Object.values(vatReturn).every((value) => Math.abs(value) === 0);
}

function extractExplicitVatReturn(files: ParsedFile[]): VatReturn | null {
  const values: Partial<VatReturn> = {};
  for (const file of files) {
    for (const row of file.rows) {
      const label = text(row, boxKeys) || rowText(row);
      const match = label.match(/box\s*([1-9])/i);
      if (!match) continue;
      const key = `box${match[1]}` as keyof VatReturn;
      values[key] = money(text(row, amountKeys));
    }
  }

  const hasBoxes = Object.keys(values).length >= 5;
  if (!hasBoxes) return null;
  return { ...emptyVatReturn, ...values };
}

function extractVatControl(files: ParsedFile[]) {
  for (const file of files) {
    const row = file.rows.find((item) => /vat control/i.test(rowText(item)));
    if (row) {
      const directBalance = money(text(row, balanceKeys));
      if (directBalance) return Math.abs(directBalance);
      const debit = money(text(row, debitKeys));
      const credit = money(text(row, creditKeys));
      if (debit || credit) return Math.abs(debit - credit);
    }
  }
  return undefined;
}

function buildEvidenceReviewed(files: ParsedFile[], transactions: VatTransaction[]) {
  const evidence = new Set<string>();
  if (files.some((file) => file.upload.fileType === "vat_report")) evidence.add("VAT report and return data");
  if (files.some((file) => file.upload.fileType === "trial_balance")) evidence.add("Trial balance and VAT control account");
  if (transactions.length) evidence.add("Transaction-level VAT ledger");
  if (transactions.some((transaction) => transaction.treatment === "import_vat")) evidence.add("PIVA/import VAT transaction evidence");
  if (files.some(isPriorPeriodVatFile)) evidence.add("Prior-period VAT comparison");
  return [...evidence];
}

function extractHmrcPayment(files: ParsedFile[]) {
  for (const file of files) {
    const row = file.rows.find((item) => {
      const detail = rowText(item);
      if (/pva|postponed|import vat|monthly statement/i.test(detail)) return false;
      return /vat payment|payment to hmrc|paid to hmrc|hmrc payment|vat paid/i.test(detail);
    });
    if (row) return Math.abs(money(text(row, amountKeys)));
  }
  return undefined;
}

function normaliseVatTransactions(file: ParsedFile): VatTransaction[] {
  return file.rows
    .filter((row) => !isVatSummaryOrReconciliationRow(row))
    .map((row) => {
      const netAmount = money(text(row, netKeys));
      const vatAmount = money(text(row, vatKeys));
      const grossAmount = money(text(row, grossKeys)) || netAmount + vatAmount;
      const rawType = text(row, typeKeys).toLowerCase();
      const party = text(row, partyKeys);
      const description = text(row, descKeys);
      const vatCode = text(row, vatCodeKeys);
      const transactionType = inferTransactionType(row, rawType, party, description, vatCode);
      const country = text(row, countryKeys);
      const normalisedCountry = normaliseCountry(country);
      const rawSupplyType = text(row, supplyTypeKeys).toLowerCase();
      const supplyType = /goods|stock|inventory|product/.test(rawSupplyType) ? "goods" : /service|subscription|licence|license|consult/.test(rawSupplyType) ? "services" : "unknown";
      const base = {
        date: text(row, dateKeys),
        taxPointDate: text(row, taxPointKeys),
        paidDate: text(row, paidDateKeys),
        reference: text(row, referenceKeys),
        status: text(row, statusKeys),
        party,
        description,
        netAmount,
        vatAmount,
        grossAmount,
        vatCode,
        nominalCode: text(row, nominalKeys),
        customerCountry: transactionType === "sale" ? country : undefined,
        supplierCountry: transactionType === "purchase" ? country : undefined,
        countryCode: normalisedCountry.code,
        countryRegion: normalisedCountry.region,
        supplyType,
        type: transactionType,
        sourceFile: file.upload.fileName,
      } satisfies Omit<VatTransaction, "treatment">;
      return { ...base, treatment: classifyVatTransaction(base) };
    })
    .filter((transaction) => Math.abs(transaction.netAmount) > 0 || Math.abs(transaction.vatAmount) > 0);
}

function isVatSummaryOrReconciliationRow(row: Record<string, string>) {
  const explicitBoxLabel = text(row, boxKeys);
  if (explicitBoxLabel && /box\s*[1-9]/i.test(explicitBoxLabel)) return true;

  const hasTransactionShape = Boolean(text(row, netKeys) || text(row, vatKeys) || text(row, grossKeys) || text(row, vatCodeKeys));
  if (hasTransactionShape) return false;

  return /reconciliation|vat control|difference/i.test(rowText(row));
}

function inferTransactionType(row: Record<string, string>, rawType: string, party: string, description: string, vatCode: string): VatTransaction["type"] {
  const detail = `${rawType} ${party} ${description} ${vatCode} ${rowText(row)}`.toLowerCase();
  const normalisedCode = vatCode.trim().toUpperCase().replace(/[^A-Z0-9_%]/g, "");

  if (/sale|sales|output|customer|debtor|income|revenue|invoice issued|dispatch|export/i.test(rawType)) return "sale";
  if (/purchase|input|supplier|creditor|expense|cost|bill|invoice received|import/i.test(rawType)) return "purchase";
  if (text(row, supplierIdentityKeys)) return "purchase";
  if (text(row, customerIdentityKeys)) return "sale";
  if (/sale|sales|output vat|customer|debtor|revenue|export sale|zero rated sale|invoice issued/.test(detail)) return "sale";
  if (/purchase|input vat|supplier|creditor|expense|office supplies|entertainment|construction|company car|import vat|pva|google|aws|azure|adobe|salesforce|invoice received/.test(detail)) return "purchase";
  if (/(_SALE|SALE|OUTPUT|EXPORT|EXS)$/.test(normalisedCode)) return "sale";
  if (/(_PURCHASE|PURCHASE|PUR|INPUT|RC|PVA|IMPORT|DRC|CISRC)$/.test(normalisedCode)) return "purchase";
  return "unknown";
}

function inferVatAssuranceProfile(files: ParsedFile[], transactions: VatTransaction[], vatReturn: VatReturn): VatAssuranceProfile {
  const corpus = `${files.map((file) => `${file.upload.fileName} ${file.upload.originalFileName ?? ""} ${file.rows.map(rowText).join(" ")}`).join(" ")} ${transactions.map((item) => `${item.description ?? ""} ${item.vatCode ?? ""} ${item.status ?? ""}`).join(" ")}`.toLowerCase();
  const signals: string[] = [];
  const has = (pattern: RegExp, signal: string) => {
    const matched = pattern.test(corpus);
    if (matched) signals.push(signal);
    return matched;
  };
  const cash = has(/cash accounting|cash basis|paid date|payment date|settled date|received date/, "cash-accounting evidence");
  const flat = has(/flat rate scheme|\bfrs\b|flat-rate|limited cost trader/, "flat-rate scheme signal");
  const partial = has(/partial exemption|partly exempt|residual input|exempt supplies|exempt income|de minimis/, "partial-exemption signal");
  const margin = has(/margin scheme|second hand|auctioneer|tour operators margin|toms\b/, "margin-scheme signal");
  const schemeSignals = [cash, flat, partial, margin].filter(Boolean).length;
  const scheme = schemeSignals > 1 ? "mixed" : cash ? "cash_accounting" : flat ? "flat_rate" : partial ? "partial_exemption" : margin ? "margin_scheme" : "standard";
  const transactionVolume = transactions.length;
  const grossThroughput = Math.abs(vatReturn.box6) + Math.abs(vatReturn.box7);
  const highValueRows = transactions.filter((item) => Math.abs(item.netAmount) >= 25_000).length;
  const companySize = transactionVolume >= 1000 || grossThroughput >= 5_000_000 || highValueRows >= 20 ? "large" : transactionVolume > 0 || grossThroughput > 0 ? "small" : "unknown";
  const materiality = companySize === "large" ? Math.max(1_000, Math.round(grossThroughput * 0.0025)) : Math.max(100, Math.round(grossThroughput * 0.01));
  const riskTolerance = companySize === "large" ? "enhanced" : "focused";
  return { version: "VAT-V3", companySize, scheme, materiality, riskTolerance, detectedSignals: signals };
}

function buildVatEngineFindings(vatReturn: VatReturn, transactions: VatTransaction[], reconciliations: ReturnType<typeof reconcileVatReturn>, profile: VatAssuranceProfile): VatFinding[] {
  const findings: VatFinding[] = [];
  reconciliations.filter((item) => item.status === "failed").forEach((item) => {
    findings.push(makeVatFinding("VAT300", "high", item.name, item.detail, "Potential VAT return/control account mismatch", item.difference, "Resolve this reconciliation difference before treating the VAT return as ready."));
  });

  const missingCodes = transactions.filter((transaction) => !transaction.vatCode);
  if (missingCodes.length) {
    findings.push(makeVatFinding("VAT100", missingCodes.length > 10 ? "high" : "medium", `${missingCodes.length} VAT transaction(s) have missing VAT codes`, `${missingCodes.length} of ${transactions.length} VAT transaction(s) have blank VAT/tax codes.`, "Potential VAT miscoding", missingCodes.reduce((sum, item) => sum + Math.abs(item.vatAmount), 0), "Assign VAT treatment to all uncoded transactions before review.", missingCodes[0]));
  }

  const blocked = transactions.filter((transaction) => /entertainment|hospitality|client dinner|golf/i.test(`${transaction.description} ${transaction.party}`) && transaction.vatAmount > 0);
  if (blocked.length) {
    findings.push(makeVatFinding("VAT200", "high", `Client entertainment VAT claimed — ${fc(blocked.reduce((sum, item) => sum + Math.abs(item.vatAmount), 0))}`, `${blocked.length} entertainment/hospitality transaction(s) include input VAT.`, "Potential Box 4 overclaim", blocked.reduce((sum, item) => sum + Math.abs(item.vatAmount), 0), "Remove VAT claim or provide supporting evidence.", blocked[0]));
  }

  const partialExemptionRows = transactions.filter((transaction) => transaction.type === "purchase" && Math.abs(transaction.vatAmount) > 0 && /partial exemption|partly exempt|residual|mixed use|insurance|finance|bank charge|medical|education/i.test(`${transaction.description ?? ""} ${transaction.party ?? ""} ${transaction.vatCode ?? ""}`));
  if ((profile.scheme === "partial_exemption" || profile.scheme === "mixed") && partialExemptionRows.length) {
    findings.push(makeVatFinding("VAT206", "high", `Partial exemption input VAT requires attribution — ${fc(partialExemptionRows.reduce((sum, item) => sum + Math.abs(item.vatAmount), 0))}`, `${partialExemptionRows.length} input VAT transaction(s) appear exempt, residual or mixed-use.`, "Potential Box 4 overclaim", partialExemptionRows.reduce((sum, item) => sum + Math.abs(item.vatAmount), 0), "Apply the partial-exemption method and restrict non-recoverable input VAT before submission.", partialExemptionRows[0]));
  }

  const duplicateGroups = new Map<string, VatTransaction[]>();
  for (const transaction of transactions.filter((item) => item.type === "purchase" && Math.abs(item.vatAmount) > 0)) {
    const key = [transaction.reference, transaction.party, Math.round(Math.abs(transaction.netAmount) * 100), Math.round(Math.abs(transaction.vatAmount) * 100), transaction.date].map((value) => String(value ?? "").trim().toLowerCase()).join("|");
    const list = duplicateGroups.get(key) ?? [];
    list.push(transaction);
    duplicateGroups.set(key, list);
  }
  const duplicateRows = [...duplicateGroups.values()].filter((items) => items.length > 1).flat();
  if (duplicateRows.length) {
    findings.push(makeVatFinding("VAT207", profile.companySize === "large" ? "critical" : "high", `Possible duplicate input VAT claims — ${fc(duplicateRows.reduce((sum, item) => sum + Math.abs(item.vatAmount), 0))}`, `${duplicateRows.length} purchase VAT transaction(s) share reference, party, amount and date.`, "Duplicate VAT reclaim risk", duplicateRows.reduce((sum, item) => sum + Math.abs(item.vatAmount), 0), "Remove duplicate VAT claims or evidence why each line is a separate supply.", duplicateRows[0]));
  }

  const highValueZeroExempt = transactions.filter((transaction) => transaction.type === "sale" && Math.abs(transaction.netAmount) >= profile.materiality && (transaction.treatment === "zero" || transaction.treatment === "exempt" || transaction.treatment === "outside_scope"));
  if (highValueZeroExempt.length) {
    findings.push(makeVatFinding("VAT208", profile.companySize === "large" ? "high" : "medium", `High-value zero/exempt/outside-scope sales need support — ${fc(highValueZeroExempt.reduce((sum, item) => sum + Math.abs(item.netAmount), 0))}`, `${highValueZeroExempt.length} sale transaction(s) exceed VAT-V3 materiality and carry no output VAT.`, "Output VAT under-declaration risk if treatment is unsupported", highValueZeroExempt.reduce((sum, item) => sum + Math.abs(item.netAmount) * 0.2, 0), "Attach export evidence, exemption basis, or place-of-supply analysis before sign-off.", highValueZeroExempt[0]));
  }

  const blockedCars = transactions.filter((transaction) => /company car|car purchase|vehicle purchase|motor car|bmw|mercedes|audi|tesla/i.test(`${transaction.description} ${transaction.party}`) && transaction.vatAmount > 0);
  if (blockedCars.length) {
    findings.push(makeVatFinding("VAT202", "high", `Company car input VAT indicators total ${fc(blockedCars.reduce((sum, item) => sum + Math.abs(item.vatAmount), 0))}`, `${blockedCars.length} car/vehicle transaction(s) include input VAT.`, "Potential Box 4 overclaim", blockedCars.reduce((sum, item) => sum + Math.abs(item.vatAmount), 0), "Confirm the recoverable amount and block non-recoverable car input VAT from Box 4.", blockedCars[0]));
  }

  const reverseCharge = transactions.filter((transaction) => transaction.treatment === "reverse_charge" || transaction.treatment === "construction_reverse_charge" || transaction.treatment === "import_vat");
  if (reverseCharge.length && vatReturn.box1 === 0) {
    findings.push(makeVatFinding("VAT005", "high", "Reverse charge transactions detected but Box 1 is nil", `${reverseCharge.length} reverse charge/import VAT transaction(s) detected.`, "Reverse charge VAT omitted from Box 1", reverseCharge.reduce((sum, item) => sum + Math.abs(item.netAmount) * 0.2, 0), "Confirm reverse charge VAT is included in both Box 1 and Box 4.", reverseCharge[0]));
  }

  if (vatReturn.box3 !== vatReturn.box1 + vatReturn.box2 || vatReturn.box5 !== vatReturn.box3 - vatReturn.box4) {
    findings.push(makeVatFinding("VAT001", "high", "VAT return box arithmetic does not agree", `Box 1 ${fc(vatReturn.box1)}, Box 2 ${fc(vatReturn.box2)}, Box 3 ${fc(vatReturn.box3)}, Box 4 ${fc(vatReturn.box4)}, Box 5 ${fc(vatReturn.box5)}.`, "VAT return arithmetic error", 0, "Recalculate Box 3 and Box 5 before preparing working papers."));
  }

  transactions.forEach((transaction, index) => {
    const net = Math.abs(transaction.netAmount);
    const vat = Math.abs(transaction.vatAmount);
    if (!net || !vat) return;
    const rate = vat / net;
    if (rate > 0 && ![0.05, 0.2].some((expected) => Math.abs(rate - expected) < 0.01)) {
      findings.push(makeVatFinding("VAT101", "medium", `Invalid VAT rate detected — ${Math.round(rate * 100)}%`, `VAT ${fc(vat)} on net ${fc(net)} gives an effective rate of ${Math.round(rate * 100)}%.`, "Potential VAT rate error", vat, "Review VAT code and invoice evidence.", transaction, index));
    }
  });

  return findings;
}

function makeVatFinding(id: string, severity: VatFinding["severity"], finding: string, evidence: string, impact: string, exposure: number, recommendation: string, transaction?: VatTransaction, index = 0): VatFinding {
  const rule = vatRule(id);
  return {
    id,
    layer: rule?.layer,
    severity,
    finding,
    title: finding,
    recommendation,
    evidence,
    impact,
    exposure: Math.round(Math.abs(exposure)),
    evidenceDetail: transaction ? {
      transactionId: `${transaction.sourceFile}-${index + 1}`,
      supplier: transaction.type === "purchase" ? transaction.party : undefined,
      customer: transaction.type === "sale" ? transaction.party : undefined,
      sourceFile: transaction.sourceFile,
    } : undefined,
  };
}

function buildVatReviewActions(findings: VatFinding[], reconciliations: ReturnType<typeof reconcileVatReturn>, vatReturn: VatReturn) {
  const actions = [
    {
      question: `Why does Box 1 equal ${fc(vatReturn.box1)}?`,
      action: "Review Box 1 drill-through and confirm output VAT, reverse charge and fuel scale charge entries.",
      priority: "medium" as const,
    },
    {
      question: `Why does Box 4 equal ${fc(vatReturn.box4)}?`,
      action: "Review recoverable input VAT drill-through and blocked VAT exceptions before sign-off.",
      priority: "medium" as const,
    },
    {
      question: `Why is the VAT liability ${fc(vatReturn.box5)}?`,
      action: "Agree Box 5 to the VAT control account and HMRC payment or reclaim evidence.",
      priority: "high" as const,
    },
  ];

  reconciliations.filter((item) => item.status === "failed").forEach((item) => {
    actions.push({
      question: `Why does ${item.name} not agree?`,
      action: item.detail,
      priority: "high" as const,
    });
  });

  findings.filter((finding) => finding.severity === "critical" || finding.severity === "high").slice(0, 5).forEach((finding) => {
    actions.push({
      question: finding.finding,
      action: finding.recommendation,
      priority: "high" as const,
    });
  });

  return actions.slice(0, 10);
}

export type { VatReviewResult, VatReturn };
