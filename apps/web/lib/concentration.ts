// Customer concentration risk.
//
// How dependent is the business on a few customers? Measured on the aged-debtor
// balances (a proxy for revenue mix when per-customer revenue isn't available).
// Balances not matched to a named customer are held OUT of the customer analysis:
// if the book is largely unattributed, concentration cannot be reliably assessed
// (you can't identify "top customers" from unnamed balances), and the report says
// so rather than reporting the unattributed bucket as a customer.
//
// Reads the CANONICAL de-duplicated receivable population (one invoice once), so a
// duplicated aged line can't inflate a customer's share and totalAr reconciles to
// debtorExposure().exposure.

import { canonicalReceivables, type DebtorLedger } from "./debtor-ledger";

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

// Accepts a pre-built canonical ledger (so one ledger drives the whole screen) or
// falls back to building it from the statements' aged debtors. Either way the
// analysis runs on the de-duplicated unique receivables.
export function buildConcentration(statements: { agedDebtors?: Row[] }, ledger?: DebtorLedger): ConcentrationReport {
  const byName = new Map<string, number>();
  let unattributed = 0;
  const receivables = canonicalReceivables(ledger ?? { agedDebtors: statements.agedDebtors });
  for (const r of receivables) {
    const balance = Math.abs(r.amount);
    if (balance <= 0) continue;
    if (r.attributed) byName.set(r.name, (byName.get(r.name) ?? 0) + balance);
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
