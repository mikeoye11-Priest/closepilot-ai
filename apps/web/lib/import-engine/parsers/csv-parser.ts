import { normaliseColumnName } from "../mappings/aliases";
import { parseDelimitedRecords } from "../../delimited-parser";

export interface ParsedRows {
  headers: string[];
  rows: Record<string, string>[];
}

export function parseCsv(text: string, delimiter?: string): ParsedRows {
  const records = parseDelimitedRecords(text, delimiter);
  const sourceHeaders = records[0] ?? [];
  const headers = sourceHeaders.map(normaliseColumnName);
  const rows = records.slice(1).map((cells, index) => {
    return {
      ...Object.fromEntries(headers.map((header, cellIndex) => [header, cells[cellIndex]?.trim() ?? ""])),
      __sourceRowIndex: String(index + 2),
    };
  });
  return { headers, rows };
}
