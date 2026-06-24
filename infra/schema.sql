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

create or replace function has_company_access(p_tenant_id uuid, p_company_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from user_company_access access
    join users app_user on app_user.id = access.user_id
    where app_user.id = auth.uid()
      and access.tenant_id = p_tenant_id
      and access.company_id = p_company_id
      and app_user.status = 'active'
  );
$$;

create or replace function bootstrap_workspace(
  p_tenant_id uuid,
  p_tenant_name text,
  p_tenant_type text,
  p_plan text,
  p_company_id uuid,
  p_company_name text,
  p_industry text,
  p_accounting_system text,
  p_currency text,
  p_country text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_email text := coalesce(auth.jwt() ->> 'email', '');
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  insert into tenants (id, name, tenant_type, plan)
  values (p_tenant_id, p_tenant_name, p_tenant_type, p_plan)
  on conflict (id) do update
    set name = excluded.name,
        tenant_type = excluded.tenant_type,
        plan = excluded.plan;

  insert into users (id, tenant_id, email, role, status)
  values (v_user_id, p_tenant_id, v_email, 'practice_admin', 'active')
  on conflict (id) do update
    set tenant_id = excluded.tenant_id,
        email = excluded.email,
        status = 'active';

  insert into companies (id, tenant_id, name, industry, accounting_system, currency, country)
  values (p_company_id, p_tenant_id, p_company_name, p_industry, p_accounting_system, p_currency, p_country)
  on conflict (id) do update
    set name = excluded.name,
        industry = excluded.industry,
        accounting_system = excluded.accounting_system,
        currency = excluded.currency,
        country = excluded.country;

  insert into user_company_access (user_id, tenant_id, company_id, role)
  values (v_user_id, p_tenant_id, p_company_id, 'practice_admin')
  on conflict (user_id, company_id) do update
    set tenant_id = excluded.tenant_id,
        role = excluded.role;
end;
$$;

grant execute on function bootstrap_workspace(uuid, text, text, text, uuid, text, text, text, text, text) to authenticated;

create table uploads (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  company_id uuid not null references companies(id),
  file_type text not null,
  file_url text not null,
  storage_key text,
  size_bytes bigint,
  content_hash text,
  ingestion_status text not null default 'stored',
  retention_until timestamptz,
  deleted_at timestamptz,
  uploaded_at timestamptz not null default now()
);

create table analysis_jobs (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  company_id uuid not null references companies(id),
  job_type text not null,
  status text not null,
  source_type text not null default 'upload',
  input_upload_ids uuid[] not null default '{}',
  result_summary jsonb not null default '{}',
  error_message text,
  progress_percent integer not null default 0,
  current_stage text,
  checkpoint jsonb not null default '{}',
  bytes_processed bigint not null default 0,
  rows_processed bigint not null default 0,
  attempt_count integer not null default 0,
  heartbeat_at timestamptz,
  retention_until timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create table rule_registry (
  id text primary key,
  category text not null,
  file_type text not null,
  severity text not null,
  confidence text not null,
  evidence_strength text not null default 'indicator',
  description text not null,
  calculation_logic text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table findings (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  company_id uuid not null references companies(id),
  analysis_job_id uuid references analysis_jobs(id),
  upload_id uuid references uploads(id),
  rule_id text references rule_registry(id),
  severity text not null,
  category text not null,
  title text not null,
  description text not null,
  expected_impact text,
  status text not null default 'open',
  assigned_to text,
  due_date date,
  resolution_note text,
  evidence_ids uuid[] not null default '{}',
  manager_review_status text,
  manager_reviewed_by text,
  manager_reviewed_at timestamptz,
  manager_review_note text,
  confidence text not null default 'medium',
  confidence_score numeric(5, 2),
  evidence_strength text not null default 'indicator',
  source_file text not null,
  account_code text not null,
  period text not null,
  calculation text not null,
  evidence jsonb not null default '{}',
  reviewer text,
  review_action text,
  review_reason text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table finding_evidence_rows (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  company_id uuid not null references companies(id),
  finding_id uuid not null references findings(id) on delete cascade,
  upload_id uuid references uploads(id),
  source_file text not null,
  file_url text,
  sheet_name text,
  row_index integer,
  account_code text,
  period text,
  amount numeric(14, 2),
  source_row jsonb not null default '{}',
  calculation_input jsonb not null default '{}',
  uploaded_by text,
  uploaded_at timestamptz not null default now(),
  notes text,
  status text not null default 'uploaded',
  created_at timestamptz not null default now()
);

create table finding_comments (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  company_id uuid not null references companies(id),
  finding_id uuid not null references findings(id) on delete cascade,
  user_id uuid references users(id),
  comment text not null,
  created_at timestamptz not null default now()
);

create table finding_activities (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  company_id uuid not null references companies(id),
  finding_id uuid not null references findings(id) on delete cascade,
  action text not null,
  user_id uuid references users(id),
  details text,
  created_at timestamptz not null default now()
);

create table partner_signoffs (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  company_id uuid not null references companies(id),
  status text not null default 'signed',
  signed_by text not null,
  signed_at timestamptz not null default now(),
  note text,
  gate_snapshot jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table finding_review_events (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  company_id uuid not null references companies(id),
  finding_id uuid not null references findings(id) on delete cascade,
  user_id uuid references users(id),
  from_status text,
  to_status text not null,
  reason text,
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
  title text,
  export_status text not null default 'draft',
  metadata jsonb not null default '{}',
  file_url text,
  storage_key text,
  created_at timestamptz not null default now()
);

create table accounting_integrations (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  company_id uuid not null references companies(id),
  user_id uuid not null references users(id),
  provider text not null,
  external_tenant_id text not null,
  external_tenant_name text,
  external_connection_id text,
  status text not null default 'connected',
  selected boolean not null default false,
  access_token_encrypted text not null,
  refresh_token_encrypted text not null,
  id_token_encrypted text,
  token_expires_at timestamptz,
  scopes text[] not null default '{}',
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, company_id, provider, external_tenant_id)
);

create table accounting_sync_runs (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  company_id uuid not null references companies(id),
  integration_id uuid not null references accounting_integrations(id) on delete cascade,
  provider text not null,
  sync_type text not null,
  status text not null,
  records_imported integer not null default 0,
  result_summary jsonb not null default '{}',
  error_message text,
  started_at timestamptz not null default now(),
  completed_at timestamptz
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
create index findings_company_rule_idx on findings(tenant_id, company_id, rule_id);
create index finding_evidence_rows_finding_idx on finding_evidence_rows(finding_id);
create index finding_comments_finding_idx on finding_comments(finding_id, created_at desc);
create index finding_activities_finding_idx on finding_activities(finding_id, created_at desc);
create index partner_signoffs_company_signed_idx on partner_signoffs(tenant_id, company_id, signed_at desc);
create index finding_review_events_finding_idx on finding_review_events(finding_id, created_at desc);
create index validation_checks_company_status_idx on validation_checks(tenant_id, company_id, status);
create index uploads_company_type_idx on uploads(tenant_id, company_id, file_type);
create index scores_company_calculated_idx on finance_health_scores(tenant_id, company_id, calculated_at desc);
create index jobs_company_status_idx on analysis_jobs(tenant_id, company_id, status);
create index user_company_access_tenant_user_idx on user_company_access(tenant_id, user_id);
create index accounting_integrations_company_idx on accounting_integrations(tenant_id, company_id, provider);
create index accounting_sync_runs_company_idx on accounting_sync_runs(tenant_id, company_id, started_at desc);

-- Recommended storage path pattern:
-- tenants/{tenant_id}/companies/{company_id}/uploads/{upload_id}/{filename}
-- tenants/{tenant_id}/companies/{company_id}/reports/{report_id}/{filename}

-- Row-level security binds every client-facing table to explicit company access.
alter table companies enable row level security;
alter table user_company_access enable row level security;
alter table uploads enable row level security;
alter table analysis_jobs enable row level security;
alter table rule_registry enable row level security;
alter table findings enable row level security;
alter table finding_evidence_rows enable row level security;
alter table finding_comments enable row level security;
alter table finding_activities enable row level security;
alter table partner_signoffs enable row level security;
alter table finding_review_events enable row level security;
alter table validation_checks enable row level security;
alter table recommendations enable row level security;
alter table finance_health_scores enable row level security;
alter table cashflow_forecasts enable row level security;
alter table reports enable row level security;
alter table ai_conversations enable row level security;
alter table audit_logs enable row level security;
alter table accounting_integrations enable row level security;
alter table accounting_sync_runs enable row level security;

create policy "Users can read companies they can access"
  on companies for select
  using (has_company_access(tenant_id, id));

create policy "Users can read their company access"
  on user_company_access for select
  using (user_id = auth.uid());

create policy "Users can read active rules"
  on rule_registry for select
  using (active = true);

create policy "Users can read scoped uploads"
  on uploads for select
  using (has_company_access(tenant_id, company_id));

create policy "Users can add scoped uploads"
  on uploads for insert
  with check (has_company_access(tenant_id, company_id));

create policy "Users can update scoped uploads"
  on uploads for update
  using (has_company_access(tenant_id, company_id))
  with check (has_company_access(tenant_id, company_id));

create policy "Users can delete scoped uploads"
  on uploads for delete
  using (has_company_access(tenant_id, company_id));

create policy "Users can read scoped analysis jobs"
  on analysis_jobs for select
  using (has_company_access(tenant_id, company_id));

create policy "Users can add scoped analysis jobs"
  on analysis_jobs for insert
  with check (has_company_access(tenant_id, company_id));

create policy "Users can update scoped analysis jobs"
  on analysis_jobs for update
  using (has_company_access(tenant_id, company_id))
  with check (has_company_access(tenant_id, company_id));

create policy "Users can read scoped findings"
  on findings for select
  using (has_company_access(tenant_id, company_id));

create policy "Users can add scoped findings"
  on findings for insert
  with check (has_company_access(tenant_id, company_id));

create policy "Users can update scoped findings"
  on findings for update
  using (has_company_access(tenant_id, company_id))
  with check (has_company_access(tenant_id, company_id));

create policy "Users can read scoped finding evidence"
  on finding_evidence_rows for select
  using (has_company_access(tenant_id, company_id));

create policy "Users can add scoped finding evidence"
  on finding_evidence_rows for insert
  with check (has_company_access(tenant_id, company_id));

create policy "Users can read scoped finding comments"
  on finding_comments for select
  using (has_company_access(tenant_id, company_id));

create policy "Users can add scoped finding comments"
  on finding_comments for insert
  with check (has_company_access(tenant_id, company_id) and user_id = auth.uid());

create policy "Users can read scoped finding activities"
  on finding_activities for select
  using (has_company_access(tenant_id, company_id));

create policy "Users can add scoped finding activities"
  on finding_activities for insert
  with check (has_company_access(tenant_id, company_id) and user_id = auth.uid());

create policy "Users can read scoped partner signoffs"
  on partner_signoffs for select
  using (has_company_access(tenant_id, company_id));

create policy "Users can add scoped partner signoffs"
  on partner_signoffs for insert
  with check (has_company_access(tenant_id, company_id));

create policy "Users can read scoped review events"
  on finding_review_events for select
  using (has_company_access(tenant_id, company_id));

create policy "Users can add scoped review events"
  on finding_review_events for insert
  with check (has_company_access(tenant_id, company_id) and user_id = auth.uid());

create policy "Users can read scoped validation checks"
  on validation_checks for select
  using (has_company_access(tenant_id, company_id));

create policy "Users can add scoped validation checks"
  on validation_checks for insert
  with check (has_company_access(tenant_id, company_id));

create policy "Users can read scoped recommendations"
  on recommendations for select
  using (has_company_access(tenant_id, company_id));

create policy "Users can add scoped recommendations"
  on recommendations for insert
  with check (has_company_access(tenant_id, company_id));

create policy "Users can update scoped recommendations"
  on recommendations for update
  using (has_company_access(tenant_id, company_id))
  with check (has_company_access(tenant_id, company_id));

create policy "Users can read scoped finance scores"
  on finance_health_scores for select
  using (has_company_access(tenant_id, company_id));

create policy "Users can add scoped finance scores"
  on finance_health_scores for insert
  with check (has_company_access(tenant_id, company_id));

create policy "Users can read scoped cash forecasts"
  on cashflow_forecasts for select
  using (has_company_access(tenant_id, company_id));

create policy "Users can add scoped cash forecasts"
  on cashflow_forecasts for insert
  with check (has_company_access(tenant_id, company_id));

create policy "Users can read scoped reports"
  on reports for select
  using (has_company_access(tenant_id, company_id));

create policy "Users can add scoped reports"
  on reports for insert
  with check (has_company_access(tenant_id, company_id));

create policy "Users can read scoped AI conversations"
  on ai_conversations for select
  using (has_company_access(tenant_id, company_id));

create policy "Users can add scoped AI conversations"
  on ai_conversations for insert
  with check (has_company_access(tenant_id, company_id) and user_id = auth.uid());

create policy "Users can read own audit logs"
  on audit_logs for select
  using (user_id = auth.uid());

create policy "Users can add own audit logs"
  on audit_logs for insert
  with check (user_id = auth.uid());

create policy "Users can manage scoped accounting integrations"
  on accounting_integrations for all
  using (has_company_access(tenant_id, company_id) and user_id = auth.uid())
  with check (has_company_access(tenant_id, company_id) and user_id = auth.uid());

create policy "Users can manage scoped accounting sync runs"
  on accounting_sync_runs for all
  using (has_company_access(tenant_id, company_id))
  with check (has_company_access(tenant_id, company_id));
