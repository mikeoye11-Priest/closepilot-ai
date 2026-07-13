import test from "node:test";
import assert from "node:assert/strict";
import { runVatEngine } from "../apps/web/lib/vat-engine";

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
