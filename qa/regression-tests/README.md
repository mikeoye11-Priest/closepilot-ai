# ClosePilot Finance Regression Testing

This harness checks whole finance packs against expected business outcomes.

It is intentionally broader than rule validation:

- Import recognition and mapping quality
- Import gate pass/block status
- Trial balance validation accuracy
- Known-error finding coverage
- False-positive leakage
- VAT box calculations
- Pilot readiness and core quality metrics

Run it with:

```sh
npm run test:finance-regression
```

Datasets live in `qa/datasets/*/dataset.json`.
Expected outcomes live in `qa/expected-results/*.json`.
