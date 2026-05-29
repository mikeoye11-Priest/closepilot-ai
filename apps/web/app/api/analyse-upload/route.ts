import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import { analyseParsedFiles, createUpload, normaliseHeader, parseDelimitedText, type ParsedFile } from "@/lib/upload-analysis";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const form = await request.formData();
  const files = form.getAll("files").filter((item): item is File => item instanceof File);

  if (!files.length) {
    return NextResponse.json({ error: "No files uploaded" }, { status: 400 });
  }

  const parsed = await Promise.all(files.map(parseServerFile));
  return NextResponse.json(analyseParsedFiles(parsed));
}

async function parseServerFile(file: File): Promise<ParsedFile> {
  const lowerName = file.name.toLowerCase();

  if (lowerName.endsWith(".csv") || lowerName.endsWith(".tsv") || lowerName.endsWith(".txt")) {
    const text = await file.text();
    const { headers, rows } = parseDelimitedText(text, lowerName.endsWith(".tsv") ? "\t" : undefined);
    return {
      upload: createUpload(file.name, rows.length),
      headers,
      rows,
      isParsed: true
    };
  }

  if (lowerName.endsWith(".xlsx") || lowerName.endsWith(".xls")) {
    return parseWorkbook(file);
  }

  return {
    upload: createUpload(file.name),
    headers: [],
    rows: [],
    isParsed: false
  };
}

async function parseWorkbook(file: File): Promise<ParsedFile> {
  const workbook = new ExcelJS.Workbook();
  const workbookData = await file.arrayBuffer();
  await workbook.xlsx.load(workbookData as never);
  const worksheet = workbook.worksheets[0];

  if (!worksheet) {
    return {
      upload: createUpload(file.name),
      headers: [],
      rows: [],
      isParsed: false
    };
  }

  const headerRow = worksheet.getRow(1);
  const headers = Array.from({ length: worksheet.columnCount }, (_, index) => {
    const cell = headerRow.getCell(index + 1);
    return normaliseHeader(String(cell.text || cell.value || `column_${index + 1}`));
  });

  const rows: Record<string, string>[] = [];
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const values = headers.map((header, index) => [header, cellToString(row.getCell(index + 1).value)] as const);
    const object = Object.fromEntries(values);
    if (Object.values(object).some((value) => value.trim())) rows.push(object);
  });

  return {
    upload: createUpload(file.name, rows.length),
    headers,
    rows,
    isParsed: true
  };
}

function cellToString(value: ExcelJS.CellValue) {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    if ("text" in value && typeof value.text === "string") return value.text;
    if ("result" in value) return String(value.result ?? "");
    if ("richText" in value && Array.isArray(value.richText)) return value.richText.map((part) => part.text).join("");
    if ("hyperlink" in value && "text" in value) return String(value.text ?? value.hyperlink ?? "");
  }
  return String(value);
}
