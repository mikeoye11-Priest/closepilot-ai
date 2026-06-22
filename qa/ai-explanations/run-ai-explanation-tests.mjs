import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ts = require("typescript");

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const explainabilityPath = path.join(repoRoot, "apps/web/lib/explainability.ts");
const source = fs.readFileSync(explainabilityPath, "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    esModuleInterop: true,
  },
}).outputText;

const moduleShim = { exports: {} };
const requireShim = () => ({});
new Function("exports", "require", "module", compiled)(moduleShim.exports, requireShim, moduleShim);

const {
  explainFinding,
  explanationToPlainText,
  validateExplanationGrounding,
} = moduleShim.exports;

const qaRoot = path.join(repoRoot, "qa/ai-explanations");
const categoryDirs = fs.readdirSync(qaRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

const cases = categoryDirs.flatMap((category) => {
  const casePath = path.join(qaRoot, category, "cases.json");
  if (!fs.existsSync(casePath)) return [];
  return JSON.parse(fs.readFileSync(casePath, "utf8")).map((item) => ({ ...item, category }));
});

const failures = [];
const failedCaseIds = new Set();
const scores = [];

for (const testCase of cases) {
  const result = explainFinding(testCase.finding);
  const explanation = explanationToPlainText(result);
  const validation = validateExplanationGrounding(explanation, testCase.finding);
  scores.push(validation.score);

  if (!validation.passed) {
    failedCaseIds.add(testCase.id);
    failures.push(`${testCase.id}: generated explanation failed grounding (${JSON.stringify(validation)})`);
  }

  for (const term of testCase.mustReference ?? []) {
    if (!containsNormalized(explanation, term)) {
      failedCaseIds.add(testCase.id);
      failures.push(`${testCase.id}: missing required reference "${term}"`);
    }
  }

  for (const term of testCase.mustNotInvent ?? []) {
    if (containsNormalized(explanation, term)) {
      failedCaseIds.add(testCase.id);
      failures.push(`${testCase.id}: invented unsupported term "${term}"`);
    }
  }

  for (const bad of testCase.badExplanations ?? []) {
    const badValidation = validateExplanationGrounding(bad, testCase.finding);
    if (badValidation.passed) {
      failedCaseIds.add(testCase.id);
      failures.push(`${testCase.id}: hallucination probe unexpectedly passed: "${bad}"`);
    }
  }

  const consistency = new Set(Array.from({ length: 20 }, () => explanationToPlainText(explainFinding(testCase.finding))));
  if (consistency.size !== 1) {
    failedCaseIds.add(testCase.id);
    failures.push(`${testCase.id}: explanation is not deterministic across 20 runs`);
  }

  console.log(`${validation.passed ? "PASS" : "FAIL"} ${testCase.id} confidence=${result.confidenceScore}% grounding=${validation.score}%`);
}

const averageGrounding = scores.length ? Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length) : 0;

console.log("\nClosePilot AI Explanation Gate");
console.log(`Cases: ${cases.length}`);
console.log(`Passed: ${cases.length - failedCaseIds.size}`);
console.log(`Failed: ${failedCaseIds.size}`);
console.log(`Average Grounding Score: ${averageGrounding}%`);

if (failures.length) {
  console.log("\nFailures:");
  failures.forEach((failure) => console.log(`- ${failure}`));
  process.exit(1);
}

function containsNormalized(text, term) {
  return normalize(text).includes(normalize(term));
}

function normalize(value) {
  return String(value).toLowerCase().replace(/,/g, "").replace(/\s+/g, " ").trim();
}
