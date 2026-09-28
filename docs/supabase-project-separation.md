# Separating ClosePilot onto its own Supabase project

**Status:** plan, not yet done. Written after proving the schema rebuilds from
source on a clean Postgres.

## Why

ClosePilot shares a Supabase project — and therefore one Postgres database —
with another product (MissionLedger). Thirteen of its tables sit in the same
`public` schema as `findings` and `company_snapshots`: `organisations`,
`organisation_memberships`, `organisation_invites`, `recognition_packs`,
`award_categories`, `certificate_exports`, `shared_certificates`,
`signatories`, `pack_items`, `profiles`, `accounts`, `template_favourites`.

**Row level security does not help here.** RLS protects users from each other.
The other product holds its own service-role key against this database, and a
service-role key bypasses every policy. So that product's code — and anyone who
compromises it — can read every ClosePilot table, including a firm's findings,
evidence and trial balances.

A firm's DPA review will ask where their client data lives and who else can
reach it. "Alongside an unrelated product, reachable by its credentials" is a
hard answer to give, and harder to remediate once the data is real.

## Why now

Separation costs almost nothing today and a great deal later:

| | Today | After the first real client upload |
|---|---|---|
| tenants | 8 (mostly test duplicates) | a firm's real structure |
| companies | 8 | real clients |
| uploads | 3 | real trial balances, ledgers, VAT |
| findings | **0** | the review record |
| reports | **0** | signed-off deliverables |

There is nothing of value to migrate right now. Later there is client financial
data, a live pilot, and a compliance story attached to moving it.

## What the rebuild test proved

Replaying the repository's SQL onto an empty Postgres 18 (with stubs for
Supabase's `auth` schema, `auth.uid()` and the `anon`/`authenticated`/
`service_role` roles):

- **All 11 migrations applied cleanly**, in order, with no failures.
- The result was **28 tables — exactly ClosePilot's, none missing, none extra**.
  The 13 tables that did not appear are the other product's, which confirms by
  evidence rather than inference that they are foreign.
- It surfaced a real defect: `users` and `tenants` had RLS **off** in a fresh
  build, because nothing in the repo enables it — production is only protected
  because someone did it by hand. A new project would have exposed every
  member's email and every firm's name to the anon key, which ships in the
  browser. Fixed in `0012`, and `infra/tests/rls_coverage.sql` now fails the
  build on that class of mistake.

So the schema is reproducible. That was the main risk and it is retired.

### Two wrinkles found while testing

- `infra/accounting_integrations_migration.sql` recreates a policy that
  `infra/schema.sql` already created, so replaying the legacy files in sequence
  errors. Apply `schema.sql` then skip straight to `infra/migrations/`, or drop
  the duplicate policy first.
- `infra/storage_migration.sql` needs Supabase's real `storage` schema, so it
  cannot be tested locally. It should apply normally on a real project.

## The plan

### What I can do
1. Create the migration runner path against the new project's `SUPABASE_DB_URL`.
2. Apply `infra/schema.sql`, then `infra/storage_migration.sql`, then all of
   `infra/migrations/` in order.
3. Verify with `npm run verify:rls`, `npm run verify:isolation` and
   `npm run verify:erasure` before anything is pointed at it.
4. Move the handful of rows worth keeping — realistically the Northgate tenant,
   its company, and the audit log. Everything else is test residue.
5. Update `.env.local`, run the app against it locally and re-run the suites.

### What only you can do
1. Create the new Supabase project (London region, to match `lhr1`).
2. Recreate the two accounts, or invite yourself into the new project.
3. **SMTP settings** — Resend, **port 465**, username `resend`, sender on the
   verified domain. Per-project, so nothing carries over.
4. **Redirect URL allow-list** — `http://localhost:3004/**` and the Vercel
   wildcards.
5. **Site URL**, and the **reset and invite email templates**.
6. Update the Vercel environment variables and redeploy.

### Order that avoids an outage
Build and verify the new project completely before changing any environment
variable. The old project keeps serving until the final switch, and the switch
is one Vercel redeploy that can be rolled back by reverting the variables.

## What could go wrong

- **Auth users do not migrate.** Supabase accounts belong to a project. Both
  existing accounts must be recreated, and their `auth.uid()` values will
  change — so anything keyed by user id (`user_scope_access`,
  `user_company_access`, `user_workspaces`, `audit_logs.user_id`) must be
  rewritten to the new ids, not copied. With two users this is trivial; with
  a firm's staff it would not be.
- **Storage objects** (uploaded packs) live in the project's storage buckets
  and would need copying separately. Three uploads today.
- **The other product must not follow.** Only ClosePilot's env vars change;
  MissionLedger keeps the existing project.
- **QuickBooks/Xero/Sage OAuth** connections are tied to tokens in
  `accounting_integrations`. There is one, already disconnected in spirit —
  expect to reconnect rather than migrate.

## If you decide not to

That is defensible for a friendly, non-commercial trial. It stops being
defensible the moment a firm's real client data is involved, because at that
point the honest answer to "who else can read this" includes another product's
credentials. Record the decision in the sub-processor register either way.
