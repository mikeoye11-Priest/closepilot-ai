import test from "node:test";
import assert from "node:assert/strict";
import { buildVatInsights } from "../apps/web/lib/vat-insights";
import { pilotAnalysisResult } from "../apps/web/lib/data";

const apiUploads = [
  { fileType: "trial_balance", detectionBasis: "Direct Xero Accounting API sync", detectedVendor: "Xero" },
  { fileType: "vat_report", detectionBasis: "Direct Xero Accounting API sync", detectedVendor: "Xero" },
];

test("clean pilot VAT review → filing-ready positive + grounded fact sheet", () => {
  const vat = pilotAnalysisResult.vatReview!;
  const reconciled = [{ id: "v", tenantId: "t", companyId: "c", name: "VAT report agrees to VAT control", status: "passed" }];
  const insights = buildVatInsights(vat, [], reconciled as never, apiUploads);
  assert.equal(insights.available, true);
  assert.ok(insights.signals.some((s) => s.area === "Filing" && s.severity === "positive"), "filing-ready is surfaced as positive");
  assert.match(insights.headline, /filing-ready/i);
  assert.match(insights.factSheet, /VAT RETURN/);
  assert.match(insights.factSheet, /MTD READINESS/);
  assert.ok(insights.mtdScore > 0);
});

test("blockers and broken reconciliation raise critical/high signals", () => {
  const broken = {
    ...pilotAnalysisResult.vatReview!,
    filingSignOff: { status: "not_ready", label: "Not ready", blockers: ["VAT control unreconciled"], risks: [], detail: "" },
    reconciliationStatus: "FAIL",
  };
  const insights = buildVatInsights(broken as never, [], [], apiUploads);
  const areas = insights.signals.map((s) => s.area);
  assert.ok(areas.includes("Filing"));
  assert.ok(areas.includes("Reconciliation"));
  assert.equal(insights.signals[0].severity, "critical", "not-ready filing is the top signal");
  assert.match(insights.headline, /not ready/i);
});

test("manual upload breaks the MTD digital link → an MTD signal", () => {
  const vat = pilotAnalysisResult.vatReview!;
  const manual = [{ fileType: "vat_report", detectionBasis: "Uploaded CSV" }];
  const insights = buildVatInsights(vat, [], [], manual);
  assert.ok(insights.signals.some((s) => s.area === "MTD" && /digital link/i.test(s.title)), "digital-link gap flagged");
});
