# Pilot 1 Onboarding Guide

## Before the session

The pilot firm should nominate one partner, one manager and one preparer. Select a low-risk SME client whose review team understands the records and can judge whether a finding is correct.

Prepare exports for one agreed period:

- trial balance;
- profit and loss;
- balance sheet;
- aged debtors;
- aged creditors; and
- VAT return or VAT transaction detail.

CSV or XLSX is preferred. Keep original exports unchanged. Do not add formulas, delete exceptions or rename columns merely to make the files look cleaner.

Only provide data needed for the pilot. Remove unrelated personal data and supporting documents that are not required for the agreed review.

## Recommended columns

| File | Minimum useful fields |
|---|---|
| Trial balance | Account code, account name, balance; or debit and credit |
| Aged debtors | Customer, invoice/reference or account code, due date/age, amount |
| Aged creditors | Supplier, invoice/reference or account code, due date/age, amount |
| VAT detail | Date, VAT code, net amount, VAT amount |
| P&L / balance sheet | Account or line description, amount |

## First review

1. Sign in and verify the firm and client workspace.
2. Open **Upload Finance Pack**.
3. Upload the agreed exports together.
4. Review document recognition, row counts and mapping confidence.
5. Stop if a file is misclassified, a required field is unmapped or a validation gate is blocked.
6. Confirm valid mappings; do not override a warning without recording why.
7. Open **Finance Review** and compare the headline metrics with the source records.
8. Open **Assurance Engine** and inspect the highest-severity findings first.
9. For each sampled finding, inspect its source file, calculation and evidence rows.
10. Assign, request evidence, resolve, accept risk or mark false positive as appropriate.
11. Complete manager review and address any returned items.
12. Check the partner sign-off gates.
13. Export the review pack and compare it with the decisions made in ClosePilot.

## Stop conditions

Stop the pilot and contact ClosePilot if:

- the wrong client or another firm's data is visible;
- a file cannot be deleted when requested;
- totals materially differ from the source export without explanation;
- a finding has no traceable evidence;
- a user can bypass a required review or sign-off gate; or
- the service shows an access, security or data-loss concern.

## After the session

Complete the [feedback form](04-feedback-form.md). ClosePilot will return a written issue log classifying each item as a pilot blocker, defect, usability improvement or future feature.
