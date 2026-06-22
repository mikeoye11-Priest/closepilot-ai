import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cases = JSON.parse(fs.readFileSync(path.join(__dirname, "cases.json"), "utf8"));

const QUALITY_GATE = {
  minRuleAccuracy: 0.95,
  maxFalsePositiveRate: 0.05,
  minCriticalCoverage: 1,
  minVatCoverage: 1,
};

function money(raw) {
  if (raw === null || raw === undefined || raw === "") return 0;
  const cleaned = String(raw)
    .trim()
    .replace(/[£$€,\s]/g, "")
    .replace(/^\((.*)\)$/, "-$1");
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : 0;
}

function text(raw) {
  return String(raw ?? "").trim().toLowerCase();
}

function signedTrialBalanceAmount(row) {
  if (row.balance !== undefined || row.closing_balance !== undefined || row.net !== undefined || row.amount !== undefined) {
    return money(row.balance ?? row.closing_balance ?? row.net ?? row.amount);
  }
  return money(row.debit ?? row.debits ?? row.dr) - money(row.credit ?? row.credits ?? row.cr);
}

function runRules(dataset) {
  const findings = [];
  const trialBalance = dataset.files.trial_balance ?? [];
  const vatReport = dataset.files.vat_report ?? [];
  const agedCreditors = dataset.files.aged_creditors ?? [];

  if (trialBalance.length) {
    const total = trialBalance.reduce((sum, row) => sum + signedTrialBalanceAmount(row), 0);
    if (Math.abs(total) > 0.01) {
      findings.push({
        ruleId: "TB_BALANCES_TO_ZERO",
        severity: "critical",
        exposure: Math.round(Math.abs(total) * 100) / 100,
        detail: `Trial balance sums to ${total.toFixed(2)} after debit/credit normalisation.`,
      });
    }

    const suspense = trialBalance.filter((row) => /suspense|clearing|holding/.test(text(row.account_name ?? row.description)));
    const suspenseExposure = suspense.reduce((sum, row) => sum + Math.abs(signedTrialBalanceAmount(row)), 0);
    if (suspenseExposure > 0.01) {
      findings.push({
        ruleId: "SUSPENSE_BALANCE_REVIEW",
        severity: suspenseExposure >= 10000 ? "high" : "medium",
        exposure: Math.round(suspenseExposure * 100) / 100,
        detail: `Suspense balance totals ${suspenseExposure.toFixed(2)}.`,
      });
    }
  }

  if (trialBalance.length && vatReport.length) {
    const vatControl = trialBalance
      .filter((row) => /vat|tax control|tax payable/.test(text(row.account_name ?? row.description)))
      .reduce((sum, row) => sum + signedTrialBalanceAmount(row), 0);
    const vatReturn = vatReport.reduce((sum, row) => sum + money(row.vat_amount ?? row.tax_amount ?? row.vat ?? row.amount), 0);
    const difference = Math.abs(Math.abs(vatControl) - Math.abs(vatReturn));
    if (difference > 1) {
      findings.push({
        ruleId: "VAT_CONTROL_MISMATCH",
        severity: difference >= 10000 ? "critical" : "high",
        exposure: Math.round(difference * 100) / 100,
        detail: `VAT control ${vatControl.toFixed(2)} does not agree to VAT report ${vatReturn.toFixed(2)}.`,
      });
    }
  }

  if (agedCreditors.length) {
    const seen = new Map();
    for (const row of agedCreditors) {
      const supplier = text(row.supplier ?? row.vendor ?? row.creditor ?? row.name);
      const ref = text(row.invoice_ref ?? row.invoice_number ?? row.reference ?? row.ref);
      const amount = Math.abs(money(row.amount ?? row.balance ?? row.outstanding)).toFixed(2);
      if (!supplier || !ref || amount === "0.00") continue;
      const key = `${supplier}|${ref}|${amount}`;
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
    for (const [key, count] of seen.entries()) {
      if (count <= 1) continue;
      const [, ref, amount] = key.split("|");
      findings.push({
        ruleId: "AP_DUPLICATE_INVOICE",
        severity: "medium",
        exposure: Number(amount),
        detail: `${count} AP rows share supplier, invoice reference ${ref}, and amount ${amount}.`,
      });
    }
  }

  return findings;
}

function rowsToCsv(rows) {
  const headers = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
  const escape = (value) => {
    const text = String(value ?? "");
    return /[",\n\r]/.test(text) ? `"${text.replaceAll("\"", "\"\"")}"` : text;
  };
  return [headers.join(","), ...rows.map((row) => headers.map((header) => escape(row[header])).join(","))].join("\n");
}

function fileNameFor(fileType, caseId) {
  const names = {
    trial_balance: "trial-balance",
    profit_loss: "profit-loss",
    balance_sheet: "balance-sheet",
    aged_debtors: "aged-debtors",
    aged_creditors: "aged-creditors",
    vat_report: "vat-detail",
  };
  return `${names[fileType] ?? fileType}-${caseId}.csv`;
}

async function runClosePilotEngine(testCase, baseUrl) {
  const form = new FormData();
  form.append("tenantId", "tenant_rule_validation");
  form.append("tenantName", "Rule Validation");
  form.append("tenantType", "accounting_practice");
  form.append("tenantPlan", "qa");
  form.append("companyId", "company_rule_validation");
  form.append("companyName", testCase.id);
  form.append("companyIndustry", "QA");
  form.append("accountingSystem", "Synthetic");
  form.append("currency", "GBP");
  form.append("country", "United Kingdom");

  for (const [fileType, rows] of Object.entries(testCase.files)) {
    if (!Array.isArray(rows) || rows.length === 0) continue;
    form.append("files", new Blob([rowsToCsv(rows)], { type: "text/csv" }), fileNameFor(fileType, testCase.id));
  }

  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/api/analyse-upload`, {
    method: "POST",
    body: form,
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`ClosePilot engine returned ${response.status}: ${body.slice(0, 200)}`);
  }
  return response.json();
}

function engineFindingMatches(finding, expectation) {
  const ruleIds = expectation.engineRuleIds ?? [];
  const titleNeedles = expectation.engineTitleIncludes ?? [];
  const ruleIdMatches = ruleIds.length > 0 && ruleIds.includes(finding.ruleId);
  const titleMatches = titleNeedles.length > 0 && titleNeedles.some((needle) => String(finding.title ?? "").toLowerCase().includes(needle.toLowerCase()));
  return ruleIdMatches || titleMatches;
}

function engineFindingForbidden(finding, testCase) {
  const needles = testCase.engineForbiddenTitleIncludes ?? [];
  return needles.some((needle) => String(finding.title ?? "").toLowerCase().includes(needle.toLowerCase()));
}

function engineValidationMatches(check, expectation) {
  const nameOk = String(check.name ?? "").toLowerCase().includes(String(expectation.name ?? "").toLowerCase());
  const statusOk = !expectation.status || check.status === expectation.status;
  return nameOk && statusOk;
}

async function evaluateEngineCase(testCase, baseUrl) {
  const result = await runClosePilotEngine(testCase, baseUrl);
  const findings = result.findings ?? [];
  const validationChecks = result.validationChecks ?? [];
  const expectedEngineFindings = (testCase.expectedFindings ?? []).filter((item) => item.engineRuleIds?.length || item.engineTitleIncludes?.length);
  const missingEngineFindings = expectedEngineFindings.filter((item) => !findings.some((finding) => engineFindingMatches(finding, item)));
  const falsePositives = findings.filter((finding) => engineFindingForbidden(finding, testCase));
  const expectedValidationChecks = testCase.expectedValidationChecks ?? [];
  const missingValidationChecks = expectedValidationChecks.filter((item) => !validationChecks.some((check) => engineValidationMatches(check, item)));

  return {
    id: testCase.id,
    findings,
    validationChecks,
    expectedEngineFindings,
    missingEngineFindings,
    missingValidationChecks,
    falsePositives,
  };
}

function severityRank(value) {
  return { low: 1, medium: 2, high: 3, critical: 4 }[value] ?? 0;
}

function evaluateCase(testCase) {
  const actual = runRules(testCase);
  const expected = testCase.expectedFindings ?? [];
  const forbidden = new Set(testCase.forbiddenFindings ?? []);
  const matchedExpected = [];
  const missingExpected = [];

  for (const item of expected) {
    const match = actual.find((finding) => finding.ruleId === item.ruleId);
    if (!match) {
      missingExpected.push(item);
      continue;
    }
    const severityOk = !item.severity || severityRank(match.severity) >= severityRank(item.severity);
    const exposureOk = item.exposure === undefined || Math.abs((match.exposure ?? 0) - item.exposure) <= Math.max(1, item.exposure * 0.02);
    if (severityOk && exposureOk) matchedExpected.push(item);
    else missingExpected.push(item);
  }

  const expectedRuleIds = new Set(expected.map((item) => item.ruleId));
  const falsePositives = actual.filter((finding) => forbidden.has(finding.ruleId) || (!expectedRuleIds.has(finding.ruleId) && testCase.group === "false-positives"));

  return {
    id: testCase.id,
    group: testCase.group,
    actual,
    expected,
    matchedExpected,
    missingExpected,
    falsePositives,
  };
}

const results = cases.map(evaluateCase);
const expectedCount = results.reduce((sum, result) => sum + result.expected.length, 0);
const matchedExpectedCount = results.reduce((sum, result) => sum + result.matchedExpected.length, 0);
const forbiddenCount = results.reduce((sum, result) => sum + (cases.find((item) => item.id === result.id)?.forbiddenFindings?.length ?? 0), 0);
const falsePositiveCount = results.reduce((sum, result) => sum + result.falsePositives.length, 0);
const criticalExpected = results.flatMap((result) => result.expected.filter((item) => item.severity === "critical"));
const criticalMatched = results.flatMap((result) => result.matchedExpected.filter((item) => item.severity === "critical"));
const vatExpected = results.flatMap((result) => result.expected.filter((item) => item.ruleId.startsWith("VAT_") || item.ruleId.includes("VAT")));
const vatMatched = results.flatMap((result) => result.matchedExpected.filter((item) => item.ruleId.startsWith("VAT_") || item.ruleId.includes("VAT")));

const ruleAccuracy = expectedCount ? matchedExpectedCount / expectedCount : 1;
const falsePositiveRate = forbiddenCount ? falsePositiveCount / forbiddenCount : 0;
const criticalCoverage = criticalExpected.length ? criticalMatched.length / criticalExpected.length : 1;
const vatCoverage = vatExpected.length ? vatMatched.length / vatExpected.length : 1;

for (const result of results) {
  if (!result.missingExpected.length && !result.falsePositives.length) {
    console.log(`PASS ${result.id}`);
    continue;
  }
  for (const missing of result.missingExpected) {
    console.log(`FAIL ${result.id}: ${missing.ruleId} not triggered`);
  }
  for (const finding of result.falsePositives) {
    console.log(`FALSE POSITIVE ${result.id}: ${finding.ruleId} triggered unexpectedly`);
  }
}

console.log("");
console.log("ClosePilot Rule Validation Gate");
console.log(`Rule Accuracy: ${(ruleAccuracy * 100).toFixed(1)}%`);
console.log(`False Positive Rate: ${(falsePositiveRate * 100).toFixed(1)}%`);
console.log(`Critical Rule Coverage: ${(criticalCoverage * 100).toFixed(1)}%`);
console.log(`VAT Coverage: ${(vatCoverage * 100).toFixed(1)}%`);

const gateFailed =
  ruleAccuracy < QUALITY_GATE.minRuleAccuracy ||
  falsePositiveRate > QUALITY_GATE.maxFalsePositiveRate ||
  criticalCoverage < QUALITY_GATE.minCriticalCoverage ||
  vatCoverage < QUALITY_GATE.minVatCoverage;

const runEngine = process.argv.includes("--engine") || Boolean(process.env.CLOSEPILOT_RULE_ENGINE_URL);
let engineFailed = false;

if (runEngine) {
  const engineUrl = process.env.CLOSEPILOT_RULE_ENGINE_URL || "http://127.0.0.1:3004";
  console.log("");
  console.log(`ClosePilot Engine Validation (${engineUrl})`);
  const engineResults = [];
  for (const testCase of cases) {
    try {
      engineResults.push(await evaluateEngineCase(testCase, engineUrl));
    } catch (error) {
      engineFailed = true;
      console.log(`ENGINE FAIL ${testCase.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  for (const result of engineResults) {
    if (!result.missingEngineFindings.length && !result.missingValidationChecks.length && !result.falsePositives.length) {
      console.log(`ENGINE PASS ${result.id}`);
      continue;
    }
    engineFailed = true;
    for (const missing of result.missingEngineFindings) {
      console.log(`ENGINE FAIL ${result.id}: ${missing.ruleId} not found in actual ClosePilot findings`);
    }
    for (const missing of result.missingValidationChecks) {
      console.log(`ENGINE FAIL ${result.id}: validation check "${missing.name}" with status "${missing.status}" not found`);
    }
    for (const finding of result.falsePositives) {
      console.log(`ENGINE FALSE POSITIVE ${result.id}: ${finding.ruleId ?? finding.id} ${finding.title}`);
    }
  }
}

if (gateFailed || engineFailed) {
  process.exitCode = 1;
}
