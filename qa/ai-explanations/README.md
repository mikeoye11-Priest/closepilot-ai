# ClosePilot AI Explanation Gate

This gate tests explanation quality independently from rule accuracy.

It checks:

- Grounding: required finding facts must appear in the explanation.
- Hallucination control: unsupported causes must not appear unless evidence supports them.
- Accounting consistency: generated wording must use the rule/finding facts as source of truth.
- Determinism: the same finding must produce the same explanation across 20 runs.

Add cases under:

- `vat/`
- `ar/`
- `ap/`
- `controls/`
- `month-end/`
- `audit-readiness/`

Run:

```bash
npm run test:ai-explanations
```
