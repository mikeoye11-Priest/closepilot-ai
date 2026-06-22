# Import & Normalisation Engine

This package turns firm-specific exports into canonical ClosePilot finance
models before validation and rule execution.

Pipeline:

```text
Raw File
  -> recogniser
  -> parser
  -> mapper
  -> canonical model
  -> validator
  -> rule engine
```

V1 supports:

- Trial balance
  - signed balance column
  - separate debit/credit columns
- Aged debtors
- Aged creditors
- VAT transactions

Key contract:

Rules should consume canonical data, not source-system column names.

Recognition now lives in this package too. Upload routes call
`recogniseFinanceDocument` to classify messy exports before parsing and
normalisation. Detection considers:

- filename and sheet-name hints
- canonicalised headers
- row-level text signals
- vendor-specific export patterns

If confidence is low or validation fails, the import gate should pause rule
execution until a reviewer confirms the mapping.

The first production integration is the trial-balance validation in
`upload-analysis.ts`, which now validates TB balancing through canonical
normalisation instead of ad hoc debit/credit logic.
