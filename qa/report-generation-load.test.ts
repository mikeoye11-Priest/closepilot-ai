import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import test from "node:test";
import { buildManagementWorkbook, buildStatutoryWorkbook } from "../apps/web/lib/accounts-xlsx";
import { buildCT600, renderCt600Html } from "../apps/web/lib/ct600";
import { pilotStatements } from "../apps/web/lib/data";
import { renderIxbrl } from "../apps/web/lib/ixbrl";
import { buildManagementAccounts, renderManagementAccountsHtml } from "../apps/web/lib/management-accounts";
import { buildStatutoryAccounts, renderStatutoryAccountsHtml } from "../apps/web/lib/statutory-accounts";

const CONCURRENT_REPORTS = 20;
const WALL_CLOCK_BUDGET_MS = 15_000;

async function generateReportBundle(index: number) {
  const statements = {
    ...pilotStatements,
    companyName: `Load Test Company ${index + 1}`,
    sourceProvider: (index % 2 ? "quickbooks" : "xero") as "quickbooks" | "xero",
  };
  const management = buildManagementAccounts(statements);
  const statutory = buildStatutoryAccounts(statements, { full: index % 2 === 0 });
  const ct600 = buildCT600(statutory, { companyNumber: "12345678", utr: "1234567890" });

  const [managementXlsx, statutoryXlsx] = await Promise.all([
    buildManagementWorkbook(management).xlsx.writeBuffer(),
    buildStatutoryWorkbook(statutory).xlsx.writeBuffer(),
  ]);

  return {
    managementHtml: renderManagementAccountsHtml(management),
    statutoryHtml: renderStatutoryAccountsHtml(statutory),
    ct600Html: renderCt600Html(ct600),
    ixbrl: renderIxbrl(statutory, "12345678"),
    managementXlsx,
    statutoryXlsx,
  };
}

test("report generation sustains a concurrent production-sized batch", { timeout: WALL_CLOCK_BUDGET_MS + 5_000 }, async () => {
  const startedAt = performance.now();
  const bundles = await Promise.all(Array.from({ length: CONCURRENT_REPORTS }, (_, index) => generateReportBundle(index)));
  const elapsedMs = performance.now() - startedAt;

  assert.equal(bundles.length, CONCURRENT_REPORTS);
  for (const bundle of bundles) {
    assert.match(bundle.managementHtml, /Management Accounts/);
    assert.match(bundle.statutoryHtml, /Financial Statements/);
    assert.match(bundle.ct600Html, /CT600 \(draft\)/);
    assert.match(bundle.ixbrl, /<ix:nonFraction /);
    assert.ok(bundle.managementXlsx.byteLength > 5_000, "management workbook is populated");
    assert.ok(bundle.statutoryXlsx.byteLength > 5_000, "statutory workbook is populated");
  }
  assert.ok(elapsedMs <= WALL_CLOCK_BUDGET_MS, `${CONCURRENT_REPORTS} report bundles took ${elapsedMs.toFixed(0)}ms; budget is ${WALL_CLOCK_BUDGET_MS}ms`);
});
