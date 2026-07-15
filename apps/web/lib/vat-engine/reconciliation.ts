import type { VatBoxContribution, VatReconciliationResult, VatReturn, VatTransaction } from "./types";
import { fc } from "./utils";

export function reconcileVatReturn(vatReturn: VatReturn, vatControlBalance?: number, contributions: VatBoxContribution[] = [], transactions: VatTransaction[] = [], hmrcPayment?: number, plTurnover?: number): VatReconciliationResult[] {
  const results: VatReconciliationResult[] = [];

  results.push(boxCheck("Box 3 equals Box 1 + Box 2", vatReturn.box1 + vatReturn.box2, vatReturn.box3));
  results.push(boxCheck("Box 5 equals Box 3 - Box 4", vatReturn.box3 - vatReturn.box4, vatReturn.box5));

  // Box 6 (net outputs) should broadly agree with P&L turnover for the same
  // period. A gap is a review flag, not a hard fail (zero-rated/exempt income,
  // asset sales, or timing legitimately differ), so raise it as a warning with a
  // 2% (min £500) tolerance to catch material period/coding drift.
  if (plTurnover !== undefined && plTurnover > 0 && Math.abs(vatReturn.box6) > 0) {
    const tolerance = Math.max(500, Math.round(plTurnover * 0.02));
    results.push(boxCheck("Box 6 agrees to P&L turnover", Math.round(plTurnover), Math.abs(vatReturn.box6), tolerance, "warning"));
  }

  if (vatControlBalance !== undefined) {
    results.push(boxCheck("VAT return agrees to VAT control", Math.abs(vatControlBalance), Math.abs(vatReturn.box5), 1));
  }

  const box1Ledger = contributionTotal(contributions, "box1");
  if (box1Ledger > 0 || vatReturn.box1 > 0) {
    results.push(boxCheck("Box 1 agrees to output VAT ledger", box1Ledger, vatReturn.box1, 1));
  }

  const box4Ledger = contributionTotal(contributions, "box4");
  if (box4Ledger > 0 || vatReturn.box4 > 0) {
    results.push(boxCheck("Box 4 agrees to input VAT ledger", box4Ledger, vatReturn.box4, 1));
  }

  const pvaTransactions = transactions.filter((transaction) => transaction.treatment === "import_vat");
  if (pvaTransactions.length) {
    const expectedPvaVat = Math.round(pvaTransactions.reduce((sum, transaction) => sum + Math.abs(transaction.netAmount) * 0.2, 0));
    const pvaBoxVat = contributions.filter((item) => item.treatment === "import_vat" && (item.box === "box1" || item.box === "box4")).reduce((sum, item) => sum + Math.abs(item.amount), 0) / 2;
    results.push(boxCheck("PVA statement agrees to import VAT", expectedPvaVat, pvaBoxVat, 1));
  }

  if (hmrcPayment !== undefined) {
    results.push(boxCheck("HMRC payment agrees to VAT control", Math.abs(vatReturn.box5), Math.abs(hmrcPayment), 100));
  }

  return results;
}

function contributionTotal(contributions: VatBoxContribution[], box: keyof VatReturn) {
  return Math.round(contributions.filter((item) => item.box === box).reduce((sum, item) => sum + Math.abs(item.amount), 0));
}

function boxCheck(name: string, expected: number, actual: number, tolerance = 1, failStatus: "failed" | "warning" = "failed"): VatReconciliationResult {
  const difference = Math.abs(expected - actual);
  const passed = difference <= tolerance;
  return {
    name,
    status: passed ? "passed" : failStatus,
    expected,
    actual,
    difference,
    detail: passed
      ? `PASS: expected ${fc(expected)} agrees to actual ${fc(actual)}.`
      : `${failStatus === "warning" ? "REVIEW" : "FAIL"}: expected ${fc(expected)} vs actual ${fc(actual)}. Difference ${fc(difference)}.`,
  };
}
