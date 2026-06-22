import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cases = JSON.parse(fs.readFileSync(path.join(__dirname, "import-recognition-cases.json"), "utf8"));
const baseUrl = (process.env.CLOSEPILOT_IMPORT_ENGINE_URL ?? "http://localhost:3010").replace(/\/$/, "");

function rowsToCsv(rows) {
  const headers = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
  const escape = (value) => {
    const text = String(value ?? "");
    return /[",\n\r]/.test(text) ? `"${text.replaceAll("\"", "\"\"")}"` : text;
  };
  return [headers.join(","), ...rows.map((row) => headers.map((header) => escape(row[header])).join(","))].join("\n");
}

async function analyseCase(testCase) {
  const form = new FormData();
  form.append("tenantId", "tenant_import_recognition");
  form.append("tenantName", "Import Recognition QA");
  form.append("tenantType", "accounting_practice");
  form.append("tenantPlan", "qa");
  form.append("companyId", `company_${testCase.id}`);
  form.append("companyName", testCase.id);
  form.append("companyIndustry", "QA");
  form.append("accountingSystem", "Synthetic");
  form.append("currency", "GBP");
  form.append("country", "United Kingdom");
  form.append("files", new Blob([rowsToCsv(testCase.rows)], { type: "text/csv" }), testCase.fileName);

  const response = await fetch(`${baseUrl}/api/analyse-upload`, { method: "POST", body: form });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`${testCase.id}: analyse-upload returned ${response.status}: ${body.slice(0, 240)}`);
  }
  return response.json();
}

function includesNeedle(value, needle) {
  return String(value ?? "").toLowerCase().includes(String(needle).toLowerCase());
}

function evaluateCase(testCase, result) {
  const failures = [];
  const upload = result.uploads?.[0];
  if (!upload) {
    return [`${testCase.id}: no upload returned`];
  }

  if (upload.fileType !== testCase.expectedFileType) {
    failures.push(`fileType expected ${testCase.expectedFileType}, got ${upload.fileType}`);
  }
  if (testCase.expectedVendor && upload.detectedVendor !== testCase.expectedVendor) {
    failures.push(`vendor expected ${testCase.expectedVendor}, got ${upload.detectedVendor}`);
  }
  if ((upload.detectionConfidence ?? 0) < testCase.minConfidence) {
    failures.push(`confidence expected >= ${testCase.minConfidence}, got ${upload.detectionConfidence ?? 0}`);
  }
  if (testCase.expectedGateStatus && upload.importGateStatus !== testCase.expectedGateStatus) {
    failures.push(`importGateStatus expected ${testCase.expectedGateStatus}, got ${upload.importGateStatus ?? "none"}`);
  }

  if (testCase.expectedRuleGateStatus) {
    const gate = (result.validationChecks ?? []).find((check) => includesNeedle(check.name, "rule execution gate"));
    if (!gate) failures.push("missing rule execution gate validation check");
    else if (gate.status !== testCase.expectedRuleGateStatus) failures.push(`rule execution gate expected ${testCase.expectedRuleGateStatus}, got ${gate.status}`);
  }

  for (const forbidden of testCase.forbiddenFindingTitleIncludes ?? []) {
    const match = (result.findings ?? []).find((finding) => includesNeedle(finding.title, forbidden));
    if (match) failures.push(`FALSE POSITIVE finding triggered while gate was blocked: ${match.title}`);
  }

  return failures;
}

const results = [];
for (const testCase of cases) {
  try {
    const result = await analyseCase(testCase);
    results.push({ id: testCase.id, failures: evaluateCase(testCase, result) });
  } catch (error) {
    results.push({ id: testCase.id, failures: [error instanceof Error ? error.message : String(error)] });
  }
}

for (const result of results) {
  if (!result.failures.length) {
    console.log(`PASS ${result.id}`);
    continue;
  }
  console.log(`FAIL ${result.id}`);
  for (const failure of result.failures) {
    console.log(`  - ${failure}`);
  }
}

const passed = results.filter((result) => !result.failures.length).length;
const failed = results.length - passed;
console.log("\nClosePilot Import Recognition Gate");
console.log(`Cases: ${results.length}`);
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);

if (failed) {
  process.exitCode = 1;
}
