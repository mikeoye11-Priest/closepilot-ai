// Customer concentration risk.
//
// How dependent is the business on a few customers? Measured on the aged-debtor
// balances (a proxy for revenue mix when per-customer revenue isn't available).
// Balances not matched to a named customer are held OUT of the customer analysis:
// if the book is largely unattributed, concentration cannot be reliably assessed
// (you can't identify "top customers" from unnamed balances), and the report says
// so rather than reporting the unattributed bucket as a customer.

type Row = Record<string, string>;

export type ConcentrationCustomer = { name: string; balance: number; share: number };
export type ConcentrationReport = {
  customers: ConcentrationCustomer[]; // attributed customers, share of the attributed total
  totalAr: number;
  attributedTotal: number;
  unattributed: number;
  unattributedShare: number; // of totalAr
  top1Share: number; // of attributed
  top3Share: number;
  hhi: number; // 0..10000 (higher = more concentrated)
  level: "low" | "moderate" | "high";
  attributable: boolean; // can concentration be assessed from named customers?
  available: boolean;
};

function numVal(value: unknown): number {
  const parsed = Number(String(value ?? "").replace(/[£$,\s]/g, "").replace(/^\((.*)\)$/, "-$1"));
  return Number.isFinite(parsed) ? parsed : 0;
}

// Matched to a real customer (not a placeholder / control bucket).
function isAttributed(name: string): boolean {
  const trimmed = name.trim();
  return trimmed.length > 0 && !/^(unattributed|unallocated|unmatched|various|sundry|other|misc(ellaneous)?|n\/?a|control)$/i.test(trimmed);
}

export function buildConcentration(statements: { agedDebtors?: Row[] }): ConcentrationReport {
  const byName = new Map<string, number>();
  let unattributed = 0;
  for (const row of statements.agedDebtors ?? []) {
    const name = String(row.customer ?? row.name ?? "").trim();
    const balance = Math.abs(numVal(row.amount));
    if (balance <= 0) continue;
    if (isAttributed(name)) byName.set(name, (byName.get(name) ?? 0) + balance);
    else unattributed += balance;
  }
  const attributedTotal = [...byName.values()].reduce((sum, value) => sum + value, 0);
  const totalAr = attributedTotal + unattributed;
  if (totalAr <= 0) {
    return { customers: [], totalAr: 0, attributedTotal: 0, unattributed: 0, unattributedShare: 0, top1Share: 0, top3Share: 0, hhi: 0, level: "low", attributable: false, available: false };
  }

  const customers = [...byName.entries()]
    .map(([name, balance]) => ({ name, balance, share: attributedTotal > 0 ? balance / attributedTotal : 0 }))
    .sort((a, b) => b.balance - a.balance);

  const top1Share = customers[0]?.share ?? 0;
  const top3Share = customers.slice(0, 3).reduce((sum, c) => sum + c.share, 0);
  const hhi = customers.reduce((sum, c) => sum + c.share * c.share, 0) * 10000;
  const unattributedShare = unattributed / totalAr;

  // Only assessable when a majority of the book is matched to named customers.
  const attributable = attributedTotal > 0 && unattributedShare <= 0.5;
  const level: ConcentrationReport["level"] = !attributable
    ? "low"
    : top1Share > 0.25 || top3Share > 0.6 || hhi > 2500 ? "high" : top1Share > 0.15 || hhi > 1500 ? "moderate" : "low";

  return { customers, totalAr, attributedTotal, unattributed, unattributedShare, top1Share, top3Share, hhi, level, attributable, available: true };
}
