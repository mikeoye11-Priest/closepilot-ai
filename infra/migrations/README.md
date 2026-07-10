# Database migrations

Tracked, idempotent SQL migrations for the Supabase Postgres database. This
directory exists because the legacy `infra/*.sql` files were applied to
production by hand and drifted (some only partially applied) — which silently
broke onboarding, the Xero integration and evidence persistence until caught.

## Run

```bash
npm run db:migrate
```

Reads the connection string from `SUPABASE_DB_URL` (or `.env.migrations.local`),
ensures the `schema_migrations` table exists, and applies any `NNNN_*.sql` file
here that hasn't been recorded yet — **each in its own transaction**. Re-running
is safe; already-applied files are skipped.

## Add a migration

1. Create `infra/migrations/NNNN_short_name.sql` using the next number.
2. Make it **idempotent** so re-running is harmless:
   - `create table if not exists …`
   - `create index if not exists …`
   - `drop policy if exists "…" on t;` before each `create policy`
   - `create or replace function …`
3. `npm run db:migrate`.

## Rules

- **Never edit an applied migration.** Add a new one instead.
- New schema changes go here, not in the legacy `infra/*.sql` files.
- `infra/schema.sql` and the other legacy `infra/*.sql` files remain as the
  historical baseline. `0001_backfill_missing_tables.sql` reconciles production
  with them (the 8 tables that never landed).

## Auditing drift

To confirm production matches the expected schema, compare the objects defined
in `infra/*.sql` against `information_schema` / `pg_proc` — the check that first
surfaced the drift. Run `npm run db:migrate`; a clean "Up to date" plus a green
app is the signal.
