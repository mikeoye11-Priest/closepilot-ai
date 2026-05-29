create table tenants (
  id uuid primary key,
  name text not null,
  tenant_type text not null default 'company',
  plan text not null default 'starter',
  created_at timestamptz not null default now()
);

create table users (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  email text not null unique,
  role text not null,
  status text not null default 'active',
  created_at timestamptz not null default now()
);

create table companies (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  name text not null,
  industry text,
  accounting_system text,
  currency text not null default 'GBP',
  country text not null default 'United Kingdom',
  created_at timestamptz not null default now()
);

create table user_company_access (
  user_id uuid not null references users(id),
  tenant_id uuid not null references tenants(id),
  company_id uuid not null references companies(id),
  role text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, company_id)
);

create table uploads (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  company_id uuid not null references companies(id),
  file_type text not null,
  file_url text not null,
  storage_key text,
  uploaded_at timestamptz not null default now()
);

create table analysis_jobs (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  company_id uuid not null references companies(id),
  job_type text not null,
  status text not null,
  started_at timestamptz,
  completed_at timestamptz
);

create table findings (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  company_id uuid not null references companies(id),
  severity text not null,
  category text not null,
  title text not null,
  description text not null,
  expected_impact text,
  status text not null default 'open',
  confidence text not null default 'medium',
  source_file text not null,
  account_code text not null,
  period text not null,
  calculation text not null,
  reviewer text,
  created_at timestamptz not null default now()
);

create table validation_checks (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  company_id uuid not null references companies(id),
  analysis_job_id uuid references analysis_jobs(id),
  name text not null,
  status text not null,
  detail text not null,
  created_at timestamptz not null default now()
);

create table recommendations (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  company_id uuid not null references companies(id),
  finding_id uuid not null references findings(id),
  action text not null,
  expected_impact text,
  priority text not null,
  completed boolean not null default false
);

create table finance_health_scores (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  company_id uuid not null references companies(id),
  score integer not null,
  risk_level text not null,
  calculated_at timestamptz not null default now()
);

create table cashflow_forecasts (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  company_id uuid not null references companies(id),
  period text not null,
  forecast_cash numeric(14, 2) not null,
  risk_level text not null,
  created_at timestamptz not null default now()
);

create table reports (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  company_id uuid not null references companies(id),
  report_type text not null,
  file_url text,
  storage_key text,
  created_at timestamptz not null default now()
);

create table ai_conversations (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  company_id uuid not null references companies(id),
  user_id uuid references users(id),
  question text not null,
  response text not null,
  created_at timestamptz not null default now()
);

create table audit_logs (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  user_id uuid references users(id),
  action text not null,
  entity_type text,
  entity_id uuid,
  created_at timestamptz not null default now()
);

create table subscriptions (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  plan text not null,
  status text not null,
  created_at timestamptz not null default now()
);

create index findings_company_status_idx on findings(tenant_id, company_id, status);
create index validation_checks_company_status_idx on validation_checks(tenant_id, company_id, status);
create index uploads_company_type_idx on uploads(tenant_id, company_id, file_type);
create index scores_company_calculated_idx on finance_health_scores(tenant_id, company_id, calculated_at desc);
create index jobs_company_status_idx on analysis_jobs(tenant_id, company_id, status);
create index user_company_access_tenant_user_idx on user_company_access(tenant_id, user_id);

-- Recommended storage path pattern:
-- tenants/{tenant_id}/companies/{company_id}/uploads/{upload_id}/{filename}
-- tenants/{tenant_id}/companies/{company_id}/reports/{report_id}/{filename}

-- In production, enable PostgreSQL row-level security and bind tenant/company
-- scope from the authenticated session or Supabase JWT claims.
alter table companies enable row level security;
alter table uploads enable row level security;
alter table findings enable row level security;
alter table recommendations enable row level security;
alter table reports enable row level security;
alter table ai_conversations enable row level security;
