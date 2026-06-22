# Synthetic Xero-style full pack

`demo-data/generate_xero_full_pack.py` creates deterministic finance exports for functional review and large-data testing. It contains no real client information.

## Generate packs

```bash
python3 demo-data/generate_xero_full_pack.py --preset pilot --zip
python3 demo-data/generate_xero_full_pack.py --preset large --zip
python3 demo-data/generate_xero_full_pack.py --preset million
```

Presets generate 5,000, 25,000, 100,000 or 1,000,000 VAT transaction rows plus AR, AP, bank, journal, payroll, fixed-asset and forecast records. Generated files are written below `demo-data/generated/` and excluded from Git.

## Pack contents

The generator creates 12 Xero-style CSV exports:

- trial balance;
- profit and loss;
- balance sheet;
- aged receivables;
- aged payables;
- VAT transactions;
- bank transactions;
- bank reconciliation;
- manual journals;
- payroll summary;
- fixed asset register; and
- cashflow forecast.

`expected-results.json` records row counts, file hashes, reconciliation controls and known exceptions. This is the test oracle for measuring recognition, mapping, rule recall, false positives and exposure accuracy.

## Deliberate exceptions

The pack includes AR/control mismatch, overdue debtor concentration, duplicate AP invoice, VAT/control mismatch, missing VAT codes, blocked entertainment VAT, bank reconciliation difference, suspense balance, weekend manual journal, unposted payroll and missing asset depreciation.

## Current product limit

The pilot upload endpoint currently accepts a combined 4 MB. The pilot preset can be used for functional review depending on generated size; large and million presets are intended for the resumable-upload/background-worker implementation and must not be used to claim current production capacity.

