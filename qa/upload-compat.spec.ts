import ExcelJS from "exceljs";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";

const baseURL = process.env.CLOSEPILOT_QA_URL ?? "http://localhost:3010";
const workbookPath = "demo-data/ClosePilot_Enterprise_Demo_Pack v2.xlsx";
const vatAssuranceV2DemoPaths = [
  "demo-data/vat-assurance-v2-transactions.csv",
  "demo-data/vat-assurance-v2-trial-balance.csv",
  "demo-data/vat-assurance-v2-prior-transactions.csv",
];

const expectedRuleIds = [
  "REC_001",
  "REC_003",
  "REC_005",
  "CR_008",
  "FS_005",
  "AR_003",
  "VAT_009",
  "VAT_004",
  "VAT_012",
  "VAT_010",
  "AP_001",
  "CF_009",
  "AP_004",
  "ST_028",
  "AR_002",
  "CF_001",
  "VAT_005",
];

const sheetExports = [
  ["Trial Balance1", "northstar_trial_balance.csv"],
  ["Balance Sheet", "northstar_balance_sheet.csv"],
  ["Profit & Loss", "northstar_profit_loss.csv"],
  ["AR Aging", "northstar_aged_debtors.csv"],
  ["AP Aging", "northstar_aged_creditors.csv"],
  ["VAT Return", "northstar_vat_report.csv"],
  ["VAT Transactions", "northstar_vat_transactions.csv"],
  ["Bank Reconciliation", "northstar_bank_reconciliation.csv"],
  ["Payroll Summary", "northstar_payroll_summary.csv"],
  ["Fixed Asset Register", "northstar_fixed_asset_register.csv"],
  ["Cashflow Forecast", "northstar_cashflow_forecast.csv"],
] as const;

type AnalysisResponse = {
  uploads: { fileType: string; fileName: string; rowCount?: number }[];
  validationChecks: { name: string; status: string; detail: string }[];
  findings: { ruleId?: string; title: string; severity?: string; category?: string; description?: string; expectedImpact?: string; evidence?: { calculation?: string } }[];
  vatReview?: {
    vatReturn: Record<"box1" | "box2" | "box3" | "box4" | "box5" | "box6" | "box7" | "box8" | "box9", number>;
    findings: { id?: string; layer?: number; finding: string; severity: string; exposure?: number; impact?: string }[];
    healthScore: number;
    readinessScore?: number;
    assuranceChecks?: { id: string; status: string; difference?: number }[];
    workpaper?: { reference: string; objective: string };
    periodComparison?: { previousVatDue: number; currentVatDue: number; movement: number; percentageChange: number | null; status: string };
    exceptionDashboard?: { high: number; medium: number; low: number; total: number };
    filingSignOff?: { status: string; label: string; blockers: string[]; risks: string[] };
    scoreBreakdown?: { computationAccuracy: number; reconciliation: number; missingVatCodes: number; blockedVatExposure: number; documentationQuality: number; manualAdjustments: number };
    status: string;
    reconciliationResults: { name: string; status: string; difference: number }[];
    boxContributions: { box: string; amount: number; party?: string; description?: string; vatCode?: string; canonicalCode?: string; countryCode?: string; countryRegion?: string; recoverability?: string; riskCategory?: string; reason: string }[];
    blockedVatRisk?: number;
    highRiskCount?: number;
    exceptionsCount?: number;
    reconciliationStatus?: string;
    transactionsAnalysed: number;
    source: string;
  };
};

function mimeTypeFor(filePath: string) {
  return filePath.endsWith(".xlsx") ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "text/csv";
}

async function postFiles(filePaths: string[]) {
  const formData = new FormData();
  for (const filePath of filePaths) {
    const buffer = readFileSync(filePath);
    const blob = new Blob([new Uint8Array(buffer)], { type: mimeTypeFor(filePath) });
    formData.append("files", blob, path.basename(filePath));
  }

  const response = await fetch(`${baseURL}/api/analyse-upload`, {
    method: "POST",
    body: formData,
  });
  expect(response.ok).toBeTruthy();
  return (await response.json()) as AnalysisResponse;
}

function expectEnterpriseDemoCoverage(result: AnalysisResponse) {
  const uploadedTypes = new Set(result.uploads.map((upload) => upload.fileType));
  for (const fileType of [
    "trial_balance",
    "balance_sheet",
    "profit_loss",
    "aged_debtors",
    "aged_creditors",
    "vat_report",
    "bank_reconciliation",
    "payroll_summary",
    "fixed_asset_register",
    "cashflow_forecast",
  ]) {
    expect(uploadedTypes.has(fileType), `${fileType} should be parsed`).toBeTruthy();
  }

  expect(result.findings.length).toBeGreaterThanOrEqual(20);
  expect(result.findings.length).toBeLessThanOrEqual(45);

  const returnedRuleIds = new Set(result.findings.map((finding) => finding.ruleId).filter(Boolean));
  for (const ruleId of expectedRuleIds) {
    expect(returnedRuleIds.has(ruleId), `${ruleId} should be detected`).toBeTruthy();
  }

  expect(result.validationChecks).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ name: "AR ledger agrees to debtors control", status: "failed" }),
      expect.objectContaining({ name: "VAT report agrees to VAT control", status: "failed" }),
      expect.objectContaining({ name: "Bank reconciliation agrees to TB bank balance", status: "failed" }),
      expect.objectContaining({ name: "Balance sheet equation", status: "passed" }),
    ]),
  );

  expect(result.vatReview?.source).toBe("explicit_return");
  expect(result.vatReview?.vatReturn).toEqual(
    expect.objectContaining({
      box1: 50400,
      box3: 50400,
      box4: 18700,
      box5: 31700,
      box6: 2850000,
      box7: 1920000,
    }),
  );
  expect(result.vatReview?.status).toBe("Review Required Before Submission");
  expect(result.vatReview?.healthScore).toBeLessThan(100);
  expect(result.vatReview?.scoreBreakdown?.reconciliation).toBeLessThan(100);
  expect(result.vatReview?.reconciliationStatus).toBe("FAIL");
  expect(result.vatReview?.reconciliationResults).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ name: "VAT return agrees to VAT control", status: "failed", difference: 10300 }),
    ]),
  );
}

function csvEscape(value: unknown) {
  const formulaResult = value && typeof value === "object" && "result" in value
    ? (value as { result?: unknown }).result
    : value;
  const text = formulaResult instanceof Date ? formulaResult.toISOString().slice(0, 10) : String(formulaResult ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, "\"\"")}"` : text;
}

async function exportWorkbookSheetsToCsv(useGenericNames = false) {
  const dir = mkdtempSync(path.join(tmpdir(), "closepilot-upload-"));
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(workbookPath);

  const files: string[] = [];
  for (const [index, [sheetName, fileName]] of sheetExports.entries()) {
    const sheet = workbook.getWorksheet(sheetName);
    if (!sheet) throw new Error(`Missing worksheet ${sheetName}`);

    const lines: string[] = [];
    for (let rowNumber = 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
      const row = sheet.getRow(rowNumber);
      const values = Array.from({ length: sheet.columnCount }, (_, index) => csvEscape(row.getCell(index + 1).value));
      lines.push(values.join(","));
    }
    const exportName = useGenericNames ? `export_${String(index + 1).padStart(2, "0")}.csv` : fileName;
    const exportPath = path.join(dir, exportName);
    writeFileSync(exportPath, lines.join("\n"));
    files.push(exportPath);
  }

  return {
    dir,
    files,
  };
}

function createVendorStyleCsvSet() {
  const dir = mkdtempSync(path.join(tmpdir(), "closepilot-vendor-formats-"));
  const files = [
    {
      name: "export_01.csv",
      rows: [
        ["Account Code", "Account", "Account Type", "Debit - Year to date", "Credit - Year to date"],
        ["1100", "Trade Debtors", "Asset", "120000", ""],
        ["4000", "Sales", "Revenue", "", "120000"],
      ],
    },
    {
      name: "export_02.csv",
      rows: [
        ["Customer", "Current", "1 - 30", "31 - 60", "61 - 90", "91 and over", "Total"],
        ["Acme Ltd", "1000", "2000", "3000", "4000", "5000", "15000"],
      ],
    },
    {
      name: "export_03.csv",
      rows: [
        ["Vendor", "Current", "1 - 30", "31 - 60", "61 - 90", "91 and over", "Total"],
        ["SteelCo", "500", "1000", "1500", "2000", "2500", "7500"],
      ],
    },
    {
      name: "export_04.csv",
      rows: [
        ["G/L Account No.", "G/L Account Name", "Net Change", "Balance at Date"],
        ["10000", "Bank Current Account", "25000", "25000"],
        ["30000", "Retained Earnings", "-25000", "-25000"],
      ],
    },
    {
      name: "export_05.csv",
      rows: [
        ["Contact", "Invoice Reference", "DueDate", "DueLocal", "Total"],
        ["Dunlop Retail Ltd", "INV-001", "2026-01-31", "9000", "9000"],
      ],
    },
    {
      name: "export_06.csv",
      rows: [
        ["Tax Code", "Net Amount", "Tax Amount", "Gross"],
        ["STD", "1000", "200", "1200"],
      ],
    },
  ];

  return {
    dir,
    files: files.map((file) => {
      const filePath = path.join(dir, file.name);
      writeFileSync(filePath, file.rows.map((row) => row.map(csvEscape).join(",")).join("\n"));
      return filePath;
    }),
  };
}

function createSapStyleCsvSet() {
  const dir = mkdtempSync(path.join(tmpdir(), "closepilot-sap-formats-"));
  const files = [
    {
      name: "sap_export_01.csv",
      rows: [
        ["Company Code", "Fiscal Year", "Posting Period", "G/L Account", "G/L Account Long Text", "Debit/Credit Code", "Amount in Company Code Currency", "Document Number", "Posting Date"],
        ["1000", "2025", "12", "110000", "Trade Debtors", "S", "850000", "190000001", "2025-12-31"],
        ["1000", "2025", "12", "210000", "Trade Creditors", "H", "-500000", "190000002", "2025-12-31"],
      ],
    },
    {
      name: "sap_export_02.csv",
      rows: [
        ["Company Code", "Customer", "Document Number", "Posting Date", "DueLocal", "91 and over", "Total"],
        ["1000", "Dunlop Retail Ltd", "180000001", "2025-09-01", "245000", "245000", "245000"],
      ],
    },
    {
      name: "sap_export_03.csv",
      rows: [
        ["Company Code", "Supplier", "Document Number", "Posting Date", "DueLocal", "91 and over", "Total"],
        ["1000", "Meridian Tools Ltd", "510000001", "2025-06-01", "8200", "8200", "8200"],
      ],
    },
    {
      name: "sap_export_04.csv",
      rows: [
        ["Company Code", "Document Number", "Posting Date", "Tax Code", "Amount in Local Currency", "Tax Amount"],
        ["1000", "510000002", "2025-12-31", "A1", "10000", "2000"],
      ],
    },
  ];

  return {
    dir,
    files: files.map((file) => {
      const filePath = path.join(dir, file.name);
      writeFileSync(filePath, file.rows.map((row) => row.map(csvEscape).join(",")).join("\n"));
      return filePath;
    }),
  };
}

function createComputedVatMatrixCsv() {
  const dir = mkdtempSync(path.join(tmpdir(), "closepilot-vat-matrix-"));
  const filePath = path.join(dir, "vat_transactions.csv");
  const rows = [
    ["Date", "Type", "Contact", "Description", "Net Amount", "Tax Amount", "Tax Code", "Country", "Supply Type"],
    ["2025-12-01", "Sale", "UK Customer Ltd", "UK standard sale", "1000", "200", "STD", "United Kingdom", "goods"],
    ["2025-12-02", "Purchase", "UK Supplier Ltd", "UK standard purchase", "500", "100", "STD", "United Kingdom", "goods"],
    ["2025-12-03", "Sale", "Export Customer", "Zero rated sale", "1000", "0", "ZR", "United Kingdom", "goods"],
    ["2025-12-04", "Sale", "Insurance Customer", "Exempt sale", "750", "0", "EXEMPT", "United Kingdom", "services"],
    ["2025-12-05", "Purchase", "Google Ireland", "Cloud services reverse charge", "1000", "0", "RC", "Ireland", "services"],
    ["2025-12-06", "Purchase", "HMRC PVA", "Postponed import VAT statement", "25000", "5000", "PVA", "United Kingdom", "goods"],
    ["2025-12-07", "Purchase", "BMW Dealer", "Company car purchase", "10000", "2000", "STD", "United Kingdom", "goods"],
  ];
  writeFileSync(filePath, rows.map((row) => row.map(csvEscape).join(",")).join("\n"));
  return { dir, filePath };
}

function createAmbiguousVatExportCsv() {
  const dir = mkdtempSync(path.join(tmpdir(), "closepilot-vat-ambiguous-"));
  const filePath = path.join(dir, "vat_export.csv");
  const rows = [
    ["Date", "Contact", "Description", "Net Amount", "Tax Amount", "Tax Code"],
    ["2025-12-01", "ABC Retail", "UK Sale", "1000", "200", "STD"],
    ["2025-12-02", "NHS Trust", "Zero Rated Sale", "2000", "0", "ZR"],
    ["2025-12-03", "EU Customer", "Export Sale", "3000", "0", "EXPORT"],
    ["2025-12-04", "Office Supplies Ltd", "Office supplies purchase", "500", "100", "STD"],
    ["2025-12-05", "Google Ireland", "Google cloud reverse charge", "1000", "0", "RC"],
    ["2025-12-06", "AWS Ireland", "AWS reverse charge", "1500", "0", "RC"],
    ["2025-12-07", "Restaurant Ltd", "Client entertainment", "400", "80", "STD"],
    ["2025-12-08", "HMRC PVA", "Import VAT PVA", "5000", "0", "PVA"],
    ["2025-12-09", "BuildRight Ltd", "Construction services", "2500", "0", "DRC"],
    ["2025-12-10", "BMW Dealer", "Company car purchase", "10000", "2000", "STD"],
  ];
  writeFileSync(filePath, rows.map((row) => row.map(csvEscape).join(",")).join("\n"));
  return { dir, filePath };
}

function createZeroVatExportCsv() {
  const dir = mkdtempSync(path.join(tmpdir(), "closepilot-zero-vat-"));
  const filePath = path.join(dir, "vat_export.csv");
  const rows = [
    ["Date", "Contact", "Description", "Net Amount", "Tax Amount", "Tax Code"],
  ];
  writeFileSync(filePath, rows.map((row) => row.map(csvEscape).join(",")).join("\n"));
  return { dir, filePath };
}

function createCountryAwareVatCsv() {
  const dir = mkdtempSync(path.join(tmpdir(), "closepilot-country-vat-"));
  const filePath = path.join(dir, "vat_country_matrix.csv");
  const rows = [
    ["Type", "Customer/Supplier", "Description", "Country", "VAT Code", "Net Amount", "VAT Amount", "Gross", "Expected VAT Box Impact"],
    ["Sale", "ABC Retail", "UK Product Sale", "UK", "STD", "1000", "200", "1200", "Box1+Box6"],
    ["Purchase", "Office Depot", "Office Supplies", "UK", "PSTD", "500", "100", "600", "Box4+Box7"],
    ["Sale", "NHS Trust", "Zero Rated Medical Goods", "UK", "ZR", "2000", "0", "2000", "Box6"],
    ["Purchase", "Google Ireland", "Google Workspace", "IE", "RC", "1000", "200", "1200", "Box1+Box4+Box7"],
    ["Purchase", "AWS", "Cloud Hosting", "IE", "RC", "1500", "300", "1800", "Box1+Box4+Box7"],
    ["Purchase", "Restaurant XYZ", "Client Entertainment", "UK", "ENT", "400", "80", "480", "Blocked VAT Review"],
    ["Purchase", "HMRC PVA", "Import VAT", "CN", "IMP", "5000", "1000", "6000", "Box1+Box4+Box7"],
    ["Sale", "EU Customer", "Goods Export", "FR", "EXP", "3000", "0", "3000", "Box6"],
    ["Purchase", "Construction Ltd", "Subcontractor Labour", "UK", "CISRC", "2500", "500", "3000", "Reverse Charge Review"],
    ["Purchase", "Vehicle Dealer", "Company Car", "UK", "CAR", "10000", "2000", "12000", "Blocked VAT Review"],
  ];
  writeFileSync(filePath, rows.map((row) => row.map(csvEscape).join(",")).join("\n"));
  return { dir, filePath };
}

test("enterprise demo XLSX workbook expands into supported finance document types", async () => {
  const result = await postFiles([workbookPath]);
  expectEnterpriseDemoCoverage(result);
});

test("enterprise demo CSV bundle returns the same core assurance coverage", async () => {
  const exported = await exportWorkbookSheetsToCsv();
  try {
    const result = await postFiles(exported.files);
    expectEnterpriseDemoCoverage(result);
  } finally {
    rmSync(exported.dir, { recursive: true, force: true });
  }
});

test("generic CSV exports are classified from content, not filename only", async () => {
  const exported = await exportWorkbookSheetsToCsv(true);
  try {
    const result = await postFiles(exported.files);
    expectEnterpriseDemoCoverage(result);
  } finally {
    rmSync(exported.dir, { recursive: true, force: true });
  }
});

test("vendor-style headers from common accounting systems are normalised", async () => {
  const exported = createVendorStyleCsvSet();
  try {
    const result = await postFiles(exported.files);
    const uploadedTypes = result.uploads.map((upload) => upload.fileType);
    expect(uploadedTypes).toContain("trial_balance");
    expect(uploadedTypes).toContain("aged_debtors");
    expect(uploadedTypes).toContain("aged_creditors");
    expect(uploadedTypes).toContain("vat_report");
  } finally {
    rmSync(exported.dir, { recursive: true, force: true });
  }
});

test("SAP S/4HANA-style finance exports are normalised", async () => {
  const exported = createSapStyleCsvSet();
  try {
    const result = await postFiles(exported.files);
    const uploadedTypes = result.uploads.map((upload) => upload.fileType);
    expect(uploadedTypes).toContain("trial_balance");
    expect(uploadedTypes).toContain("aged_debtors");
    expect(uploadedTypes).toContain("aged_creditors");
    expect(uploadedTypes).toContain("vat_report");
  } finally {
    rmSync(exported.dir, { recursive: true, force: true });
  }
});

test("VAT code matrix calculates Boxes 1-9 from transaction treatment", async () => {
  const exported = createComputedVatMatrixCsv();
  try {
    const result = await postFiles([exported.filePath]);
    expect(result.vatReview?.source).toBe("computed_transactions");
    expect(result.vatReview?.vatReturn).toEqual(
      expect.objectContaining({
        box1: 5400,
        box2: 0,
        box3: 5400,
        box4: 5300,
        box5: 100,
        box6: 2750,
        box7: 26500,
        box8: 0,
        box9: 0,
      }),
    );
    expect(result.vatReview?.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "VAT202", layer: 4, finding: expect.stringMatching(/Company car input VAT/) }),
      ]),
    );
    expect(result.vatReview?.assuranceChecks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "VAT_001", status: "passed" }),
        expect.objectContaining({ id: "VAT_002", status: "passed" }),
        expect.objectContaining({ id: "VAT_030", status: "passed" }),
        expect.objectContaining({ id: "VAT_040", status: "passed" }),
        expect.objectContaining({ id: "VAT_041", status: "passed" }),
      ]),
    );
    expect(result.vatReview?.workpaper).toEqual(expect.objectContaining({ reference: "WP-02 VAT" }));
  } finally {
    rmSync(exported.dir, { recursive: true, force: true });
  }
});

test("VAT Assurance V2 demo pack reconciles and generates its workpaper", async () => {
  const result = await postFiles(vatAssuranceV2DemoPaths);

  expect(result.vatReview?.source).toBe("computed_transactions");
  expect(result.vatReview?.vatReturn).toEqual({
    box1: 19992,
    box2: 0,
    box3: 19992,
    box4: 8274,
    box5: 11718,
    box6: 89960,
    box7: 43370,
    box8: 0,
    box9: 0,
  });
  expect(result.vatReview?.reconciliationStatus).toBe("PASS");
  expect(result.vatReview?.readinessScore).toBeGreaterThanOrEqual(90);
  expect(result.vatReview?.assuranceChecks).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: "VAT_001", status: "passed" }),
    expect.objectContaining({ id: "VAT_002", status: "passed" }),
    expect.objectContaining({ id: "VAT_010", status: "passed", difference: 0 }),
    expect.objectContaining({ id: "VAT_011", status: "passed" }),
    expect.objectContaining({ id: "VAT_012", status: "passed" }),
    expect.objectContaining({ id: "VAT_030", status: "passed" }),
    expect.objectContaining({ id: "VAT_031", status: "passed" }),
    expect.objectContaining({ id: "VAT_032", status: "passed" }),
    expect.objectContaining({ id: "VAT_040", status: "passed" }),
    expect.objectContaining({ id: "VAT_041", status: "passed" }),
    expect.objectContaining({ id: "VAT_022", status: "passed", difference: 2218 }),
  ]));
  expect(result.vatReview?.periodComparison).toEqual(expect.objectContaining({
    previousVatDue: 9500,
    currentVatDue: 11718,
    movement: 2218,
    percentageChange: 23.3,
    status: "stable",
  }));
  expect(result.vatReview?.exceptionDashboard).toEqual(expect.objectContaining({ high: 0, medium: 0, low: 0, total: 0 }));
  expect(result.vatReview?.filingSignOff).toEqual(expect.objectContaining({ status: "ready_to_submit", label: "Ready to Submit", blockers: [], risks: [] }));
  expect(result.vatReview?.workpaper).toEqual(expect.objectContaining({
    reference: "WP-02 VAT",
    objective: "Verify VAT return completeness and accuracy.",
  }));
});

test("VAT engine infers sales and purchases when exports omit transaction type", async () => {
  const exported = createAmbiguousVatExportCsv();
  try {
    const result = await postFiles([exported.filePath]);
    expect(result.vatReview?.source).toBe("computed_transactions");
    expect(result.vatReview?.vatReturn).toEqual(
      expect.objectContaining({
        box1: 2200,
        box3: 2200,
        box4: 2100,
        box5: 100,
        box6: 6000,
        box7: 10500,
      }),
    );
    const box6 = result.vatReview?.boxContributions?.filter((item: { box: string }) => item.box === "box6") ?? [];
    expect(box6.map((item: { party?: string }) => item.party)).toEqual(expect.arrayContaining(["ABC Retail", "NHS Trust", "EU Customer"]));
  } finally {
    rmSync(exported.dir, { recursive: true, force: true });
  }
});

test("zero VAT exports do not appear ready for review", async () => {
  const exported = createZeroVatExportCsv();
  try {
    const result = await postFiles([exported.filePath]);
    expect(result.vatReview?.status).toBe("VAT Data Required");
    expect(result.vatReview?.healthScore).toBe(0);
    expect(result.vatReview?.transactionsAnalysed).toBe(0);
    expect(result.vatReview?.source).toBe("empty");
  } finally {
    rmSync(exported.dir, { recursive: true, force: true });
  }
});

test("country and system-specific VAT codes map to correct boxes", async () => {
  const exported = createCountryAwareVatCsv();
  try {
    const result = await postFiles([exported.filePath]);
    expect(result.vatReview?.source).toBe("computed_transactions");
    expect(result.vatReview?.vatReturn).toEqual(
      expect.objectContaining({
        box1: 2200,
        box3: 2200,
        box4: 2100,
        box5: 100,
        box6: 6000,
        box7: 10500,
      }),
    );
    const contributions = result.vatReview?.boxContributions ?? [];
    const box6 = contributions.filter((item) => item.box === "box6");
    const box7 = contributions.filter((item) => item.box === "box7");
    expect(box6.map((item) => item.party)).toEqual(expect.arrayContaining(["ABC Retail", "NHS Trust", "EU Customer"]));
    expect(box7.map((item) => item.party)).toEqual(expect.arrayContaining(["Office Depot", "Google Ireland", "AWS", "Construction Ltd", "HMRC PVA"]));
    expect(box7.map((item) => item.party)).not.toEqual(expect.arrayContaining(["Restaurant XYZ", "Vehicle Dealer"]));
    expect(contributions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ party: "Google Ireland", canonicalCode: "REVERSE_CHARGE_PURCHASE", countryCode: "IE", countryRegion: "eu", recoverability: "recoverable" }),
        expect.objectContaining({ party: "HMRC PVA", canonicalCode: "POSTPONED_IMPORT_VAT", countryCode: "CN", countryRegion: "non_eu", riskCategory: "import" }),
      ]),
    );
    expect(result.vatReview?.blockedVatRisk).toBe(2080);
  } finally {
    rmSync(exported.dir, { recursive: true, force: true });
  }
});

test("Ask ClosePilot answers from evidence-linked findings", async () => {
  const analysis = await postFiles([workbookPath]);
  const response = await fetch(`${baseURL}/api/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      mode: "deterministic",
      question: "What is blocking month-end close and what should we do first?",
      score: 79,
      companyName: "Northstar Manufacturing Ltd",
      accountingSystem: "SAP",
      findings: analysis.findings,
    }),
  });
  expect(response.ok).toBeTruthy();
  const body = await response.json() as { answer: string; source?: string };
  expect(body.source).toBe("deterministic");
  expect(body.answer).toMatch(/AR_003|AR_011|FS_001|REC_001|REC_003|REC_005|CR_008|FS_005/);
  expect(body.answer).toMatch(/£257,405|£565,000|£2,860,000|£45,000|£10,300|£15,000|£52,000|£750,000/);
  expect(body.answer).toMatch(/Action:/);
});

test("pilot upload guard rejects unsupported file types", async () => {
  const formData = new FormData();
  formData.append("files", new Blob(["not a finance export"], { type: "application/pdf" }), "client-records.pdf");

  const response = await fetch(`${baseURL}/api/analyse-upload`, { method: "POST", body: formData });
  expect(response.status).toBe(415);
  await expect(response.json()).resolves.toEqual(expect.objectContaining({ error: expect.stringContaining("Unsupported file type") }));
});

test("pilot upload guard rejects too many files", async () => {
  const formData = new FormData();
  for (let index = 0; index < 13; index += 1) {
    formData.append("files", new Blob(["Account,Balance\nBank,0"], { type: "text/csv" }), `trial-balance-${index}.csv`);
  }

  const response = await fetch(`${baseURL}/api/analyse-upload`, { method: "POST", body: formData });
  expect(response.status).toBe(413);
  await expect(response.json()).resolves.toEqual(expect.objectContaining({ error: expect.stringContaining("at most 12 files") }));
});

test("pilot upload guard rejects packs above four megabytes", async () => {
  const formData = new FormData();
  formData.append("files", new Blob([new Uint8Array(4 * 1024 * 1024 + 1)], { type: "text/csv" }), "oversized-trial-balance.csv");

  const response = await fetch(`${baseURL}/api/analyse-upload`, { method: "POST", body: formData });
  expect(response.status).toBe(413);
  await expect(response.json()).resolves.toEqual(expect.objectContaining({ error: expect.stringContaining("4 MB or smaller") }));
});
