# VAT Assurance V2 demo

Upload these two files together:

- `vat-assurance-v2-transactions.csv`
- `vat-assurance-v2-trial-balance.csv`
- `vat-assurance-v2-prior-transactions.csv`

The pack contains standard-rated sales and purchases, a reverse-charge service,
postponed import VAT, and zero-rated activity.

Expected VAT return:

| Box | Amount |
| --- | ---: |
| 1 | £19,992 |
| 2 | £0 |
| 3 | £19,992 |
| 4 | £8,274 |
| 5 | £11,718 |
| 6 | £89,960 |
| 7 | £43,370 |
| 8 | £0 |
| 9 | £0 |

Expected assurance outcome:

- Box arithmetic passes.
- Box 5 agrees to the VAT control account within £1.
- Boxes 1 and 4 agree to their transaction-level ledgers.
- Reverse charge contributes to Boxes 1, 4 and 7.
- PIVA contributes to Boxes 1, 4 and 7.
- A VAT Readiness score and `WP-02 VAT` workpaper are generated.
- Current Box 5 of £11,718 is compared with prior-period Box 5 of £9,500.
- The £2,218 increase (23.3%) remains below the 30% review threshold.
- Filing sign-off reports `Ready to Submit` when all other tests pass.

## Sign-off test

1. Open **VAT Assurance** and confirm the filing assessment is **Ready to Submit**.
2. Enter named preparer, reviewer and approver values.
3. Select **Approve Ready to File**.
4. Confirm the approval shows a SHA-256 snapshot hash, linked evidence count and locked status.
5. Export **Approved Snapshot JSON**.
6. To test reopening, enter a reason of at least 10 characters and select **Reopen VAT Review**. The original snapshot remains in the audit history.

## Accounting connectors

Settings now shows credential-safe Xero and QuickBooks connection states. Live OAuth
requires each provider's client ID, client secret and redirect URI to be supplied as
environment variables; secrets are never returned to the browser.
