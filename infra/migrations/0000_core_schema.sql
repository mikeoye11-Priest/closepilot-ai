-- Idempotent core baseline. On a new Supabase project this runs before every
-- reconciliation migration; on existing projects it is a no-op.
begin;
create table if not exists tenants(id uuid primary key,name text not null,tenant_type text not null default 'company',plan text not null default 'starter',created_at timestamptz not null default now());
create table if not exists users(id uuid primary key,tenant_id uuid not null references tenants(id),email text not null unique,role text not null,status text not null default 'active',created_at timestamptz not null default now());
create table if not exists companies(id uuid primary key,tenant_id uuid not null references tenants(id),name text not null,industry text,accounting_system text,currency text not null default 'GBP',country text not null default 'United Kingdom',created_at timestamptz not null default now());
create table if not exists user_company_access(user_id uuid not null references users(id),tenant_id uuid not null references tenants(id),company_id uuid not null references companies(id),role text not null,created_at timestamptz not null default now(),primary key(user_id,company_id));
do $$ begin
 if to_regprocedure('has_company_access(uuid,uuid)') is null then
  execute 'create function has_company_access(p_tenant_id uuid,p_company_id uuid) returns boolean language sql security definer set search_path=public stable as $body$
   select exists(select 1 from user_company_access a join users u on u.id=a.user_id where u.id=auth.uid() and a.tenant_id=p_tenant_id and a.company_id=p_company_id and u.status=''active'')
  $body$';
 end if;
end $$;
create table if not exists uploads(id uuid primary key,tenant_id uuid not null references tenants(id),company_id uuid not null references companies(id),file_type text not null,file_url text not null,storage_key text,uploaded_at timestamptz not null default now());
create table if not exists analysis_jobs(id uuid primary key,tenant_id uuid not null references tenants(id),company_id uuid not null references companies(id),job_type text not null,status text not null,started_at timestamptz,completed_at timestamptz);
create table if not exists findings(id uuid primary key,tenant_id uuid not null references tenants(id),company_id uuid not null references companies(id),severity text not null,category text not null,title text not null,description text not null,expected_impact text,status text not null default 'open',confidence text not null default 'medium',source_file text not null,account_code text not null,period text not null,calculation text not null,reviewer text,created_at timestamptz not null default now());
create table if not exists validation_checks(id uuid primary key,tenant_id uuid not null references tenants(id),company_id uuid not null references companies(id),analysis_job_id uuid references analysis_jobs(id),name text not null,status text not null,detail text not null,created_at timestamptz not null default now());
create table if not exists recommendations(id uuid primary key,tenant_id uuid not null references tenants(id),company_id uuid not null references companies(id),finding_id uuid not null references findings(id),action text not null,expected_impact text,priority text not null,completed boolean not null default false);
create table if not exists finance_health_scores(id uuid primary key,tenant_id uuid not null references tenants(id),company_id uuid not null references companies(id),score integer not null,risk_level text not null,calculated_at timestamptz not null default now());
create table if not exists cashflow_forecasts(id uuid primary key,tenant_id uuid not null references tenants(id),company_id uuid not null references companies(id),period text not null,forecast_cash numeric(14,2) not null,risk_level text not null,created_at timestamptz not null default now());
create table if not exists reports(id uuid primary key,tenant_id uuid not null references tenants(id),company_id uuid not null references companies(id),report_type text not null,file_url text,storage_key text,created_at timestamptz not null default now());
create table if not exists ai_conversations(id uuid primary key,tenant_id uuid not null references tenants(id),company_id uuid not null references companies(id),user_id uuid references users(id),question text not null,response text not null,created_at timestamptz not null default now());
create table if not exists audit_logs(id uuid primary key,tenant_id uuid not null references tenants(id),user_id uuid references users(id),action text not null,entity_type text,entity_id uuid,created_at timestamptz not null default now());
create table if not exists subscriptions(id uuid primary key,tenant_id uuid not null references tenants(id),plan text not null,status text not null,created_at timestamptz not null default now());
create index if not exists validation_checks_company_status_idx on validation_checks(tenant_id,company_id,status);
create index if not exists uploads_company_type_idx on uploads(tenant_id,company_id,file_type);
create index if not exists scores_company_calculated_idx on finance_health_scores(tenant_id,company_id,calculated_at desc);
create index if not exists jobs_company_status_idx on analysis_jobs(tenant_id,company_id,status);
create index if not exists user_company_access_tenant_user_idx on user_company_access(tenant_id,user_id);
commit;
