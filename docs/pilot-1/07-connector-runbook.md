# Pilot 1 — Connector Readiness Runbook

The [60-minute walkthrough](06-walkthrough-script.md) covers the **upload** path.
This runbook covers the **live connector** path: connecting a real Xero, QuickBooks
or Sage Business Cloud company, syncing it, and producing the same review and
accounts deliverables — then disconnecting cleanly with no residual data.

Run it once **per provider** you intend to offer a pilot firm, against that
provider's **sandbox / demo company** — never a real client — before the firm
connects their own ledger. Each pass ends in a single **ready / not-ready**
verdict for that provider.

## What this pairs with

The deterministic half of readiness — that synced statements produce management
accounts, statutory FRS 102 accounts, a draft CT600 and draft iXBRL that all
balance and cite the correct source — is proven automatically:

```bash
npm run test:pilot-readiness
```

That gate runs the full deliverable chain for **Xero, QuickBooks, Sage and upload**
and must be green before this runbook is worth starting. This runbook proves the
part a test cannot: the live OAuth connection, the real sync, and clean teardown.

## Prerequisites (per provider)

- [ ] Provider app created and the env vars set in the target environment:
  - Xero — `XERO_CLIENT_ID`, `XERO_CLIENT_SECRET`, `XERO_REDIRECT_URI`
  - QuickBooks — `QUICKBOOKS_CLIENT_ID`, `QUICKBOOKS_CLIENT_SECRET`, `QUICKBOOKS_REDIRECT_URI`
  - Sage — `SAGE_CLIENT_ID`, `SAGE_CLIENT_SECRET`, `SAGE_REDIRECT_URI` (and `SAGE_COUNTRY` if not GB)
  - Shared — `INTEGRATION_ENCRYPTION_KEY` (token encryption), `NEXT_PUBLIC_SITE_URL` (HTTPS)
- [ ] Redirect URI registered with the provider is exactly `…/api/integrations/<provider>/callback`.
- [ ] A sandbox / demo company on the provider with a trial balance, P&L, balance
      sheet, aged debtors, aged creditors and (where available) VAT data.
- [ ] `npm run check:launch` passes for the environment.
- [ ] `npm run test:pilot-readiness` is green.

## A. Connect

1. Sign in as a pilot user. Open **Settings → Integrations**.
2. The provider card shows **Connect** (not "unavailable"). If it is unavailable,
   the env vars above are missing — fix before continuing.
3. Click **Connect**, complete the provider's OAuth consent, and select the
   sandbox company/organisation.
4. On return, the card shows the connected organisation name and a **Sync now** action.

- [ ] Consent completed and the correct sandbox organisation is shown.
- [ ] No error toast; the card reflects a live connection.

## B. Sync

1. Click **Sync now**. Wait for the run to complete (the card reports progress).
2. Confirm the completion message names **this provider** — e.g. "Synced from
   QuickBooks", not a generic or wrong-provider label.

- [ ] Sync completes without a re-authentication prompt.
- [ ] The completion message names the correct provider.
- [ ] Trial balance, P&L, balance sheet, aged debtors/creditors and (if present) VAT populate.

> If the sync returns a re-authentication error, the stored token is dead. Use
> **Disconnect**, then reconnect from step A — this is the expected recovery path.

## C. Review

1. Open **Finance Review** and **Findings**. Confirm findings are generated from
   the synced figures and each traces to source rows.
2. Open **VAT Assurance** (if the provider supplied VAT data) and confirm the VAT
   boxes reconcile to the control accounts.

- [ ] Findings render and are attributed to the synced ledger.
- [ ] VAT reconciliation is present where VAT data exists.
- [ ] No finding cites a different provider or "demo data".

## D. Accounts production

Open **Accounts** and, for each format, confirm the pack renders, **balances**, and
names **this provider** in its provenance wording ("prepared from the … ledger"):

1. **Management Accounts** — PDF (opens in a tab), Word (.doc), Excel (.xlsx).
2. **Financial Accounts (Statutory)** — the FRS 102 1A statements.
3. **CT600 (draft)** — principal boxes populated; the DRAFT caveat is shown.
4. **iXBRL (draft)** — downloads; open it and confirm it is well-formed inline XBRL.

- [ ] Every format opens/downloads without error.
- [ ] Net assets = capital & reserves on the balance sheet.
- [ ] The provenance wording names the **correct** provider (the leak class fixed in
      PRs #117–125 — a QuickBooks/Sage pack must never read "the Xero ledger").
- [ ] CT600 shows "DRAFT — not for submission"; iXBRL carries the `ix:`/`xbrli:` namespaces.

## E. Export the review pack

1. Open **Review Pack**. Export **Findings Schedule** (CSV) and **Evidence Archive** (JSON).
2. Confirm the client, period, findings and source agree with the on-screen review.

- [ ] CSV and JSON download and match the review.

## F. Disconnect + erase (no residue)

This is the teardown the fixes in PRs #117–125 hardened; verify it explicitly.

1. **Settings → Integrations →** the provider's **Disconnect**. It must succeed even
   if the token is expired.
2. Confirm the grant is revoked at the provider (ClosePilot no longer appears in the
   sandbox company's connected apps).
3. Reopen **Accounts**: with nothing connected and the review not yet erased, the
   preview still reflects the last review by design. Now use **Erase synced data**.
4. After erase, reopen **Accounts** — the preview must show the empty-state
   ("No accounts data found…"), **not** a stale pack.

- [ ] Disconnect succeeds and revokes the grant at the provider.
- [ ] Local connection row is removed (the card returns to **Connect**).
- [ ] After erase, no accounts preview, findings or VAT data resurrect (tombstone holds).
- [ ] Switching to another client and back does not resurrect the erased data.

## Provider verdict

Record one line per provider:

| Provider | Connect | Sync | Review | Accounts balance | Correct provenance | Export | Clean teardown | **Ready?** |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Xero | | | | | | | | |
| QuickBooks | | | | | | | | |
| Sage | | | | | | | | |

A provider is **ready** only when every column is ticked. Any gap is a pilot blocker
with a named owner and due date before that provider is offered to a firm.

## Notes

- **Sage revoke endpoint** (`…/token/revoke`) is built to the documented shape but
  should be confirmed against a live Sage sandbox on first disconnect; a failed
  revoke is logged and never blocks the local delete.
- **Sage 50 (desktop)** has no cloud API — those firms use the upload path in the
  [walkthrough](06-walkthrough-script.md), not this runbook.
- Do not connect a **real client** ledger until the connector verdict is ready **and**
  the compliance items in [`docs/compliance/`](../compliance/) are signed off.
