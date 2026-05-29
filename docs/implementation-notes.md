# ClosePilot AI Implementation Notes

## Product Positioning

ClosePilot AI is positioned as an AI Finance Operations Platform.

The core promise is:

**Upload your finance pack. ClosePilot finds risks, explains changes, and recommends actions.**

The entry wedge is finance pack review from uploaded exports. Month-end close is the first module, but the platform expands across cash, VAT, collections and controls.

## Built MVP Surface

- Finance Health Score with weighted components.
- Upload-to-review workspace narrative.
- Month-end close findings and recommendations.
- Cashflow intelligence with 30/60/90 day forecast.
- AR collections prioritisation and email action surface.
- AP risk and VAT review finding surfaces.
- Ask ClosePilot workflow with contextual answers.
- Practice portal for multi-company review.
- Assurance Engine view with tests executed, close readiness, confidence, layered review architecture and specialist agents.
- FastAPI modular-monolith scaffold with finance review, analysis and AI routes.
- Tenant-aware PostgreSQL schema.

## Monster Finance Intelligence Direction

ClosePilot should become a Continuous Finance Assurance platform, not a reporting tool.

Production engine sequence:

1. Data Integrity Engine
2. Finance Rules Engine
3. Statistical Detection
4. Finance Knowledge Graph
5. Explainability Layer
6. Multi-Agent Review
7. Human Approval

Implementation principle:

**Rules calculate. Statistics detect. AI explains. Humans approve.**

Near-term engineering work:

- Convert the current validation checks into a formal test-result model.
- Add a rule registry with rule id, category, inputs, severity, confidence and evidence output.
- Add statistical tests for z-scores, month-on-month movements, seasonality and trend breaks.
- Add relationship tables for customer, invoice, revenue, VAT and receipt links.
- Store every finding with calculation inputs, source rows, confidence and reviewer outcome.
- Run scheduled assurance jobs per tenant/company for daily or nightly monitoring.

## Next Production Steps

- Replace seeded demo data with persisted uploaded CSV/Excel analysis jobs.
- Add Supabase Auth JWT validation and tenant derivation.
- Persist uploads to S3 and jobs/findings to PostgreSQL.
- Add Celery workers for asynchronous analysis jobs.
- Connect OpenAI prompt library for narrative analysis.
- Add PDF board pack and Excel export generation.
- Add Xero, QuickBooks, Sage and Business Central connectors.
