# Security and reliability remediation roadmap

This roadmap turns the September 2026 application audit into release gates.
Work is ordered by risk: no new product surface should displace Phase 1 while
real-client financial data is in scope.

## Phase 1 — Release blockers

- [x] Replace the unrestricted `bootstrap_workspace` RPC with a role-aware
  implementation that cannot promote an existing member.
- [x] Stop routine workspace saves from calling onboarding/bootstrap logic for
  companies that already exist.
- [x] Add reusable server-side company and tenant capability guards.
- [x] Require explicit capabilities for uploads, persisted analysis, reports,
  VAT sign-off, accounting integrations, and erasure.
- [x] Make database RLS capability-aware so direct Supabase access cannot bypass
  the API checks.
- [x] Load uploaded report statements from `company_snapshots`, retaining the
  legacy workspace blob only as a migration fallback.
- [x] Add negative authorization tests for every role and sensitive operation.

Exit gate: a `client_user`, `preparer`, and `manager` cannot promote themselves,
sign off, erase data, or perform another role's privileged writes through either
an API route or direct Supabase access.

## Phase 2 — Data integrity and deployment reproducibility

- [x] Persist analysis results through one validated database transaction.
- [x] Treat server analysis as authoritative; do not persist browser-authored
  scores or evidence without revalidation.
- [x] Move storage, ingestion, and other required legacy SQL into numbered,
  idempotent migrations.
- [x] Prove a blank database can be provisioned using only the documented setup.
- [x] Run RLS coverage, tenant-isolation, and erasure proofs in CI.

Exit gate: clean provisioning and deliberate rollback tests pass, and an induced
persistence failure cannot leave a partial review.

## Phase 3 — Ingestion, privacy, and operational resilience

- [x] Replace the custom CSV reader with a standards-compliant streaming parser.
- [x] Enforce approved retention periods for database rows and storage objects.
- [ ] Add legal-hold, deletion-audit, retry, and failed-purge handling.
- [ ] Make the Playwright server lifecycle reliable with or without a local
  development server.
- [ ] Add CSP and production HSTS after compatibility testing.

Exit gate: the complete verification command passes from a clean checkout and
retention can be demonstrated without deleting held or in-scope records.

## Phase 4 — Maintainability and scale

- [ ] Split `components/app-shell.tsx` by product domain and persistence boundary.
- [ ] Add a firm switcher for users with membership in multiple tenants.
- [ ] Complete live QuickBooks and Sage validation and operational runbooks.
- [ ] Add performance budgets, accessibility checks, and report-generation load
  tests for large practices.

Exit gate: supported multi-firm workflows are explicit, observable, and covered
by browser tests.
