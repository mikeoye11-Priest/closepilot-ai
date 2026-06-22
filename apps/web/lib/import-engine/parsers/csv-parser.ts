import { normaliseColumnName } from "../mappings/aliases";

export interface ParsedRows {
  headers: string[];
  rows: Record<string, string>[];
}

export function parseCsv(text: string, delimiter?: string): ParsedRows {
  const detected = delimiter ?? (text.split(/\r?\n/)[0]?.includes("\t") ? "\t" : ",");
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const sourceHeaders = splitLine(lines[0] ?? "", detected);
  const headers = sourceHeaders.map(normaliseColumnName);
  const rows = lines.slice(1).map((line, index) => {
    const cells = splitLine(line, detected);
    return {
      ...Object.fromEntries(headers.map((header, cellIndex) => [header, cells[cellIndex]?.trim() ?? ""])),
      __sourceRowIndex: String(index + 2),
    };
  });
  return { headers, rows };
}

function splitLine(line: string, delimiter: string) {
  const result: string[] = [];
  let current = "";
  let quoted = false;
  for (const char of line) {
    if (char === "\"") {
      quoted = !quoted;
      continue;
    }
    if (char === delimiter && !quoted) {
      result.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  result.push(current);
  return result;
}
