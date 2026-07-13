import type {
  VatAssuranceCheck,
  VatBoxContribution,
  VatReadinessDrivers,
  VatReturn,
  VatTransaction,
  VatWorkpaper,
  VatPeriodComparison,
  VatAssuranceProfile,
} from "./types";
import { fc } from "./utils";

type AssuranceInput = {
  vatReturn: VatReturn;
  transactions: VatTransaction[];
  contributions: VatBoxContribution[];
  vatControlBalance?: number;
  hasExplicitReturn: boolean;
  evidenceReviewed: string[];
  previousVatReturn?: VatReturn;
  profile: VatAssuranceProfile;
};

type AssuranceOutput = {
  checks: VatAssuranceCheck[];
  readinessScore: number;
  readinessDrivers: VatReadinessDrivers;
  workpaper: VatWorkpaper;
  periodComparison: VatPeriodComparison;
};

const TOLERANCE = 1;

export function runVatAssurance(input: AssuranceInput): AssuranceOutput {
  const checks = [
    arithmeticCheck("VAT_001", "Box 3 equals Box 1 + Box 2", input.vatReturn.box1 + input.vatReturn.box2, input.vatReturn.box3),
    arithmeticCheck("VAT_002", "Box 5 equals Box 3 - Box 4", input.vatReturn.box3 - input.vatReturn.box4, input.vatReturn.box5),
    nonNegativeCheck("VAT_003", "Box 6 is not negative", input.vatReturn.box6),
    nonNegativeCheck("VAT_004", "Box 7 is not negative", input.vatReturn.box7),
    wholePoundsCheck(input.vatReturn),
    controlCheck(input),
    ledgerCheck("VAT_011", "Box 1 agrees to output VAT ledger", "box1", input),
    ledgerCheck("VAT_012", "Box 4 agrees to input VAT ledger", "box4", input),
    manualVatJournalCheck(input.transactions),
    roundVatCheck(input.transactions),
    trendCheck(input.vatReturn, input.previousVatReturn),
    reverseChargeBoxCheck("VAT_030", "Reverse charge VAT is included in Box 1", "box1", input),
    reverseChargeBoxCheck("VAT_031", "Reverse charge VAT is included in Box 4", "box4", input),
    reverseChargeNetCheck(input),
    pivaTreatmentCheck(input),
    pivaBox4Check(input),
    schemeProfileCheck(input),
    cashAccountingEvidenceCheck(input),
    partialExemptionRecoverabilityCheck(input),
    flatRateSchemeCheck(input),
    duplicateVatClaimCheck(input),
    highValueZeroExemptCheck(input),
  ];

  const readinessDrivers: VatReadinessDrivers = {
    boxValidation: categoryScore(checks, "box_validation"),
    controlReconciliations: categoryScore(checks, "control_reconciliation"),
    piva: categoryScore(checks, "piva"),
    reverseCharge: categoryScore(checks, "reverse_charge"),
    evidence: evidenceScore(input),
    schemeCompliance: categoryScore(checks, "scheme_compliance"),
    codingAndRates: categoryScore(checks, "coding_and_rates"),
  };
  const readinessScore = Math.round(
    readinessDrivers.boxValidation * 0.2 +
      readinessDrivers.controlReconciliations * 0.25 +
      readinessDrivers.piva * 0.12 +
      readinessDrivers.reverseCharge * 0.12 +
      readinessDrivers.evidence * 0.12 +
      (readinessDrivers.schemeCompliance ?? 60) * 0.12 +
      (readinessDrivers.codingAndRates ?? 60) * 0.07,
  );

  return {
    checks,
    readinessScore,
    readinessDrivers,
    workpaper: buildWorkpaper(checks, input.evidenceReviewed),
    periodComparison: buildPeriodComparison(input.vatReturn, input.previousVatReturn),
  };
}

function baseCheck(check: Omit<VatAssuranceCheck, "suite">): VatAssuranceCheck {
  return { suite: "vat_assurance_v3", ...check };
}

function arithmeticCheck(id: string, title: string, expected: number, actual: number) {
  const difference = Math.abs(expected - actual);
  return baseCheck({
    id,
    category: "box_validation",
    title,
    status: difference <= TOLERANCE ? "passed" : "failed",
    severity: "high",
    expected,
    actual,
    difference,
    detail: difference <= TOLERANCE ? `PASS: ${title}.` : `Expected ${fc(expected)}, actual ${fc(actual)}; difference ${fc(difference)}.`,
    recommendation: difference <= TOLERANCE ? undefined : "Correct the VAT return arithmetic before submission.",
  });
}

function nonNegativeCheck(id: string, title: string, actual: number) {
  return baseCheck({
    id,
    category: "box_validation",
    title,
    status: actual >= 0 ? "passed" : "failed",
    severity: "high",
    expected: 0,
    actual,
    difference: actual < 0 ? Math.abs(actual) : 0,
    detail: actual >= 0 ? `PASS: ${title}.` : `${title} failed: actual value is ${fc(actual)}.`,
    recommendation: actual < 0 ? "Review sign conventions and correct the VAT return value." : undefined,
  });
}

function wholePoundsCheck(vatReturn: VatReturn) {
  const values = [vatReturn.box6, vatReturn.box7, vatReturn.box8, vatReturn.box9];
  const invalid = values.filter((value) => !Number.isInteger(value));
  return baseCheck({
    id: "VAT_005",
    category: "box_validation",
    title: "Boxes 6-9 are stated in whole pounds",
    status: invalid.length ? "failed" : "passed",
    severity: "medium",
    detail: invalid.length ? `${invalid.length} box value(s) contain pence.` : "PASS: Boxes 6-9 are stated in whole pounds.",
    recommendation: invalid.length ? "Round Boxes 6-9 to whole pounds in line with VAT return presentation." : undefined,
  });
}

function controlCheck(input: AssuranceInput) {
  if (input.vatControlBalance === undefined) {
    return baseCheck({ id: "VAT_010", category: "control_reconciliation", title: "Box 5 agrees to VAT control account", status: "not_tested", severity: "high", detail: "VAT control account evidence was not available.", recommendation: "Upload a trial balance or VAT control reconciliation." });
  }
  const expected = Math.abs(input.vatControlBalance);
  const actual = Math.abs(input.vatReturn.box5);
  const difference = Math.abs(expected - actual);
  return baseCheck({ id: "VAT_010", category: "control_reconciliation", title: "Box 5 agrees to VAT control account", status: difference <= TOLERANCE ? "passed" : "failed", severity: "high", expected, actual, difference, detail: difference <= TOLERANCE ? "PASS: Box 5 agrees to the VAT control account." : `VAT control ${fc(expected)} versus Box 5 ${fc(actual)}; difference ${fc(difference)}.`, recommendation: difference > TOLERANCE ? "Investigate timing differences and direct postings before submission." : undefined });
}

function ledgerCheck(id: string, title: string, box: "box1" | "box4", input: AssuranceInput) {
  if (!input.contributions.length) {
    return baseCheck({ id, category: "control_reconciliation", title, status: "not_tested", severity: "high", detail: "Transaction-level VAT ledger evidence was not available.", recommendation: "Upload transaction-level VAT detail." });
  }
  const expected = input.contributions.filter((item) => item.box === box).reduce((sum, item) => sum + Math.abs(item.amount), 0);
  const actual = Math.abs(input.vatReturn[box]);
  const difference = Math.abs(expected - actual);
  return baseCheck({ id, category: "control_reconciliation", title, status: difference <= TOLERANCE ? "passed" : "failed", severity: "high", expected, actual, difference, detail: difference <= TOLERANCE ? `PASS: ${title}.` : `Ledger ${fc(expected)} versus return ${fc(actual)}; difference ${fc(difference)}.`, recommendation: difference > TOLERANCE ? "Investigate omitted, duplicated, or manually adjusted VAT entries." : undefined });
}

function manualVatJournalCheck(transactions: VatTransaction[]) {
  const matches = transactions.filter((item) => /vat\s*(control|input|output)/i.test(`${item.nominalCode ?? ""} ${item.description ?? ""}`) && /manual|journal|adjustment|override/i.test(item.description ?? ""));
  return baseCheck({ id: "VAT_020", category: "manual_journals", title: "No manual journals posted directly to VAT control", status: matches.length ? "failed" : "passed", severity: "high", actual: matches.length, detail: matches.length ? `${matches.length} direct manual VAT journal(s) detected.` : "PASS: no direct manual VAT control journals detected in the VAT detail.", recommendation: matches.length ? "Obtain support and reviewer approval for each direct VAT journal." : undefined });
}

function roundVatCheck(transactions: VatTransaction[]) {
  const watched = new Set([1000, 2000, 5000, 10000]);
  const matches = transactions.filter((item) => watched.has(Math.abs(item.vatAmount)));
  return baseCheck({ id: "VAT_021", category: "manual_journals", title: "Round-number VAT adjustments reviewed", status: matches.length ? "review" : "passed", severity: "medium", actual: matches.length, detail: matches.length ? `${matches.length} VAT amount(s) match high-risk round values (£1,000, £2,000, £5,000 or £10,000).` : "PASS: no high-risk round VAT values detected.", recommendation: matches.length ? "Review source evidence and posting rationale for each round-number VAT entry." : undefined });
}

function trendCheck(current: VatReturn, previous?: VatReturn) {
  const comparison = buildPeriodComparison(current, previous);
  if (comparison.status === "not_available") {
    return baseCheck({ id: "VAT_022", category: "trend_analysis", title: "Current-quarter VAT movement reviewed against prior quarter", status: "not_tested", severity: "medium", detail: comparison.detail, recommendation: "Provide a prior-period VAT export to test movements above 30%." });
  }
  return baseCheck({
    id: "VAT_022",
    category: "trend_analysis",
    title: "Current-quarter VAT movement reviewed against prior quarter",
    status: comparison.status === "review" ? "review" : "passed",
    severity: "medium",
    expected: comparison.previousVatDue,
    actual: comparison.currentVatDue,
    difference: Math.abs(comparison.movement),
    detail: comparison.detail,
    recommendation: comparison.status === "review" ? `Investigate and document the movement. ${comparison.primaryDriver}` : undefined,
  });
}

function buildPeriodComparison(current: VatReturn, previous?: VatReturn): VatPeriodComparison {
  if (!previous) {
    return { currentVatDue: current.box5, previousVatDue: 0, movement: 0, percentageChange: null, threshold: 30, status: "not_available", primaryDriver: "Prior-period evidence not available.", detail: "Prior-quarter VAT data was not supplied to this review." };
  }
  const movement = current.box5 - previous.box5;
  const percentageChange = previous.box5 === 0 ? null : Math.round((movement / Math.abs(previous.box5)) * 1000) / 10;
  const exceedsThreshold = percentageChange === null ? Math.abs(current.box5) > 1 : Math.abs(percentageChange) > 30;
  const drivers: Array<[string, number]> = [
    ["Output VAT (Box 1)", current.box1 - previous.box1],
    ["Input VAT (Box 4)", current.box4 - previous.box4],
    ["Sales value (Box 6)", current.box6 - previous.box6],
    ["Purchase value (Box 7)", current.box7 - previous.box7],
  ];
  const [driver, driverMovement] = drivers.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))[0];
  const direction = movement >= 0 ? "increase" : "decrease";
  const percentageText = percentageChange === null ? "not measurable because prior Box 5 was nil" : `${Math.abs(percentageChange)}%`;
  const primaryDriver = `${driver} moved by ${fc(driverMovement)}.`;
  return {
    currentVatDue: current.box5,
    previousVatDue: previous.box5,
    movement,
    percentageChange,
    threshold: 30,
    status: exceedsThreshold ? "review" : "stable",
    primaryDriver,
    detail: `VAT due changed from ${fc(previous.box5)} to ${fc(current.box5)}: ${fc(Math.abs(movement))} ${direction} (${percentageText}). ${primaryDriver}`,
  };
}

function reverseChargeTransactions(input: AssuranceInput) {
  return input.transactions.filter((item) => item.treatment === "reverse_charge" || item.treatment === "construction_reverse_charge");
}

function reverseChargeBoxCheck(id: string, title: string, box: "box1" | "box4", input: AssuranceInput) {
  const transactions = reverseChargeTransactions(input);
  if (!transactions.length) return baseCheck({ id, category: "reverse_charge", title, status: "not_tested", severity: "high", detail: "No reverse-charge transactions were detected." });
  const expected = transactions.reduce((sum, item) => sum + (Math.abs(item.vatAmount) || Math.abs(item.netAmount) * 0.2), 0);
  const actual = Math.abs(input.vatReturn[box]);
  const failed = actual + TOLERANCE < expected;
  return baseCheck({ id, category: "reverse_charge", title, status: failed ? "failed" : "passed", severity: "high", expected, actual, difference: Math.max(0, expected - actual), detail: failed ? `Expected at least ${fc(expected)} from detected reverse-charge transactions; ${box.toUpperCase()} is ${fc(actual)}.` : `PASS: ${title}.`, recommendation: failed ? `Include the reverse-charge VAT in ${box.toUpperCase()} and retain the transaction audit trail.` : undefined });
}

function reverseChargeNetCheck(input: AssuranceInput) {
  const transactions = reverseChargeTransactions(input);
  if (!transactions.length) return baseCheck({ id: "VAT_032", category: "reverse_charge", title: "Reverse-charge net value is included in the applicable net boxes", status: "not_tested", severity: "high", detail: "No reverse-charge transactions were detected." });
  const expected = transactions.reduce((sum, item) => sum + Math.abs(item.netAmount), 0);
  const actual = input.contributions.filter((item) => transactions.some((transaction) => transaction.sourceFile === item.sourceFile && transaction.party === item.party && transaction.description === item.description) && (item.box === "box6" || item.box === "box7")).reduce((sum, item) => sum + Math.abs(item.amount), 0);
  const failed = actual + TOLERANCE < expected;
  return baseCheck({ id: "VAT_032", category: "reverse_charge", title: "Reverse-charge net value is included in the applicable net boxes", status: failed ? "failed" : "passed", severity: "high", expected, actual, difference: Math.max(0, expected - actual), detail: failed ? `Expected at least ${fc(expected)} across applicable net boxes; traced ${fc(actual)}.` : "PASS: reverse-charge net values have box contributions.", recommendation: failed ? "Correct the transaction box mapping for reverse-charge net values." : undefined });
}

function pivaTransactions(input: AssuranceInput) {
  return input.transactions.filter((item) => item.treatment === "import_vat");
}

function pivaTreatmentCheck(input: AssuranceInput) {
  const transactions = pivaTransactions(input);
  if (!transactions.length) return baseCheck({ id: "VAT_040", category: "piva", title: "Import VAT uses PIVA treatment where applicable", status: "not_tested", severity: "high", detail: "No import VAT or PIVA transactions were detected." });
  const boxes = new Set(input.contributions.filter((item) => item.treatment === "import_vat").map((item) => item.box));
  const missing = ["box1", "box4", "box7"].filter((box) => !boxes.has(box as keyof VatReturn));
  return baseCheck({ id: "VAT_040", category: "piva", title: "Import VAT uses PIVA treatment where applicable", status: missing.length ? "failed" : "passed", severity: "high", actual: transactions.length, detail: missing.length ? `PIVA treatment is missing ${missing.join(", ")}.` : "PASS: detected PIVA entries contribute to Boxes 1, 4 and 7.", recommendation: missing.length ? "Apply postponed import VAT accounting using the monthly statement and correct the box mapping." : undefined });
}

function pivaBox4Check(input: AssuranceInput) {
  const transactions = pivaTransactions(input);
  if (!transactions.length) return baseCheck({ id: "VAT_041", category: "piva", title: "PIVA in Box 1 is also included in Box 4", status: "not_tested", severity: "high", detail: "No PIVA transactions were detected." });
  const box1 = input.contributions.filter((item) => item.treatment === "import_vat" && item.box === "box1").reduce((sum, item) => sum + Math.abs(item.amount), 0);
  const box4 = input.contributions.filter((item) => item.treatment === "import_vat" && item.box === "box4").reduce((sum, item) => sum + Math.abs(item.amount), 0);
  const difference = Math.abs(box1 - box4);
  return baseCheck({ id: "VAT_041", category: "piva", title: "PIVA in Box 1 is also included in Box 4", status: difference <= TOLERANCE ? "passed" : "failed", severity: "high", expected: box1, actual: box4, difference, detail: difference <= TOLERANCE ? "PASS: PIVA Box 1 and Box 4 contributions agree." : `PIVA Box 1 ${fc(box1)} versus Box 4 ${fc(box4)}.`, recommendation: difference > TOLERANCE ? "Include recoverable postponed import VAT in Box 4." : undefined });
}

function schemeProfileCheck(input: AssuranceInput) {
  const { profile } = input;
  const detail = `VAT-V3 profile: ${profile.companySize} company, ${profile.scheme.replaceAll("_", " ")} scheme, materiality ${fc(profile.materiality)}.`;
  return baseCheck({
    id: "VAT_070",
    category: "scheme_compliance",
    title: "VAT scheme and company-size profile identified",
    status: profile.scheme === "unknown" ? "review" : "passed",
    severity: profile.companySize === "large" ? "high" : "medium",
    detail: profile.detectedSignals.length ? `${detail} Signals: ${profile.detectedSignals.join("; ")}.` : `${detail} No explicit scheme signal was found; standard VAT checks applied.`,
    recommendation: profile.scheme === "unknown" ? "Confirm whether the business uses standard VAT, cash accounting, flat rate, partial exemption or a specialist scheme." : undefined,
  });
}

function cashAccountingEvidenceCheck(input: AssuranceInput) {
  const applies = input.profile.scheme === "cash_accounting" || (input.profile.scheme === "mixed" && input.profile.detectedSignals.some((signal) => /cash/i.test(signal)));
  if (!applies) {
    return baseCheck({ id: "VAT_071", category: "scheme_compliance", title: "Cash accounting payment evidence tested", status: "not_tested", severity: "medium", detail: "Cash accounting was not detected for this VAT review." });
  }
  const taxable = input.transactions.filter((item) => item.treatment !== "outside_scope" && item.treatment !== "unknown");
  const unsupported = taxable.filter((item) => !item.paidDate && !/paid|settled|received|cleared/i.test(`${item.status ?? ""} ${item.description ?? ""}`));
  const exposure = unsupported.reduce((sum, item) => sum + Math.abs(item.vatAmount), 0);
  return baseCheck({
    id: "VAT_071",
    category: "scheme_compliance",
    title: "Cash accounting includes only paid/received transactions",
    status: unsupported.length ? "failed" : "passed",
    severity: "high",
    actual: unsupported.length,
    difference: exposure,
    detail: unsupported.length ? `${unsupported.length} transaction(s) lack paid/received evidence under cash accounting; VAT exposure ${fc(exposure)}.` : "PASS: cash accounting transactions include paid/received evidence.",
    recommendation: unsupported.length ? "Exclude unpaid transactions from the cash-accounting return or attach settlement evidence." : undefined,
  });
}

function partialExemptionRecoverabilityCheck(input: AssuranceInput) {
  if (input.profile.scheme !== "partial_exemption" && input.profile.scheme !== "mixed") {
    return baseCheck({ id: "VAT_072", category: "scheme_compliance", title: "Partial exemption recovery reviewed", status: "not_tested", severity: "medium", detail: "Partial exemption was not detected for this VAT review." });
  }
  const inputVat = input.transactions.filter((item) => item.type === "purchase" && Math.abs(item.vatAmount) > 0);
  const exemptOrResidual = inputVat.filter((item) => /exempt|insurance|finance|bank charge|medical|education|residual|mixed use|partial exemption/i.test(`${item.vatCode ?? ""} ${item.description ?? ""} ${item.party ?? ""}`));
  const exposure = exemptOrResidual.reduce((sum, item) => sum + Math.abs(item.vatAmount), 0);
  return baseCheck({
    id: "VAT_072",
    category: "scheme_compliance",
    title: "Partial exemption input VAT is flagged for recoverability review",
    status: exemptOrResidual.length ? "review" : "passed",
    severity: "high",
    actual: exemptOrResidual.length,
    difference: exposure,
    detail: exemptOrResidual.length ? `${exemptOrResidual.length} exempt/residual input VAT transaction(s) require partial-exemption attribution; exposure ${fc(exposure)}.` : "PASS: no exempt/residual input VAT recovery indicators were detected.",
    recommendation: exemptOrResidual.length ? "Apply the partial-exemption method and restrict non-recoverable input VAT before filing." : undefined,
  });
}

function flatRateSchemeCheck(input: AssuranceInput) {
  const applies = input.profile.scheme === "flat_rate" || (input.profile.scheme === "mixed" && input.profile.detectedSignals.some((signal) => /flat/i.test(signal)));
  if (!applies) {
    return baseCheck({ id: "VAT_073", category: "scheme_compliance", title: "Flat Rate Scheme treatment reviewed", status: "not_tested", severity: "medium", detail: "Flat Rate Scheme was not detected for this VAT review." });
  }
  const inputClaims = input.contributions.filter((item) => item.box === "box4").reduce((sum, item) => sum + Math.abs(item.amount), 0);
  return baseCheck({
    id: "VAT_073",
    category: "scheme_compliance",
    title: "Flat Rate Scheme input VAT claims are restricted",
    status: inputClaims > input.profile.materiality ? "review" : "passed",
    severity: "high",
    actual: inputClaims,
    detail: inputClaims > input.profile.materiality ? `Box 4 input VAT contributions total ${fc(inputClaims)} under a flat-rate profile.` : "PASS: no material Box 4 input VAT claim detected under the flat-rate profile.",
    recommendation: inputClaims > input.profile.materiality ? "Confirm the claim is allowed under the Flat Rate Scheme, such as eligible capital assets, before filing." : undefined,
  });
}

function duplicateVatClaimCheck(input: AssuranceInput) {
  const seen = new Map<string, VatTransaction[]>();
  for (const item of input.transactions) {
    if (item.type !== "purchase" || Math.abs(item.vatAmount) <= 0) continue;
    const key = [normaliseKey(item.reference), normaliseKey(item.party), Math.round(Math.abs(item.netAmount) * 100), Math.round(Math.abs(item.vatAmount) * 100), item.date ?? ""].join("|");
    const list = seen.get(key) ?? [];
    list.push(item);
    seen.set(key, list);
  }
  const duplicates = [...seen.values()].filter((items) => items.length > 1).flat();
  const exposure = duplicates.reduce((sum, item) => sum + Math.abs(item.vatAmount), 0);
  return baseCheck({
    id: "VAT_074",
    category: "coding_and_rates",
    title: "Duplicate input VAT claims reviewed",
    status: duplicates.length ? "failed" : "passed",
    severity: input.profile.companySize === "large" ? "critical" : "high",
    actual: duplicates.length,
    difference: exposure,
    detail: duplicates.length ? `${duplicates.length} possible duplicate purchase VAT transaction(s) detected; duplicated VAT exposure ${fc(exposure)}.` : "PASS: no duplicate input VAT claim pattern detected.",
    recommendation: duplicates.length ? "Remove duplicate purchase VAT claims or document why the transactions are genuinely separate." : undefined,
  });
}

function highValueZeroExemptCheck(input: AssuranceInput) {
  const threshold = input.profile.companySize === "large" ? Math.max(input.profile.materiality, 10_000) : Math.max(input.profile.materiality, 2_500);
  const rows = input.transactions.filter((item) =>
    item.type === "sale" &&
    Math.abs(item.netAmount) >= threshold &&
    (item.treatment === "zero" || item.treatment === "exempt" || item.treatment === "outside_scope")
  );
  const exposure = rows.reduce((sum, item) => sum + Math.abs(item.netAmount), 0);
  return baseCheck({
    id: "VAT_075",
    category: "evidence_quality",
    title: "High-value zero-rated, exempt or outside-scope sales supported",
    status: rows.length ? "review" : "passed",
    severity: input.profile.companySize === "large" ? "high" : "medium",
    actual: rows.length,
    difference: exposure,
    detail: rows.length ? `${rows.length} high-value zero/exempt/outside-scope sale(s) need evidence review; net value ${fc(exposure)}.` : "PASS: no high-value zero/exempt/outside-scope sales above the review threshold.",
    recommendation: rows.length ? "Attach export evidence, exemption rationale or place-of-supply support before submission." : undefined,
  });
}

function categoryScore(checks: VatAssuranceCheck[], category: VatAssuranceCheck["category"]) {
  const relevant = checks.filter((check) => check.category === category);
  if (!relevant.length) return 60;
  const points = relevant.reduce((sum, check) => sum + (check.status === "passed" ? 100 : check.status === "review" ? 70 : check.status === "not_tested" ? 60 : 0), 0);
  return Math.round(points / relevant.length);
}

function normaliseKey(value: string | undefined) {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function evidenceScore(input: AssuranceInput) {
  let score = 20;
  if (input.hasExplicitReturn) score += 25;
  if (input.transactions.length) score += 25;
  if (input.vatControlBalance !== undefined) score += 20;
  if (pivaTransactions(input).length) score += 10;
  if (input.previousVatReturn) score += 10;
  return Math.min(100, score);
}

function buildWorkpaper(checks: VatAssuranceCheck[], evidenceReviewed: string[]): VatWorkpaper {
  const exceptions = checks.filter((check) => check.status === "failed" || check.status === "review");
  const notTested = checks.filter((check) => check.status === "not_tested");
  return {
    reference: "WP-02 VAT",
    objective: "Verify VAT return completeness and accuracy.",
    risk: "Incorrect VAT filing, unsupported VAT recovery, or omitted output tax.",
    evidenceReviewed,
    proceduresPerformed: ["Validated VAT return box arithmetic and presentation.", "Reconciled available VAT return, ledger and control-account evidence.", "Reviewed manual journals and round-number VAT entries.", "Tested detected reverse-charge and PIVA box treatment."],
    findings: exceptions.length ? exceptions.map((check) => `${check.id}: ${check.title} — ${check.detail}`) : ["No exceptions identified by the tests performed."],
    conclusion: exceptions.some((check) => check.severity === "high" && check.status === "failed") ? "Partner review required before submission." : notTested.length ? "Review required: complete the outstanding evidence-led procedures before submission." : "No material exceptions identified; VAT return is ready for reviewer sign-off.",
  };
}
