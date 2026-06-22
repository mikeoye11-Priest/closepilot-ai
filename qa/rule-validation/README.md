# ClosePilot Rule Validation Harness

This harness protects trust-critical finance logic before pilot releases.

It validates the full shape accountants care about:

1. Import format
2. Normalisation
3. Calculation
4. Rule trigger
5. Finding expectation
6. False-positive expectation

Run it with:

```bash
npm run test:rules
```

To validate the same cases against actual ClosePilot analyzer output, run a web
server and then:

```bash
CLOSEPILOT_RULE_ENGINE_URL=http://127.0.0.1:3004 npm run test:rules:engine
```

The engine-backed mode posts each synthetic dataset to `/api/analyse-upload` and
checks the returned validation checks and findings. Use `engineRuleIds`,
`engineTitleIncludes`, `engineForbiddenTitleIncludes`, and
`expectedValidationChecks` in `cases.json` when production rule IDs differ from
the focused harness IDs.

The release gate is:

- Rule Accuracy >= 95%
- False Positive Rate <= 5%
- Critical Rule Coverage = 100%
- VAT Coverage = 100%

Current dataset groups:

- `clean-packs`: clean finance data should produce no findings.
- `known-errors`: deliberate material errors must trigger expected findings.
- `false-positives`: legitimate accounting patterns must not trigger findings.
- `edge-cases`: import and normalisation variants such as signed balances vs separate debit/credit columns.

Add new cases to `cases.json`. Every case should declare:

- `files`: synthetic finance rows grouped by file type.
- `expectedFindings`: rule IDs that must appear.
- `forbiddenFindings`: rule IDs that must not appear.
