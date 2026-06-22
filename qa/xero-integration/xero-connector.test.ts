import assert from "node:assert/strict";
import test from "node:test";
import { decryptIntegrationSecret, encryptIntegrationSecret } from "../../apps/web/lib/integrations/crypto";
import { canonicalVatCode, fetchXeroSyncData } from "../../apps/web/lib/integrations/xero-sync";

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
});

test("Xero tax types map to canonical ClosePilot VAT treatments", () => {
  assert.equal(canonicalVatCode("OUTPUT", "Sale"), "STD");
  assert.equal(canonicalVatCode("INPUT", "Purchase"), "PSTD");
  assert.equal(canonicalVatCode("ZERORATEDOUTPUT", "Sale"), "ZR");
  assert.equal(canonicalVatCode("EXEMPTOUTPUT", "Sale"), "EXEMPT");
  assert.equal(canonicalVatCode("POSTPONEDIMPORTVAT", "Purchase"), "PVA");
});
