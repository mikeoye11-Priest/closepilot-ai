import { normaliseColumnName } from "../mappings/aliases";
import type { ParsedRows } from "./csv-parser";

export function parseExcelRows(rows: Array<Array<string | number | null | undefined>>): ParsedRows {
  const [headerRow = [], ...bodyRows] = rows;
  const headers = headerRow.map((header) => normaliseColumnName(String(header ?? "")));
  return {
    headers,
    rows: bodyRows
      .filter((row) => row.some((cell) => String(cell ?? "").trim()))
      .map((row, index) => ({
        ...Object.fromEntries(headers.map((header, cellIndex) => [header, String(row[cellIndex] ?? "").trim()])),
        __sourceRowIndex: String(index + 2),
      })),
  };
}
