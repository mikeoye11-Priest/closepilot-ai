import assert from "node:assert/strict";
import test from "node:test";
import { decryptIntegrationSecret, encryptIntegrationSecret } from "../../apps/web/lib/integrations/crypto";
import { xeroParsedFiles } from "../../apps/web/lib/integrations/xero-parsed-files";
import { canonicalVatCode, fetchXeroSyncData } from "../../apps/web/lib/integrations/xero-sync";
import { runVatEngine } from "../../apps/web/lib/vat-engine";

test("integration secrets use authenticated encryption", () => {
  process.env.INTEGRATION_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  const encrypted = encryptIntegrationSecret("refresh-token-value");
  assert.notEqual(encrypted, "refresh-token-value");
  assert.equal(decryptIntegrationSecret(encrypted), "refresh-token-value");
  const parts = encrypted.split(".");
  parts[2] = `${parts[2][0] === "A" ? "B" : "A"}${parts[2].slice(1)}`;
  assert.throws(() => decryptIntegrationSecret(parts.join(".")));
});

test("Xero responses map into ClosePilot trial balance and VAT evidence", async () => {
  const xero = {
    accountingApi: {
      getReportTrialBalance: async () => ({ body: { reports: [{ rows: [{ rows: [
        { cells: [{ value: "VAT Control", attributes: [{ id: "account", value: "2200" }] }, { value: "0" }, { value: "11718" }] },
        { cells: [{ value: "Bank", attributes: [{ id: "account", value: "1100" }] }, { value: "11718" }, { value: "0" }] },
      ] }] }] } }),
      getInvoices: async (_tenant: string, _since: Date | undefined, _where: undefined, _order: string, _ids: undefined, _numbers: undefined, _contacts: undefined, _statuses: string[], page: number) => ({ body: { invoices: page === 1 ? [
        { type: "ACCREC", date: "2026-04-03", invoiceNumber: "INV-1", contact: { name: "Atlas Ltd" }, lineItems: [{ description: "Sale", lineAmount: 1000, taxAmount: 200, taxType: "OUTPUT", accountCode: "4000" }] },
        { type: "ACCPAY", date: "2026-04-04", invoiceNumber: "BILL-1", contact: { name: "Google Ireland" }, lineItems: [{ description: "Cloud", lineAmount: 500, taxAmount: 0, taxType: "ECINPUTSERVICES", accountCode: "6000" }] },
      ] : [] } }),
      getJournals: async () => ({ body: { journals: [] } }),
      getBankTransactions: async () => ({ body: { bankTransactions: [] } }),
      getManualJournals: async () => ({ body: { manualJournals: [{ narration: "VAT control adjustment", date: "2026-04-30", manualJournalID: "MJ-1", journalLines: [{ description: "Manual VAT journal", lineAmount: 100, taxAmount: 20, taxType: "INPUT", accountCode: "2200" }] }] } }),
    },
  };
  const sync = await fetchXeroSyncData(xero as never, "xero-tenant", "2026-04-30");
  assert.equal(sync.trialBalanceRows.length, 2);
  assert.equal(sync.trialBalanceRows[0].account_code, "2200");
  assert.equal(sync.vatRows.length, 3);
  assert.equal(sync.vatRows[0].vat_code, "STD");
  assert.equal(sync.vatRows[1].vat_code, "RC");
  assert.match(sync.vatRows[2].description, /Manual journal/);

  const vatReview = runVatEngine(xeroParsedFiles(sync, "Xero Demo", "2026-04-30"));
  assert.equal(vatReview.source, "computed_transactions");
  assert.equal(vatReview.transactionsAnalysed, 3);
  assert.equal(vatReview.vatReturn.box1, 300);
});

test("Xero posted journals backfill VAT assurance when source transaction lines are empty", async () => {
  const xero = {
    accountingApi: {
      getReportTrialBalance: async () => ({ body: { reports: [{ rows: [{ rows: [
        { cells: [{ value: "VAT Control", attributes: [{ id: "account", value: "2200" }] }, { value: "0" }, { value: "300" }] },
      ] }] }] } }),
      getReportProfitAndLoss: async () => ({ body: { reports: [{ rows: [] }] } }),
      getReportBalanceSheet: async () => ({ body: { reports: [{ rows: [] }] } }),
      getReportBankSummary: async () => ({ body: { reports: [{ rows: [] }] } }),
      getInvoices: async () => ({ body: { invoices: [] } }),
      getCreditNotes: async () => ({ body: { creditNotes: [] } }),
      getBankTransactions: async () => ({ body: { bankTransactions: [] } }),
      getManualJournals: async () => ({ body: { manualJournals: [] } }),
      getJournals: async (_tenant: string, _since: Date | undefined, offset?: number) => ({ body: { journals: offset ? [] : [
        { journalID: "J-1", journalNumber: 42, journalDate: "2026-04-12", sourceType: "ACCREC", sourceID: "INV-J-1", journalLines: [
          { accountCode: "4000", accountName: "Sales", description: "Posted sale", netAmount: -1000, grossAmount: -1200, taxAmount: -200, taxType: "OUTPUT" },
        ] },
        { journalID: "J-2", journalNumber: 43, journalDate: "2026-04-15", sourceType: "ACCPAY", sourceID: "BILL-J-1", journalLines: [
          { accountCode: "6000", accountName: "Purchases", description: "Posted purchase", netAmount: 500, grossAmount: 600, taxAmount: 100, taxType: "INPUT" },
        ] },
      ] } }),
    },
  };

  const sync = await fetchXeroSyncData(xero as never, "xero-tenant", "2026-04-30");
  assert.equal(sync.vatRows.length, 2);
  assert.equal(sync.counts.journals, 2);
  assert.match(sync.warnings.join(" "), /posted Xero journal line/);

  const vatReview = runVatEngine(xeroParsedFiles(sync, "Xero Demo", "2026-04-30"));
  assert.equal(vatReview.source, "computed_transactions");
  assert.equal(vatReview.transactionsAnalysed, 2);
  assert.equal(vatReview.vatReturn.box1, 200);
  assert.equal(vatReview.vatReturn.box4, 100);
});

test("Xero tax types map to canonical ClosePilot VAT treatments", () => {
  assert.equal(canonicalVatCode("OUTPUT", "Sale"), "STD");
  assert.equal(canonicalVatCode("INPUT", "Purchase"), "PSTD");
  assert.equal(canonicalVatCode("ZERORATEDOUTPUT", "Sale"), "ZR");
  assert.equal(canonicalVatCode("EXEMPTOUTPUT", "Sale"), "EXEMPT");
  assert.equal(canonicalVatCode("POSTPONEDIMPORTVAT", "Purchase"), "PVA");
});
