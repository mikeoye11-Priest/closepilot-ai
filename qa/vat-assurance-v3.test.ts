import test from "node:test";
import assert from "node:assert/strict";
import { runVatEngine, VAT_ENGINE_VERSION } from "../apps/web/lib/vat-engine";
import type { VatAssuranceStatus, VatReviewResult } from "../apps/web/lib/vat-engine/types";

function vatFile(fileName: string, rows: Record<string, string>[]) {
  return {
    upload: {
      id: fileName,
      tenantId: "tenant",
      companyId: "company",
      fileType: "vat_report",
      fileName,
      uploadedAt: "2026-07-13T00:00:00.000Z",
    },
    headers: Object.keys(rows[0] ?? {}),
    rows,
    isParsed: true,
  } as never;
}

function assuranceCheck(result: VatReviewResult, id: string) {
  const check = result.assuranceChecks?.find((item) => item.id === id);
  assert.ok(check, `Expected assurance check ${id}`);
  return check;
}

function assertCheckStatus(result: VatReviewResult, id: string, status: VatAssuranceStatus) {
  assert.equal(assuranceCheck(result, id).status, status);
}

test("VAT-V3 demo: standard small-company VAT boxes calculate exactly", () => {
  const result = runVatEngine([vatFile("standard-small-company-vat.csv", [
    { date: "2026-06-30", type: "Sale", customer: "Domestic Customer", description: "Standard rated sale", net_amount: "1000", vat_amount: "200", gross_amount: "1200", vat_code: "STD", reference: "S-STD-1" },
    { date: "2026-06-30", type: "Purchase", supplier: "Office Supplier", description: "Standard rated purchase", net_amount: "400", vat_amount: "80", gross_amount: "480", vat_code: "PSTD", reference: "P-STD-1" },
    { date: "2026-06-30", type: "Sale", customer: "Zero Rated Customer", description: "Small zero-rated sale", net_amount: "200", vat_amount: "0", gross_amount: "200", vat_code: "ZR", reference: "S-ZR-1" },
  ])]);

  assert.equal(result.engineVersion, VAT_ENGINE_VERSION);
  assert.deepEqual(result.vatReturn, {
    box1: 200,
    box2: 0,
    box3: 200,
    box4: 80,
    box5: 120,
    box6: 1200,
    box7: 400,
    box8: 0,
    box9: 0,
  });
  assert.equal(result.assuranceProfile?.companySize, "small");
  assert.equal(result.assuranceProfile?.scheme, "standard");
  assertCheckStatus(result, "VAT_001", "passed");
  assertCheckStatus(result, "VAT_002", "passed");
  assertCheckStatus(result, "VAT_074", "passed");
});

test("VAT-V3: gross-only rows are recovered, not dropped into an empty review", () => {
  // Xero and some prepared VAT exports carry only a gross (VAT-inclusive) amount
  // with net/tax blank. These rows must still produce a usable review rather than
  // collapsing to source:"empty" (the VAT-report-present-but-page-empty symptom).
  const result = runVatEngine([vatFile("gross-only-vat.csv", [
    { date: "2026-06-30", type: "Sale", customer: "Domestic Customer", description: "Standard rated sale", net_amount: "", vat_amount: "", gross_amount: "1200", vat_code: "STD", reference: "S-1" },
    { date: "2026-06-30", type: "Purchase", supplier: "Office Supplier", description: "Standard rated purchase", net_amount: "", vat_amount: "", gross_amount: "480", vat_code: "PSTD", reference: "P-1" },
  ])]);

  assert.equal(result.source, "computed_transactions");
  assert.equal(result.transactionsAnalysed, 2);
  assert.equal(result.vatReturn.box1, 200);
  assert.equal(result.vatReturn.box4, 80);
  assert.equal(result.vatReturn.box6, 1000);
  assert.equal(result.vatReturn.box7, 400);
});

test("VAT-V3: Xero tax-inclusive lines (gross computed as net+vat) normalise, not flag", () => {
  // Xero returns tax-inclusive line amounts; xero-sync builds gross as net+vat,
  // so the row is {net:<inclusive>, vat, gross:net+vat}. This must be recognised
  // as VAT-inclusive and corrected — otherwise every line reads ~16.7% and fires
  // a false VAT101, which drove computationAccuracy to 0 and blanked the review.
  const result = runVatEngine([vatFile("xero-inclusive-vat.csv", [
    { date: "2026-05-10", type: "Sale", customer: "A", description: "Sale", net_amount: "4200", vat_amount: "700", gross_amount: "4900", vat_code: "STD", reference: "S1" },
    { date: "2026-05-10", type: "Purchase", supplier: "B", description: "Bill", net_amount: "1200", vat_amount: "200", gross_amount: "1400", vat_code: "PSTD", reference: "P1" },
  ])]);

  assert.equal(result.findings.filter((finding) => finding.id === "VAT101").length, 0);
  assert.equal(result.vatReturn.box1, 700);
  assert.equal(result.vatReturn.box6, 3500); // true net, not the inclusive 4200
  assert.equal(result.vatReturn.box4, 200);
  assert.equal(result.vatReturn.box7, 1000); // true net, not the inclusive 1200
});

test("VAT-V3 demo: reverse charge produces equal Box 1 and Box 4 entries", () => {
  const result = runVatEngine([vatFile("reverse-charge-vat.csv", [
    { date: "2026-06-30", type: "Purchase", supplier: "Google Ireland", supplier_country: "IE", description: "Reverse charge cloud services", net_amount: "1000", vat_amount: "0", gross_amount: "1000", vat_code: "RC", reference: "RC-1" },
  ])]);

  assert.equal(result.vatReturn.box1, 200);
  assert.equal(result.vatReturn.box3, 200);
  assert.equal(result.vatReturn.box4, 200);
  assert.equal(result.vatReturn.box5, 0);
  assert.equal(result.vatReturn.box7, 1000);
  assertCheckStatus(result, "VAT_030", "passed");
  assertCheckStatus(result, "VAT_031", "passed");
  assertCheckStatus(result, "VAT_032", "passed");
  assert.equal(result.reconciliationStatus, "PASS");
});

test("VAT-V3 normalises VAT-inclusive source amounts before rate checks", () => {
  const result = runVatEngine([vatFile("xero-inclusive-vat-export.csv", [
    { date: "2026-06-30", type: "Sale", customer: "Ridgeway University", description: "Retainer for consulting work", net_amount: "500", vat_amount: "83", gross_amount: "500", vat_code: "STD", reference: "INC-S-1" },
    { date: "2026-06-30", type: "Purchase", supplier: "Training Supplier", description: "VAT-inclusive supplier invoice", net_amount: "1200", vat_amount: "200", gross_amount: "1200", vat_code: "PSTD", reference: "INC-P-1" },
  ])]);

  assert.equal(result.vatReturn.box1, 83);
  assert.equal(result.vatReturn.box4, 200);
  assert.equal(result.vatReturn.box5, -117);
  assert.equal(result.vatReturn.box6, 417);
  assert.equal(result.vatReturn.box7, 1000);
  assert.equal(result.findings.filter((finding) => finding.id === "VAT101").length, 0);
  assert.equal(result.scoreBreakdown?.computationAccuracy, 100);
});

test("VAT-V3 consumes canonical VAT transactions from the import mapper", () => {
  const result = runVatEngine([{
    ...vatFile("mapped-vat-export.csv", [
      { posting_day: "2026-06-30", contact_name: "Domestic Customer", memo: "Standard rated sale", tax_treatment: "STD", taxable_value: "ignored by old engine", tax_value: "ignored by old engine" },
      { posting_day: "2026-06-30", contact_name: "Office Supplier", memo: "Standard rated purchase", tax_treatment: "PSTD", taxable_value: "ignored by old engine", tax_value: "ignored by old engine" },
    ]),
    vatTransactions: [
      { date: new Date("2026-06-30T00:00:00.000Z"), vatCode: "STD", netAmount: 1000, vatAmount: 200, sourceRowIndex: 2, sourceFile: "mapped-vat-export.csv" },
      { date: new Date("2026-06-30T00:00:00.000Z"), vatCode: "PSTD", netAmount: 400, vatAmount: 80, sourceRowIndex: 3, sourceFile: "mapped-vat-export.csv" },
    ],
  } as never]);

  assert.notEqual(result.source, "empty");
  assert.equal(result.transactionsAnalysed, 2);
  assert.equal(result.vatReturn.box1, 200);
  assert.equal(result.vatReturn.box4, 80);
  assert.equal(result.vatReturn.box5, 120);
});

test("VAT-V3 demo: blocked input VAT is excluded from Box 4 and raised as a high-risk finding", () => {
  const result = runVatEngine([vatFile("blocked-input-vat.csv", [
    { date: "2026-06-30", type: "Purchase", supplier: "Hospitality Venue", description: "Client dinner entertainment", net_amount: "1000", vat_amount: "200", gross_amount: "1200", vat_code: "PSTD", reference: "ENT-1" },
    { date: "2026-06-30", type: "Purchase", supplier: "Office Supplier", description: "Recoverable office supplies", net_amount: "500", vat_amount: "100", gross_amount: "600", vat_code: "PSTD", reference: "OFF-1" },
  ])]);

  assert.equal(result.vatReturn.box4, 100);
  assert.equal(result.vatReturn.box7, 500);
  assert.ok(result.findings.some((finding) => finding.id === "VAT200" && finding.severity === "high" && finding.exposure === 200));
  assert.equal(result.blockedVatRisk, 200);
});

test("VAT-V3 demo: flat-rate profile flags material input VAT claims", () => {
  const result = runVatEngine([vatFile("flat-rate-scheme-vat.csv", [
    { scheme: "flat rate scheme", date: "2026-06-30", type: "Sale", customer: "Retail Customer", description: "Flat rate scheme sale", net_amount: "6000", vat_amount: "1200", gross_amount: "7200", vat_code: "STD", reference: "FRS-S-1" },
    { scheme: "flat rate scheme", date: "2026-06-30", type: "Purchase", supplier: "Equipment Supplier", description: "Input VAT claimed while on flat rate scheme", net_amount: "2000", vat_amount: "400", gross_amount: "2400", vat_code: "PSTD", reference: "FRS-P-1" },
  ])]);

  assert.equal(result.assuranceProfile?.scheme, "flat_rate");
  assert.equal(result.vatReturn.box1, 1200);
  assert.equal(result.vatReturn.box4, 400);
  assertCheckStatus(result, "VAT_073", "review");
  assert.ok((assuranceCheck(result, "VAT_073").actual ?? 0) > (result.assuranceProfile?.materiality ?? Number.MAX_SAFE_INTEGER));
  assert.ok((result.exceptionDashboard?.categories.schemeCompliance ?? 0) > 0);
});

test("VAT-V3 workpaper lists not-tested evidence gaps", () => {
  const result = runVatEngine([vatFile("standard-no-comparative-or-control.csv", [
    { date: "2026-06-30", type: "Sale", customer: "Domestic Customer", description: "Standard rated sale", net_amount: "1000", vat_amount: "200", gross_amount: "1200", vat_code: "STD", reference: "S-1" },
  ])]);

  assert.ok(result.workpaper?.findings.some((finding) => finding.includes("VAT_010") && finding.includes("not tested")));
  assert.ok(result.workpaper?.findings.some((finding) => finding.includes("VAT_022") && finding.includes("not tested")));
  assert.ok(!result.workpaper?.findings.includes("No exceptions identified by the tests performed."));
});

test("VAT-V3 profiles large companies and blocks duplicate input VAT claims", () => {
  const highVolumeSales = Array.from({ length: 1010 }, (_, index) => ({
    date: "2026-06-30",
    type: "Sale",
    customer: `Customer ${index}`,
    description: "Standard rated sale",
    net_amount: "6000",
    vat_amount: "1200",
    gross_amount: "7200",
    vat_code: "STD",
    reference: `S-${index}`,
  }));
  const rows = [
    ...highVolumeSales,
    { date: "2026-06-30", type: "Purchase", supplier: "OfficeCo", description: "Office equipment", net_amount: "1000", vat_amount: "200", gross_amount: "1200", vat_code: "PSTD", reference: "BILL-77" },
    { date: "2026-06-30", type: "Purchase", supplier: "OfficeCo", description: "Office equipment", net_amount: "1000", vat_amount: "200", gross_amount: "1200", vat_code: "PSTD", reference: "BILL-77" },
    { date: "2026-06-30", type: "Sale", customer: "Export Customer", description: "Export sale requiring evidence", net_amount: "50000", vat_amount: "0", gross_amount: "50000", vat_code: "ZR", reference: "EXP-1" },
  ];

  const result = runVatEngine([vatFile("large-company-vat.csv", rows)]);

  assert.equal(result.assuranceProfile?.version, "VAT-V3");
  assert.equal(result.assuranceProfile?.companySize, "large");
  assert.ok(result.assuranceChecks?.some((check) => check.id === "VAT_074" && check.status === "failed"));
  assert.ok(result.findings.some((finding) => finding.id === "VAT207" && finding.severity === "critical"));
  assert.ok(result.findings.some((finding) => finding.id === "VAT208"));
  assert.ok((result.exceptionDashboard?.categories.codingAndRates ?? 0) > 0);
});

test("VAT-V3 applies scheme-aware cash accounting and partial exemption checks", () => {
  const rows = [
    { scheme: "cash accounting partial exemption", date: "2026-06-30", type: "Sale", customer: "Retail Customer", description: "Paid sale", net_amount: "5000", vat_amount: "1000", gross_amount: "6000", vat_code: "STD", paid_date: "2026-06-30", reference: "S-1" },
    { scheme: "cash accounting partial exemption", date: "2026-06-30", type: "Purchase", supplier: "Unpaid Supplier", description: "Unpaid expense", net_amount: "2000", vat_amount: "400", gross_amount: "2400", vat_code: "PSTD", reference: "P-1" },
    { scheme: "cash accounting partial exemption", date: "2026-06-30", type: "Purchase", supplier: "Insurance Broker", description: "Residual input VAT for exempt supplies", net_amount: "1000", vat_amount: "200", gross_amount: "1200", vat_code: "PSTD", paid_date: "2026-06-30", reference: "P-2" },
  ];

  const result = runVatEngine([vatFile("cash-accounting-partial-exemption-vat.csv", rows)]);

  assert.equal(result.assuranceProfile?.scheme, "mixed");
  assert.ok(result.assuranceChecks?.some((check) => check.id === "VAT_070" && check.status === "passed"));
  assert.ok(result.assuranceChecks?.some((check) => check.id === "VAT_072" && check.status === "review"));
  assert.ok(result.findings.some((finding) => finding.id === "VAT206"));
  assert.ok((result.exceptionDashboard?.categories.schemeCompliance ?? 0) > 0);
});
