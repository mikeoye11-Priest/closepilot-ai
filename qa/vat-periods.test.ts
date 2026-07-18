import test from "node:test";
import assert from "node:assert/strict";
import { recentVatPeriods, VAT_PERIOD_COUNTS } from "../apps/web/lib/vat-periods";

// Fixed reference date: 18 July 2026 (month index 6). Injected so the calendar
// maths is deterministic regardless of when the suite runs.
const NOW = new Date("2026-07-18T00:00:00Z");
const monthsBetween = (start: string, end: string) => {
  const s = new Date(start), e = new Date(end);
  return (e.getUTCFullYear() - s.getUTCFullYear()) * 12 + (e.getUTCMonth() - s.getUTCMonth());
};

test("counts and newest-first ordering hold for every frequency", () => {
  for (const freq of ["monthly", "bimonthly", "quarterly", "annual"] as const) {
    const periods = recentVatPeriods(freq, VAT_PERIOD_COUNTS[freq], NOW);
    assert.equal(periods.length, VAT_PERIOD_COUNTS[freq], `${freq} count`);
    const values = new Set(periods.map((p) => p.value));
    assert.equal(values.size, periods.length, `${freq} values unique`);
    for (let i = 1; i < periods.length; i += 1) {
      assert.ok(periods[i].start < periods[i - 1].start, `${freq} sorted newest-first`);
      assert.ok(periods[i].start <= periods[i].end, `${freq} start <= end`);
    }
    // value encodes the range as start_end
    assert.equal(periods[0].value, `${periods[0].start}_${periods[0].end}`);
  }
});

test("monthly periods are whole calendar months, current month first", () => {
  const m = recentVatPeriods("monthly", 24, NOW);
  assert.deepEqual({ label: m[0].label, start: m[0].start, end: m[0].end }, { label: "Jul 2026", start: "2026-07-01", end: "2026-07-31" });
  assert.equal(m[1].label, "Jun 2026");
  // Crossing a year boundary: the 7th month back from July 2026 is January 2026,
  // then December 2025.
  assert.equal(m[6].label, "Jan 2026");
  assert.deepEqual({ label: m[7].label, start: m[7].start, end: m[7].end }, { label: "Dec 2025", start: "2025-12-01", end: "2025-12-31" });
  for (const p of m) assert.equal(monthsBetween(p.start, p.end), 0, "one calendar month");
});

test("bi-monthly periods span two calendar-aligned months and never cross a year", () => {
  const b = recentVatPeriods("bimonthly", 12, NOW);
  assert.deepEqual({ label: b[0].label, start: b[0].start, end: b[0].end }, { label: "Jul–Aug 2026", start: "2026-07-01", end: "2026-08-31" });
  assert.equal(b[1].label, "May–Jun 2026");
  for (const p of b) {
    assert.equal(monthsBetween(p.start, p.end), 1, "two calendar months");
    assert.equal(p.start.slice(0, 4), p.end.slice(0, 4), "same year");
  }
});

test("quarterly periods are calendar quarters (matches the prior quarter selector)", () => {
  const q = recentVatPeriods("quarterly", 8, NOW);
  assert.deepEqual({ label: q[0].label, start: q[0].start, end: q[0].end }, { label: "Jul–Sep 2026", start: "2026-07-01", end: "2026-09-30" });
  assert.equal(q[1].label, "Apr–Jun 2026");
  assert.equal(q[2].label, "Jan–Mar 2026");
  assert.equal(q[3].label, "Oct–Dec 2025");
  for (const p of q) assert.equal(monthsBetween(p.start, p.end), 2, "three calendar months");
});

test("annual periods are whole calendar years, newest first", () => {
  const a = recentVatPeriods("annual", 4, NOW);
  assert.deepEqual(a.map((p) => p.label), ["2026", "2025", "2024", "2023"]);
  assert.deepEqual({ start: a[0].start, end: a[0].end }, { start: "2026-01-01", end: "2026-12-31" });
});
