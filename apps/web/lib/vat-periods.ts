// Selectable VAT return periods for scoping a Xero sync to an exact HMRC return
// window. UK VAT returns can be filed monthly, bi-monthly (rare), quarterly (the
// common default) or annually (the Annual Accounting Scheme). The Xero sync
// accepts any start/end date range, so these helpers just enumerate recent
// calendar-aligned periods of the chosen frequency, newest first. Calendar
// alignment (blocks counted from January) is a deterministic default; companies
// on a non-calendar stagger confirm the exact dates before filing.

export type VatFrequency = "monthly" | "bimonthly" | "quarterly" | "annual";
export type VatPeriod = { value: string; label: string; start: string; end: string };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// How many recent periods to offer per frequency (≈ two years of history each).
export const VAT_PERIOD_COUNTS: Record<VatFrequency, number> = { monthly: 24, bimonthly: 12, quarterly: 8, annual: 4 };

const iso = (year: number, month: number, day: number) => new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10);
// Day 0 of the following month is the last day of month `month`.
const lastDayOfMonth = (year: number, month: number) => iso(year, month + 1, 0);

// The most recent `count` VAT return periods of the given frequency, newest
// first. The current (possibly incomplete) period is included — evidence is
// simply empty for any part of it that has not yet occurred. `now` is injectable
// for deterministic testing.
export function recentVatPeriods(frequency: VatFrequency, count = VAT_PERIOD_COUNTS[frequency], now = new Date()): VatPeriod[] {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const periods: VatPeriod[] = [];

  if (frequency === "annual") {
    for (let i = 0; i < count; i += 1) {
      const y = year - i;
      const start = iso(y, 0, 1);
      const end = iso(y, 11, 31);
      periods.push({ value: `${start}_${end}`, label: `${y}`, start, end });
    }
    return periods;
  }

  const span = frequency === "monthly" ? 1 : frequency === "bimonthly" ? 2 : 3;
  // Absolute month index (year*12 + month) snapped down to the block boundary, so
  // blocks are aligned to January. 12 is divisible by 1/2/3, so no period ever
  // straddles a year boundary.
  let blockStart = Math.floor((year * 12 + month) / span) * span;
  for (let i = 0; i < count; i += 1) {
    const blockEnd = blockStart + span - 1;
    const sYear = Math.floor(blockStart / 12);
    const sMonth = blockStart % 12;
    const eYear = Math.floor(blockEnd / 12);
    const eMonth = blockEnd % 12;
    const start = iso(sYear, sMonth, 1);
    const end = lastDayOfMonth(eYear, eMonth);
    const label = span === 1 ? `${MONTHS[sMonth]} ${sYear}` : `${MONTHS[sMonth]}–${MONTHS[eMonth]} ${eYear === sYear ? eYear : `${sYear}/${eYear}`}`;
    periods.push({ value: `${start}_${end}`, label, start, end });
    blockStart -= span;
  }
  return periods;
}
