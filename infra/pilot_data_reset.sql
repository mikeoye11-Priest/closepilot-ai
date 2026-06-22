-- ClosePilot safe pilot-data reset
--
-- Run in the Supabase SQL Editor as a project administrator.
-- Preserves:
--   * auth.users and user login credentials
--   * database tables, functions, indexes and RLS policies
--   * rule_registry definitions
-- Deletes:
--   * saved browser workspaces
--   * tenants, companies and application user profiles/access
--   * uploads, analyses, findings, evidence and review activity
--   * reports, scores, forecasts, integrations and audit history
--
-- Storage objects must be deleted separately through Supabase Storage.

begin;

do $$
declare
  reset_tables constant text[] := array[
    'user_workspaces',
    'accounting_sync_runs',
    'accounting_integrations',
    'finding_evidence_rows',
    'finding_comments',
    'finding_activities',
    'finding_review_events',
    'recommendations',
    'partner_signoffs',
    'validation_checks',
    'finance_health_scores',
    'cashflow_forecasts',
    'reports',
    'ai_conversations',
    'audit_logs',
    'subscriptions',
    'findings',
    'analysis_jobs',
    'uploads',
    'user_company_access',
    'companies',
    'users',
    'tenants'
  ];
  existing_tables text;
begin
  select string_agg(format('public.%I', table_name), ', ')
    into existing_tables
  from unnest(reset_tables) as table_name
  where to_regclass(format('public.%I', table_name)) is not null;

  if existing_tables is not null then
    execute 'truncate table ' || existing_tables || ' restart identity cascade';
  end if;
end
$$;

commit;

-- Expected after reset: zero application workspaces and tenants.
select
  (select count(*) from public.user_workspaces) as saved_workspaces,
  (select count(*) from public.tenants) as tenants,
  (select count(*) from public.companies) as companies,
  (select count(*) from public.uploads) as upload_records,
  (select count(*) from public.findings) as findings;
