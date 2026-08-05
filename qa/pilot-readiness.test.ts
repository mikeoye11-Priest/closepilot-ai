import test from "node:test";
import assert from "node:assert/strict";
import { pilotStatements } from "../apps/web/lib/data";
import { buildManagementAccounts, renderManagementAccountsHtml, ledgerPhrase, type SourceProvider } from "../apps/web/lib/management-accounts";
import { buildStatutoryAccounts, renderStatutoryAccountsHtml } from "../apps/web/lib/statutory-accounts";
import { buildCT600, renderCt600Html } from "../apps/web/lib/ct600";
import { renderIxbrl } from "../apps/web/lib/ixbrl";
import { checkInvariants } from "../apps/web/lib/invariants";

// Pilot-readiness gate. Proves the full accountant hand-over chain — the deliverables
// a pilot firm actually receives — builds, balances, cites the correct provider
// provenance, and passes the cross-module invariants, for EVERY connector a pilot
// might use. This is the automated half of the pilot runbook (PILOT_RUNBOOK.md).
//
// The live half (OAuth connect + real sync) can't run here — it needs each provider's
// sandbox and is driven by hand from the runbook. But once a sync lands, the report
// routes bind `sourceProvider` to the run's actual provider and feed these exact
// builders, so proving the chain per provider IS the readiness gate for everything
// downstream of a sync. The escaping of a provider label into a RegExp is defensive.

const escapeRe = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const PROVIDERS: { id: SourceProvider; label: string }[] = [
  { id: "xero", label: "Xero" },
  { id: "quickbooks", label: "QuickBooks" },
  { id: "sage", label: "Sage" },
  { id: "upload", label: "Upload" },
];

for (const provider of PROVIDERS) {
  const statements = { ...pilotStatements, sourceProvider: provider.id };
  const phrase = new RegExp(escapeRe(ledgerPhrase(provider.id)));

  test(`${provider.label}: management accounts build, balance and cite the right source`, () => {
    const ma = buildManagementAccounts(statements);
    assert.equal(ma.bs.totalEquity, ma.bs.netAssets, "management balance sheet balances");
    assert.ok(ma.pl.revenue > 0, "P&L has revenue");

    const html = renderManagementAccountsHtml(ma);
    assert.match(html, phrase, `pack names ${provider.label} as the source`);
    // The leak class we fixed: a QBO/Sage/upload pack must never claim to be Xero.
    if (provider.id !== "xero") assert.doesNotMatch(html, /the Xero ledger|maintained in Xero/);
  });

  test(`${provider.label}: statutory (FRS 102 1A) + full FRS 102 accounts build and balance`, () => {
    const stat = buildStatutoryAccounts(statements);
    assert.equal(stat.balanced, true, "FRS 102 1A statement of financial position balances");
    assert.equal(stat.hasComparatives, true, "prior-year comparatives present");

    const full = buildStatutoryAccounts(statements, { full: true });
    assert.equal(full.balanced, true, "full FRS 102 statement of financial position balances");

    const html = renderStatutoryAccountsHtml(stat);
    assert.match(html, phrase);
    if (provider.id !== "xero") assert.doesNotMatch(html, /the Xero ledger/);
  });

  test(`${provider.label}: draft CT600 renders principal boxes from the statutory pack`, () => {
    const pack = buildStatutoryAccounts(statements);
    const ct600 = buildCT600(pack, { companyNumber: "12345678", utr: "1234567890" });
    const html = renderCt600Html(ct600);
    assert.match(html, /CT600 \(draft\)/);
    assert.match(html, /Box 1 — Company name/);
    assert.match(html, /DRAFT — not for submission/, "the draft caveat is always present");
  });

  test(`${provider.label}: draft iXBRL renders valid inline-XBRL namespaces + tagged facts`, () => {
    const pack = buildStatutoryAccounts(statements);
    const xbrl = renderIxbrl(pack, "12345678");
    assert.match(xbrl, /xmlns:ix="http:\/\/www\.xbrl\.org\/2013\/inlineXBRL"/);
    assert.match(xbrl, /xmlns:xbrli="http:\/\/www\.xbrl\.org\/2003\/instance"/);
    assert.match(xbrl, /<ix:nonFraction /, "at least one tagged monetary fact");
    assert.match(xbrl, /12345678/, "the company number is threaded into the entity identifier");
  });

  test(`${provider.label}: cross-module invariants pass (no hard failures; balance + source green)`, () => {
    const report = checkInvariants({ statements });
    const fails = report.invariants.filter((i) => i.status === "fail");
    assert.equal(report.failed, 0, `no invariant may hard-fail: ${fails.map((i) => `${i.id} ${i.detail}`).join("; ")}`);

    const byId = Object.fromEntries(report.invariants.map((i) => [i.id, i]));
    assert.equal(byId["INV-01"].status, "pass", "INV-01: balance sheet balances");
    assert.equal(byId["INV-09"].status, "pass", `INV-09: figures attributed to ${provider.label}`);
  });
}

// One provider that is NOT wired for provenance must degrade safely, never claim Xero.
test("an unknown source degrades to a neutral 'connected ledger' phrase, never Xero", () => {
  const html = renderManagementAccountsHtml(buildManagementAccounts({ ...pilotStatements, sourceProvider: undefined }));
  assert.match(html, /the connected ledger/);
  assert.doesNotMatch(html, /the Xero ledger/);
});
