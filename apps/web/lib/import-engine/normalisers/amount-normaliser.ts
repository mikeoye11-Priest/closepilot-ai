export function parseAmount(raw: string | number | undefined | null): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const cleaned = String(raw)
    .trim()
    .replace(/[£$€,\s]/g, "")
    .replace(/^\((.*)\)$/, "-$1");
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseRequiredAmount(raw: string | number | undefined | null) {
  return parseAmount(raw) ?? 0;
}

export function parseDateValue(raw: string | undefined | null): Date | undefined {
  if (!raw) return undefined;
  const cleaned = raw.trim();
  const iso = new Date(cleaned);
  if (!Number.isNaN(iso.getTime())) return iso;

  const parts = cleaned.replace(/[/. ]/g, "-").split("-").map(Number);
  if (parts.length !== 3 || parts.some((part) => Number.isNaN(part))) return undefined;
  const [a, b, c] = parts;
  const year = a > 1900 ? a : c;
  const month = a > 1900 ? b : b;
  const day = a > 1900 ? c : a;
  const parsed = new Date(year, month - 1, day);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}
