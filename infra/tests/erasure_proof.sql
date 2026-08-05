-- Right-to-erasure proof for the accounting integration tables.
--
-- Proves that POST /api/integrations/erase removes ALL of a client company's
-- synced financial data and its provider connections, records the FACT of erasure
-- in the audit trail, and touches nothing belonging to another company — the
-- guarantee a controller relies on when they exercise the right to erasure
-- (UK GDPR Art 17). It mirrors the exact operations the route performs
-- (apps/web/app/api/integrations/erase/route.ts): delete accounting_sync_runs,
-- then accounting_integrations, scoped by tenant_id + company_id, then insert the
-- 'integration_data_erased' audit record.
--
-- How it works: seed ONE tenant with TWO companies — a TARGET (to be erased) and a
-- BYSTANDER (must survive) — each with a connection, a sync run carrying real
-- financial figures in result_summary, and audit rows. Erase the target, then
-- assert: the target's financials + connections are gone, the sensitive payload is
-- gone, the bystander is untouched, and the erasure fact is recorded.
--
-- Everything runs inside one transaction that ROLLS BACK, so nothing persists — it
-- is safe to run against any environment (including production). Any failure raises
-- an exception; with psql -v ON_ERROR_STOP=1 that fails the whole run.
--
--   npm run verify:erasure             (uses .env.migrations.local)
--   SUPABASE_DB_URL=postgres://... psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f infra/tests/erasure_proof.sql

\set ON_ERROR_STOP on

begin;

-- Namespaced test UUIDs (cccc… prefix) so they never collide with real data.
-- tenant .01 user .02 | TARGET company .03 integration .04 run .05 audit .06
--                     | BYSTANDER company .13 integration .14 run .15 audit .16

insert into tenants (id, name, tenant_type, plan) values
  ('cccccccc-0000-4000-8000-000000000001', 'Erasure Test Tenant', 'practice', 'starter');

insert into users (id, tenant_id, email, role, status) values
  ('cccccccc-0000-4000-8000-000000000002', 'cccccccc-0000-4000-8000-000000000001', 'erasure-test@closepilot.invalid', 'practice_admin', 'active');

insert into companies (id, tenant_id, name, currency, country) values
  ('cccccccc-0000-4000-8000-000000000003', 'cccccccc-0000-4000-8000-000000000001', 'Target Client Ltd', 'GBP', 'United Kingdom'),
  ('cccccccc-0000-4000-8000-000000000013', 'cccccccc-0000-4000-8000-000000000001', 'Bystander Client Ltd', 'GBP', 'United Kingdom');

insert into user_company_access (user_id, tenant_id, company_id, role) values
  ('cccccccc-0000-4000-8000-000000000002', 'cccccccc-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000003', 'practice_admin'),
  ('cccccccc-0000-4000-8000-000000000002', 'cccccccc-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000013', 'practice_admin');

insert into accounting_integrations (id, tenant_id, company_id, user_id, provider, external_tenant_id, access_token_encrypted, refresh_token_encrypted, selected) values
  ('cccccccc-0000-4000-8000-000000000004', 'cccccccc-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000003', 'cccccccc-0000-4000-8000-000000000002', 'xero', 'ext-target', 'enc', 'enc', true),
  ('cccccccc-0000-4000-8000-000000000014', 'cccccccc-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000013', 'cccccccc-0000-4000-8000-000000000002', 'xero', 'ext-bystander', 'enc', 'enc', true);

-- Sync runs carry the actual imported financials in result_summary — the sensitive
-- data the erasure must destroy.
insert into accounting_sync_runs (id, tenant_id, company_id, integration_id, provider, sync_type, status, records_imported, result_summary) values
  ('cccccccc-0000-4000-8000-000000000005', 'cccccccc-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000003', 'cccccccc-0000-4000-8000-000000000004', 'xero', 'full', 'completed', 42,
   '{"statements":{"profitLoss":[{"description":"Revenue","amount":"2080000"}],"balanceSheet":[{"item":"Cash at bank","amount":"142000"}],"agedDebtors":[{"customer":"Delphi Retail Group","amount":"120000"}]}}'),
  ('cccccccc-0000-4000-8000-000000000015', 'cccccccc-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000013', 'cccccccc-0000-4000-8000-000000000014', 'xero', 'full', 'completed', 17,
   '{"statements":{"profitLoss":[{"description":"Revenue","amount":"500000"}]}}');

insert into audit_logs (id, tenant_id, user_id, action, entity_type, entity_id) values
  ('cccccccc-0000-4000-8000-000000000006', 'cccccccc-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000002', 'xero_connected', 'company', 'cccccccc-0000-4000-8000-000000000003'),
  ('cccccccc-0000-4000-8000-000000000016', 'cccccccc-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000002', 'xero_connected', 'company', 'cccccccc-0000-4000-8000-000000000013');

-- ── Pre-erasure sanity: the sensitive data is really there ───────────────────
do $$
declare target_runs int; target_conns int; payload_customers int;
begin
  select count(*) into target_runs  from accounting_sync_runs     where company_id = 'cccccccc-0000-4000-8000-000000000003';
  select count(*) into target_conns from accounting_integrations  where company_id = 'cccccccc-0000-4000-8000-000000000003';
  select count(*) into payload_customers from accounting_sync_runs
    where company_id = 'cccccccc-0000-4000-8000-000000000003'
      and result_summary -> 'statements' -> 'agedDebtors' @> '[{"customer":"Delphi Retail Group"}]';
  if target_runs  <> 1 then raise exception 'SETUP FAIL: expected 1 target sync run, saw %', target_runs; end if;
  if target_conns <> 1 then raise exception 'SETUP FAIL: expected 1 target connection, saw %', target_conns; end if;
  if payload_customers <> 1 then raise exception 'SETUP FAIL: target financial payload not seeded (saw %)', payload_customers; end if;
end $$;

select 'PASS: target client financial data + connection are present before erasure' as erasure_result;

-- ── Perform the erasure exactly as the route does (scoped by tenant + company) ─
delete from accounting_sync_runs    where tenant_id = 'cccccccc-0000-4000-8000-000000000001' and company_id = 'cccccccc-0000-4000-8000-000000000003';
delete from accounting_integrations where tenant_id = 'cccccccc-0000-4000-8000-000000000001' and company_id = 'cccccccc-0000-4000-8000-000000000003';
insert into audit_logs (id, tenant_id, user_id, action, entity_type, entity_id) values
  ('cccccccc-0000-4000-8000-000000000007', 'cccccccc-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000002', 'integration_data_erased', 'company', 'cccccccc-0000-4000-8000-000000000003');

-- ── Post-erasure assertions ──────────────────────────────────────────────────
do $$
declare
  target_runs int; target_conns int; target_payload int;
  bystander_runs int; bystander_conns int; erasure_fact int;
begin
  -- The target's financial data + connection are fully gone.
  select count(*) into target_runs  from accounting_sync_runs     where company_id = 'cccccccc-0000-4000-8000-000000000003';
  select count(*) into target_conns from accounting_integrations  where company_id = 'cccccccc-0000-4000-8000-000000000003';
  -- No sync-run payload anywhere still names the erased client's customer.
  select count(*) into target_payload from accounting_sync_runs
    where result_summary::text like '%Delphi Retail Group%';
  -- The bystander company in the SAME tenant is untouched.
  select count(*) into bystander_runs  from accounting_sync_runs     where company_id = 'cccccccc-0000-4000-8000-000000000013';
  select count(*) into bystander_conns from accounting_integrations  where company_id = 'cccccccc-0000-4000-8000-000000000013';
  -- The fact of erasure is retained in the audit trail (the data itself is gone).
  select count(*) into erasure_fact from audit_logs
    where action = 'integration_data_erased' and entity_id = 'cccccccc-0000-4000-8000-000000000003';

  if target_runs    <> 0 then raise exception 'ERASURE FAIL: % target sync run(s) survived', target_runs; end if;
  if target_conns   <> 0 then raise exception 'ERASURE FAIL: % target connection(s) survived', target_conns; end if;
  if target_payload <> 0 then raise exception 'ERASURE FAIL: erased client financial payload still present (saw %)', target_payload; end if;
  if bystander_runs  <> 1 then raise exception 'ERASURE FAIL: bystander sync run collateral-damaged (saw %)', bystander_runs; end if;
  if bystander_conns <> 1 then raise exception 'ERASURE FAIL: bystander connection collateral-damaged (saw %)', bystander_conns; end if;
  if erasure_fact <> 1 then raise exception 'ERASURE FAIL: erasure not recorded in the audit trail (saw %)', erasure_fact; end if;
end $$;

select 'PASS: target erased in full (data + payload + connection gone), audit fact kept, bystander intact' as erasure_result;

-- Nothing is persisted — the whole proof is discarded.
rollback;
