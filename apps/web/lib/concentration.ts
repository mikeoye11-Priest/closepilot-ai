// Customer concentration risk.
//
// How dependent is the business on a few customers? Measured on the aged-debtor
// balances (a proxy for revenue mix when per-customer revenue isn't available):
// each customer's share of receivables, the top-1/top-3 shares, and the
// Herfindahl-Hirschman Index (HHI) — a standard concentration measure.

type Row = Record<string, string>;

export type ConcentrationCustomer = { name: string; balance: number; share: number };
export type ConcentrationReport = {
  customers: ConcentrationCustomer[]; // sorted high → low
  totalAr: number;
  top1Share: number;
  top3Share: number;
  hhi: number; // 0..10000 (higher = more concentrated)
  level: "low" | "moderate" | "high";
  available: boolean;
};

function numVal(value: unknown): number {
  const parsed = Number(String(value ?? "").replace(/[£$,\s]/g, "").replace(/^\((.*)\)$/, "-$1"));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function buildConcentration(statements: { agedDebtors?: Row[] }): ConcentrationReport {
  const byName = new Map<string, number>();
  for (const row of statements.agedDebtors ?? []) {
    const name = String(row.customer ?? row.name ?? "").trim() || "Unattributed";
    const balance = Math.abs(numVal(row.amount));
    if (balance <= 0) continue;
    byName.set(name, (byName.get(name) ?? 0) + balance);
  }
  const totalAr = [...byName.values()].reduce((sum, value) => sum + value, 0);
  if (totalAr <= 0) {
    return { customers: [], totalAr: 0, top1Share: 0, top3Share: 0, hhi: 0, level: "low", available: false };
  }

  const customers = [...byName.entries()]
    .map(([name, balance]) => ({ name, balance, share: balance / totalAr }))
    .sort((a, b) => b.balance - a.balance);

  const top1Share = customers[0]?.share ?? 0;
  const top3Share = customers.slice(0, 3).reduce((sum, c) => sum + c.share, 0);
  const hhi = customers.reduce((sum, c) => sum + c.share * c.share, 0) * 10000;

  const level: ConcentrationReport["level"] =
    top1Share > 0.25 || top3Share > 0.6 || hhi > 2500 ? "high" : top1Share > 0.15 || hhi > 1500 ? "moderate" : "low";

  return { customers, totalAr, top1Share, top3Share, hhi, level, available: true };
}
