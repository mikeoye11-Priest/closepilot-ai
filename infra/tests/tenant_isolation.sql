-- Tenant-isolation proof for the accounting integration tables.
--
-- Proves that ClosePilot's RLS policies stop one tenant's authenticated session
-- from reading another tenant's connections, synced data or audit trail — the
-- guarantee that has to hold before real client data is uploaded.
--
-- How it works: seed two independent tenants (A and B), each with a user, a
-- company, an accounting_integrations row, a sync run and an audit log. Then
-- assume each user's identity with `SET ROLE authenticated` + a simulated JWT
-- (request.jwt.claims.sub = that user), exactly as PostgREST/supabase-js does
-- for the app, and assert each user sees ONLY their own rows.
--
-- Everything runs inside one transaction that ROLLS BACK, so nothing persists —
-- it is safe to run against any environment (including production). Any breach
-- raises an exception; with psql -v ON_ERROR_STOP=1 that fails the whole run.
--
--   npm run verify:isolation           (uses .env.migrations.local)
--   SUPABASE_DB_URL=postgres://... psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f infra/tests/tenant_isolation.sql

\set ON_ERROR_STOP on

begin;

-- Namespaced test UUIDs (a… = tenant A, b… = tenant B) so they never collide
-- with real data during the (rolled-back) transaction.
-- A: tenant .01 user .02 company .03 integration .04 sync_run .05 audit .06
-- B: same layout under the bbbb… prefix.

-- Seed runs as the connection owner (bypasses RLS) so both tenants exist.
insert into tenants (id, name, tenant_type, plan) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'Isolation Test Tenant A', 'practice', 'starter'),
  ('bbbbbbbb-0000-4000-8000-000000000001', 'Isolation Test Tenant B', 'practice', 'starter');

insert into users (id, tenant_id, email, role, status) values
  ('aaaaaaaa-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000001', 'isolation-test-a@closepilot.invalid', 'practice_admin', 'active'),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'bbbbbbbb-0000-4000-8000-000000000001', 'isolation-test-b@closepilot.invalid', 'practice_admin', 'active');

insert into companies (id, tenant_id, name, currency, country) values
  ('aaaaaaaa-0000-4000-8000-000000000003', 'aaaaaaaa-0000-4000-8000-000000000001', 'Client A Ltd', 'GBP', 'United Kingdom'),
  ('bbbbbbbb-0000-4000-8000-000000000003', 'bbbbbbbb-0000-4000-8000-000000000001', 'Client B Ltd', 'GBP', 'United Kingdom');

insert into user_company_access (user_id, tenant_id, company_id, role) values
  ('aaaaaaaa-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000003', 'practice_admin'),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'bbbbbbbb-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000003', 'practice_admin');

insert into accounting_integrations (id, tenant_id, company_id, user_id, provider, external_tenant_id, access_token_encrypted, refresh_token_encrypted, selected) values
  ('aaaaaaaa-0000-4000-8000-000000000004', 'aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000003', 'aaaaaaaa-0000-4000-8000-000000000002', 'xero', 'ext-A', 'enc', 'enc', true),
  ('bbbbbbbb-0000-4000-8000-000000000004', 'bbbbbbbb-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000003', 'bbbbbbbb-0000-4000-8000-000000000002', 'xero', 'ext-B', 'enc', 'enc', true);

insert into accounting_sync_runs (id, tenant_id, company_id, integration_id, provider, sync_type, status, records_imported) values
  ('aaaaaaaa-0000-4000-8000-000000000005', 'aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000003', 'aaaaaaaa-0000-4000-8000-000000000004', 'xero', 'full', 'completed', 42),
  ('bbbbbbbb-0000-4000-8000-000000000005', 'bbbbbbbb-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000003', 'bbbbbbbb-0000-4000-8000-000000000004', 'xero', 'full', 'completed', 42);

insert into audit_logs (id, tenant_id, user_id, action) values
  ('aaaaaaaa-0000-4000-8000-000000000006', 'aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000002', 'xero_connected'),
  ('bbbbbbbb-0000-4000-8000-000000000006', 'bbbbbbbb-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000002', 'xero_connected');

-- ── Assume tenant A's identity as the (RLS-enforced) authenticated role ──────
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'aaaaaaaa-0000-4000-8000-000000000002', 'email', 'isolation-test-a@closepilot.invalid', 'role', 'authenticated')::text, true);

do $$
declare own_int int; other_int int; own_run int; other_run int; own_audit int; other_audit int;
begin
  if auth.uid() <> 'aaaaaaaa-0000-4000-8000-000000000002' then
    raise exception 'SETUP FAIL: JWT claims not applied for tenant A (auth.uid() = %)', auth.uid();
  end if;
  select count(*) into own_int   from accounting_integrations where id = 'aaaaaaaa-0000-4000-8000-000000000004';
  select count(*) into other_int from accounting_integrations where id = 'bbbbbbbb-0000-4000-8000-000000000004';
  select count(*) into own_run   from accounting_sync_runs     where id = 'aaaaaaaa-0000-4000-8000-000000000005';
  select count(*) into other_run from accounting_sync_runs     where id = 'bbbbbbbb-0000-4000-8000-000000000005';
  select count(*) into own_audit from audit_logs               where id = 'aaaaaaaa-0000-4000-8000-000000000006';
  select count(*) into other_audit from audit_logs             where id = 'bbbbbbbb-0000-4000-8000-000000000006';
  if own_int   <> 1 then raise exception 'ISOLATION FAIL: tenant A cannot read its own integration (saw %)', own_int; end if;
  if other_int <> 0 then raise exception 'ISOLATION FAIL: tenant A can read tenant B''s integration (saw %)', other_int; end if;
  if own_run   <> 1 then raise exception 'ISOLATION FAIL: tenant A cannot read its own sync run (saw %)', own_run; end if;
  if other_run <> 0 then raise exception 'ISOLATION FAIL: tenant A can read tenant B''s sync run (saw %)', other_run; end if;
  if own_audit <> 1 then raise exception 'ISOLATION FAIL: tenant A cannot read its own audit log (saw %)', own_audit; end if;
  if other_audit <> 0 then raise exception 'ISOLATION FAIL: tenant A can read tenant B''s audit log (saw %)', other_audit; end if;
end $$;

reset role;
-- Reached only if every assertion above held (an exception would have aborted).
select 'PASS: tenant A reads only its own integration + sync run + audit log' as isolation_result;

-- ── Assume tenant B's identity and assert the mirror ─────────────────────────
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'bbbbbbbb-0000-4000-8000-000000000002', 'email', 'isolation-test-b@closepilot.invalid', 'role', 'authenticated')::text, true);

do $$
declare own_int int; other_int int; own_run int; other_run int; own_audit int; other_audit int;
begin
  if auth.uid() <> 'bbbbbbbb-0000-4000-8000-000000000002' then
    raise exception 'SETUP FAIL: JWT claims not applied for tenant B (auth.uid() = %)', auth.uid();
  end if;
  select count(*) into own_int   from accounting_integrations where id = 'bbbbbbbb-0000-4000-8000-000000000004';
  select count(*) into other_int from accounting_integrations where id = 'aaaaaaaa-0000-4000-8000-000000000004';
  select count(*) into own_run   from accounting_sync_runs     where id = 'bbbbbbbb-0000-4000-8000-000000000005';
  select count(*) into other_run from accounting_sync_runs     where id = 'aaaaaaaa-0000-4000-8000-000000000005';
  select count(*) into own_audit from audit_logs               where id = 'bbbbbbbb-0000-4000-8000-000000000006';
  select count(*) into other_audit from audit_logs             where id = 'aaaaaaaa-0000-4000-8000-000000000006';
  if own_int   <> 1 then raise exception 'ISOLATION FAIL: tenant B cannot read its own integration (saw %)', own_int; end if;
  if other_int <> 0 then raise exception 'ISOLATION FAIL: tenant B can read tenant A''s integration (saw %)', other_int; end if;
  if own_run   <> 1 then raise exception 'ISOLATION FAIL: tenant B cannot read its own sync run (saw %)', own_run; end if;
  if other_run <> 0 then raise exception 'ISOLATION FAIL: tenant B can read tenant A''s sync run (saw %)', other_run; end if;
  if own_audit <> 1 then raise exception 'ISOLATION FAIL: tenant B cannot read its own audit log (saw %)', own_audit; end if;
  if other_audit <> 0 then raise exception 'ISOLATION FAIL: tenant B can read tenant A''s audit log (saw %)', other_audit; end if;
end $$;

reset role;
-- Reached only if every assertion above held (an exception would have aborted).
select 'PASS: tenant B reads only its own integration + sync run + audit log' as isolation_result;

-- Nothing is persisted — the whole proof is discarded.
rollback;
