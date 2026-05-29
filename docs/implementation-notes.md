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
- FastAPI modular-monolith scaffold with finance review, analysis and AI routes.
- Tenant-aware PostgreSQL schema.

## Next Production Steps

- Replace seeded data with uploaded CSV/Excel parsers.
- Add Supabase Auth JWT validation and tenant derivation.
- Persist uploads to S3 and jobs/findings to PostgreSQL.
- Add Celery workers for asynchronous analysis jobs.
- Connect OpenAI prompt library for narrative analysis.
- Add PDF board pack and Excel export generation.
- Add Xero, QuickBooks, Sage and Business Central connectors.
