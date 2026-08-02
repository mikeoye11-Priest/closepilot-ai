// Cross-module invariants — the guardrails from the product review (§3.3).
//
// These encode the reconciliations that MUST hold across the canonical layer, so
// contradictions become automated, visible failures rather than silent numbers.
// A `fail` is a hard integrity breach (signs, duplication, coverage overmatch);
// a `review` is a reconciliation that needs an explicit bridge (e.g. profit to
// reserves via distributions) before reliance.

import { buildManagementAccounts, type SyncStatements } from "./management-accounts";
import { num } from "./cashflow-13week";
import type { DebtorLedger } from "./debtor-ledger";
import { buildFindingLedger } from "./finding-ledger";
import type { Finding } from "./types";

export type InvariantStatus = "pass" | "review" | "fail" | "not_applicable";
export type InvariantCategory = "accounts" | "debtors" | "evidence" | "findings" | "source";

const PROVIDER_LABELS: Record<string, string> = { xero: "Xero", quickbooks: "QuickBooks", sage: "Sage", upload: "Upload", demo: "Demo data" };
export type Invariant = { id: string; name: string; category: InvariantCategory; status: InvariantStatus; detail: string };
export type InvariantReport = { invariants: Invariant[]; passed: number; review: number; failed: number };

const TOLERANCE = 1;
const gbp = (value: number) => `${value < 0 ? "−£" : "£"}${Math.abs(Math.round(value)).toLocaleString("en-GB")}`;

type Section = { lines: Array<{ name: string; amount: number }> };
const lineSum = (sections: Section[], re: RegExp): number =>
  sections.flatMap((s) => s.lines).filter((l) => re.test(l.name)).reduce((sum, l) => sum + Math.abs(l.amount), 0);

export type InvariantInputs = {
  statements?: SyncStatements;
  debtorLedger?: DebtorLedger;
  coverage?: { sourceLinked: number; totalExposure: number };
  findings?: Finding[];
};

export function checkInvariants(input: InvariantInputs): InvariantReport {
  const invariants: Invariant[] = [];
  const add = (id: string, name: string, category: InvariantCategory, status: InvariantStatus, detail: string) => invariants.push({ id, name, category, status, detail });

  if (input.statements) {
    const pack = buildManagementAccounts(input.statements);
    const bs = pack.bs;

    // INV-09 — figures are attributed to a single known source (provenance
    // binding), so multi-provider data never blends silently or lands unattributed.
    const provider = input.statements.sourceProvider;
    const known = provider ? provider in PROVIDER_LABELS : false;
    add("INV-09", "Figures are attributed to a known source", "source",
      known ? "pass" : "review",
      known ? `Source: ${PROVIDER_LABELS[provider!]}.` : "Source not attributed — confirm which connector or upload produced these figures.");

    // INV-01 — balance sheet balances with SIGNED equity (catches negative-equity
    // sign errors that report a balanced sheet as out of balance).
    const bsDiff = Math.round(bs.netAssets - bs.totalEquity);
    add("INV-01", "Balance sheet balances (assets − liabilities = signed equity)", "accounts",
      Math.abs(bsDiff) <= TOLERANCE ? "pass" : "fail",
      Math.abs(bsDiff) <= TOLERANCE ? `Net assets ${gbp(bs.netAssets)} = capital & reserves ${gbp(bs.totalEquity)}` : `Out of balance by ${gbp(bsDiff)} — check the sign handling of negative equity / net assets.`);

    // INV-02 — P&L profit reconciles to the reserves (equity) movement via the
    // Statement of Changes in Equity: opening + profit + distributions + capital =
    // closing. A residual is a movement not yet modelled and needs confirming.
    const eq = pack.equity;
    if (eq.hasComparatives) {
      const reconciledDetail = `Opening reserves ${gbp(eq.opening)} + profit ${gbp(eq.profit)}${eq.distributions ? ` ${eq.distributions < 0 ? "−" : "+"} distributions ${gbp(Math.abs(eq.distributions))}` : ""}${eq.capital ? ` + capital ${gbp(eq.capital)}` : ""}${eq.other ? ` + other ${gbp(eq.other)}` : ""} = closing reserves ${gbp(eq.actualClosing)}`;
      add("INV-02", "P&L profit reconciles to the reserves movement", "accounts",
        eq.reconciled ? "pass" : "review",
        eq.reconciled
          ? reconciledDetail
          : `${gbp(Math.abs(eq.residual))} of the reserves movement is not explained by profit ${gbp(eq.profit)} and modelled distributions / capital — confirm the equity movements to reconcile.`);
    }

    // INV-04 — TB trade creditors agree to the aged creditors report.
    const agedCreditors = (input.statements.agedCreditors ?? []).reduce((sum, r) => sum + Math.abs(num((r as Record<string, string>).amount)), 0);
    const bsTradeCreditors = lineSum(bs.liabilities as Section[], /trade\s*(creditor|payable)/i);
    if (agedCreditors > 0 && bsTradeCreditors > 0) {
      const diff = Math.round(bsTradeCreditors - agedCreditors);
      add("INV-04", "TB creditors = aged creditors (+ explained difference)", "accounts",
        Math.abs(diff) <= TOLERANCE ? "pass" : "review",
        Math.abs(diff) <= TOLERANCE ? `Trade creditors ${gbp(bsTradeCreditors)} = aged ${gbp(agedCreditors)}` : `Trade creditors ${gbp(bsTradeCreditors)} vs aged ${gbp(agedCreditors)} differ by ${gbp(diff)} — explain the difference.`);
    }

    // INV-06 — ledger bank cash agrees to the balance-sheet cash line.
    const bankCash = (input.statements.bank ?? []).reduce((sum, r) => sum + num((r as Record<string, string>).closing_balance), 0);
    const bsCash = lineSum(bs.currentAssets as Section[], /cash|bank/i);
    if ((input.statements.bank?.length ?? 0) > 0 && bsCash > 0) {
      const diff = Math.round(bankCash - bsCash);
      add("INV-06", "Bank cash agrees to the balance sheet", "accounts",
        Math.abs(diff) <= TOLERANCE ? "pass" : "fail",
        Math.abs(diff) <= TOLERANCE ? `Bank ${gbp(bankCash)} = balance-sheet cash ${gbp(bsCash)}` : `Bank ${gbp(bankCash)} vs balance-sheet cash ${gbp(bsCash)} differ by ${gbp(diff)}.`);
    }
  }

  if (input.debtorLedger) {
    const b = input.debtorLedger.bridge;
    // INV-03 — TB debtors agree to the aged debtors report.
    if (b.tbControl != null) {
      add("INV-03", "TB debtors = aged debtors (+ explained difference)", "debtors",
        b.reconciled ? "pass" : "review",
        b.reconciled ? `TB ${gbp(b.tbControl)} = aged ${gbp(b.agedTotal)}` : `TB ${gbp(b.tbControl)} vs aged ${gbp(b.agedTotal)} differ by ${gbp(b.difference ?? 0)} — explain the difference.`);
    }
    // INV-05 — one invoice contributes its balance once (no duplicate exposure).
    add("INV-05", "One invoice contributes to exposure once", "debtors",
      b.duplicatesExcluded === 0 ? "pass" : "fail",
      b.duplicatesExcluded === 0 ? "No duplicate receivables detected." : `${gbp(b.duplicatesExcluded)} duplicate balance excluded — resolve the reconciliation exceptions.`);
  }

  if (input.coverage) {
    // INV-07 — evidence coverage is capped at 100%; an overmatch is an exception.
    const overmatch = Math.max(0, input.coverage.sourceLinked - input.coverage.totalExposure);
    add("INV-07", "Evidence coverage ≤ 100% (overmatches are exceptions)", "evidence",
      overmatch <= TOLERANCE ? "pass" : "fail",
      overmatch <= TOLERANCE ? "Coverage within 100%." : `${gbp(overmatch)} of evidence exceeds the exposure — reconcile the overmatch.`);
  }

  if (input.findings) {
    // INV-08 — one issue counts once. The active finding set must carry no
    // canonical duplicates (an issue surfaced by several rules), mirroring INV-05
    // for receivables. Duplicates skew the score, counts and cash-at-risk.
    const ledger = buildFindingLedger(input.findings);
    add("INV-08", "One issue counts once (no duplicate findings)", "findings",
      ledger.duplicatesExcluded === 0 ? "pass" : "review",
      ledger.duplicatesExcluded === 0
        ? `${ledger.unique.length} distinct finding(s); no duplicates.`
        : `${ledger.duplicatesExcluded} duplicate finding(s) collapsed — the raw set counts an issue more than once.`);
  }

  return {
    invariants,
    passed: invariants.filter((i) => i.status === "pass").length,
    review: invariants.filter((i) => i.status === "review").length,
    failed: invariants.filter((i) => i.status === "fail").length,
  };
}
