import test from "node:test";
import assert from "node:assert/strict";
import { calculateMtdReadiness, calculateMtdReadinessDrivers } from "../apps/web/lib/finance";

const apiUploads = [
  { fileType: "trial_balance", detectionBasis: "Direct Xero Accounting API sync", detectedVendor: "Xero" },
  { fileType: "vat_report", detectionBasis: "Direct Xero Accounting API sync", detectedVendor: "Xero" },
];
const manualUploads = [
  { fileType: "trial_balance", detectionBasis: "Uploaded CSV", detectedVendor: "Excel/CSV" },
  { fileType: "vat_report", detectionBasis: "Uploaded CSV" },
];
const vatReconciled = [{ name: "VAT report agrees to VAT control", status: "passed" }];
const vatUnreconciled = [{ name: "VAT report agrees to VAT control", status: "failed" }];
const vatReview = { source: "computed_transactions", transactionsAnalysed: 120 };
const driver = (drivers: ReturnType<typeof calculateMtdReadinessDrivers>, label: string) => drivers.find((d) => d.label === label)!;

test("API sync + usable, reconciled VAT → full MTD readiness; digital link preserved", () => {
  const drivers = calculateMtdReadinessDrivers([], vatReconciled as never, apiUploads, vatReview);
  assert.equal(driver(drivers, "Digital link from source").passed, true);
  assert.equal(driver(drivers, "VAT digital records").passed, true);
  assert.equal(driver(drivers, "VAT reconciled").passed, true);
  assert.equal(calculateMtdReadiness([], vatReconciled as never, apiUploads, vatReview), 98, "all drivers pass (capped at 98)");
});

test("manual upload breaks the digital link (advisory, not a hard fail elsewhere)", () => {
  const drivers = calculateMtdReadinessDrivers([], vatReconciled as never, manualUploads, vatReview);
  const link = driver(drivers, "Digital link from source");
  assert.equal(link.passed, false, "manual upload → digital link not preserved");
  assert.match(link.detail, /uploaded manually/i);
  // VAT records + reconciled + traceable still pass → 70.
  assert.equal(calculateMtdReadiness([], vatReconciled as never, manualUploads, vatReview), 70);
});

test("unreconciled VAT fails the reconciliation driver and an open VAT finding drags the score", () => {
  const openVat = [{ id: "F1", category: "vat", severity: "high", confidence: "high", evidenceStrength: "deterministic", status: "open", title: "Missing VAT code", expectedImpact: "", evidence: { sourceFile: "vat.csv" } }];
  const drivers = calculateMtdReadinessDrivers(openVat as never, vatUnreconciled as never, apiUploads, vatReview);
  assert.equal(driver(drivers, "VAT reconciled").passed, false);
  // link 30 + records 25 + reconciled 0 + traceable 20 = 75, minus 4 for one open VAT finding.
  assert.equal(calculateMtdReadiness(openVat as never, vatUnreconciled as never, apiUploads, vatReview), 71);
});

test("no VAT records → VAT drivers unassessed; no uploads → 0", () => {
  const noVat = [{ fileType: "trial_balance", detectionBasis: "Direct Xero Accounting API sync" }];
  const drivers = calculateMtdReadinessDrivers([], [], noVat, undefined);
  assert.equal(driver(drivers, "VAT digital records").passed, false);
  assert.match(driver(drivers, "VAT digital records").detail, /needs a VAT\/accounting export/i);
  assert.equal(calculateMtdReadiness([], [], []), 0, "empty pack → 0");
});
