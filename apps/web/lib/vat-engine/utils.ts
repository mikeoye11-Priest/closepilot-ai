export function text(row: Record<string, string>, keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return "";
}

export function money(raw: string | number | undefined) {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : 0;
  if (!raw) return 0;
  const cleaned = String(raw).replace(/[£$€,\s]/g, "").replace(/^\((.*)\)$/, "-$1");
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function roundPounds(value: number) {
  return Math.round(value);
}

export function fc(value: number) {
  return `£${Math.round(Math.abs(value)).toLocaleString("en-GB")}`;
}

export function rowText(row: Record<string, string>) {
  return Object.values(row).join(" ");
}
