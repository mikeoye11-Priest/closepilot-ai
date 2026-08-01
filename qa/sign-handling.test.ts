import test from "node:test";
import assert from "node:assert/strict";
import { signedNumber } from "../apps/web/lib/num";
import { buildManagementAccounts, type SyncStatements } from "../apps/web/lib/management-accounts";
import { checkInvariants } from "../apps/web/lib/invariants";

test("signedNumber handles the sign conventions accounting exports use", () => {
  assert.equal(signedNumber("1234"), 1234);
  assert.equal(signedNumber("£1,234.50"), 1234.5);
  assert.equal(signedNumber("(1,234)"), -1234, "parentheses = negative");
  assert.equal(signedNumber("1234-"), -1234, "trailing minus = negative");
  assert.equal(signedNumber("−1234"), -1234, "unicode minus = negative");
  assert.equal(signedNumber("1,234.00 CR"), -1234, "credit = negative");
  assert.equal(signedNumber("1,234.00 DR"), 1234, "debit = positive");
  assert.equal(signedNumber("196000CR"), -196000);
  assert.equal(signedNumber(""), 0);
  assert.equal(signedNumber("n/a"), 0, "unparseable → 0, never NaN");
  assert.equal(signedNumber(-42), -42);
});

const bs = (balanceSheet: SyncStatements["balanceSheet"]): SyncStatements => ({
  asOfDate: "2026-05-31", profitLoss: [], balanceSheet, agedDebtors: [], agedCreditors: [], bank: [], trialBalance: [],
});

test("a credit-signed balance sheet (liabilities/equity negative) reconciles after normalisation", () => {
  const pack = buildManagementAccounts(bs([
    { category: "Fixed Assets", item: "Plant", amount: "500000" },
    { category: "Current Assets", item: "Cash at bank", amount: "100000" },
    { category: "Current Liabilities", item: "Trade creditors", amount: "-200000" }, // credit-signed
    { category: "Capital and reserves", item: "Retained earnings", amount: "-400000" }, // credit-signed
  ]));
  assert.equal(pack.bs.totalLiabilities, 200000, "liabilities normalised to a positive magnitude");
  assert.equal(pack.bs.totalEquity, 400000, "equity normalised to a positive magnitude");
  assert.equal(pack.bs.netAssets, 400000);
  assert.equal(pack.bs.netAssets, pack.bs.totalEquity, "accounting equation holds");
  assert.equal(checkInvariants({ statements: bs([
    { category: "Fixed Assets", item: "Plant", amount: "500000" },
    { category: "Current Assets", item: "Cash at bank", amount: "100000" },
    { category: "Current Liabilities", item: "Trade creditors", amount: "-200000" },
    { category: "Capital and reserves", item: "Retained earnings", amount: "-400000" },
  ]) }).invariants.find((i) => i.id === "INV-01")?.status, "pass");
});

test("genuine negative equity is preserved when liabilities are positive-signed", () => {
  const pack = buildManagementAccounts(bs([
    { category: "Current Assets", item: "Cash at bank", amount: "100000" },
    { category: "Current Liabilities", item: "Trade creditors", amount: "300000" }, // positive convention
    { category: "Capital and reserves", item: "Retained earnings", amount: "-200000" }, // real accumulated losses
  ]));
  assert.equal(pack.bs.totalLiabilities, 300000);
  assert.equal(pack.bs.totalEquity, -200000, "negative equity is NOT flipped away");
  assert.equal(pack.bs.netAssets, -200000);
  assert.equal(pack.bs.netAssets, pack.bs.totalEquity, "equation holds with negative equity");
});

test("a CR-suffixed liability parses to the right sign and still reconciles", () => {
  const pack = buildManagementAccounts(bs([
    { category: "Current Assets", item: "Cash at bank", amount: "100000" },
    { category: "Current Liabilities", item: "Trade creditors", amount: "60,000 CR" }, // credit-signed via CR
    { category: "Capital and reserves", item: "Retained earnings", amount: "40,000 CR" },
  ]));
  assert.equal(pack.bs.totalLiabilities, 60000);
  assert.equal(pack.bs.totalEquity, 40000);
  assert.equal(pack.bs.netAssets, pack.bs.totalEquity);
});
