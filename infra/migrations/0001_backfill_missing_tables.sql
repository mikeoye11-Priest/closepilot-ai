-- 0001_backfill_missing_tables
-- Backfills tables that never landed in production because schema.sql and
-- accounting_integrations_migration.sql were only partially applied. Fully
-- idempotent: safe to run repeatedly. Definitions copied verbatim from
-- infra/schema.sql and infra/accounting_integrations_migration.sql.

-- ── Tables ─────────────────────────────────────────────────────────────────

create table if not exists rule_registry (
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

create table if not exists finding_evidence_rows (
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

create table if not exists finding_comments (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  company_id uuid not null references companies(id),
  finding_id uuid not null references findings(id) on delete cascade,
  user_id uuid references users(id),
  comment text not null,
  created_at timestamptz not null default now()
);

create table if not exists finding_activities (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  company_id uuid not null references companies(id),
  finding_id uuid not null references findings(id) on delete cascade,
  action text not null,
  user_id uuid references users(id),
  details text,
  created_at timestamptz not null default now()
);

create table if not exists partner_signoffs (
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

create table if not exists finding_review_events (
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

create table if not exists accounting_integrations (
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

create table if not exists accounting_sync_runs (
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

-- ── Indexes ────────────────────────────────────────────────────────────────

create index if not exists finding_evidence_rows_finding_idx on finding_evidence_rows(finding_id);
create index if not exists finding_comments_finding_idx on finding_comments(finding_id, created_at desc);
create index if not exists finding_activities_finding_idx on finding_activities(finding_id, created_at desc);
create index if not exists partner_signoffs_company_signed_idx on partner_signoffs(tenant_id, company_id, signed_at desc);
create index if not exists finding_review_events_finding_idx on finding_review_events(finding_id, created_at desc);
create index if not exists accounting_integrations_company_idx on accounting_integrations(tenant_id, company_id, provider);
create index if not exists accounting_sync_runs_company_idx on accounting_sync_runs(tenant_id, company_id, started_at desc);

-- ── Row-level security (enable is idempotent) ────────────────────────────────

alter table rule_registry enable row level security;
alter table finding_evidence_rows enable row level security;
alter table finding_comments enable row level security;
alter table finding_activities enable row level security;
alter table partner_signoffs enable row level security;
alter table finding_review_events enable row level security;
alter table accounting_integrations enable row level security;
alter table accounting_sync_runs enable row level security;

-- ── Policies (drop-if-exists keeps this idempotent) ──────────────────────────

drop policy if exists "Users can read active rules" on rule_registry;
create policy "Users can read active rules"
  on rule_registry for select using (active = true);

drop policy if exists "Users can read scoped finding evidence" on finding_evidence_rows;
create policy "Users can read scoped finding evidence"
  on finding_evidence_rows for select using (has_company_access(tenant_id, company_id));
drop policy if exists "Users can add scoped finding evidence" on finding_evidence_rows;
create policy "Users can add scoped finding evidence"
  on finding_evidence_rows for insert with check (has_company_access(tenant_id, company_id));

drop policy if exists "Users can read scoped finding comments" on finding_comments;
create policy "Users can read scoped finding comments"
  on finding_comments for select using (has_company_access(tenant_id, company_id));
drop policy if exists "Users can add scoped finding comments" on finding_comments;
create policy "Users can add scoped finding comments"
  on finding_comments for insert with check (has_company_access(tenant_id, company_id) and user_id = auth.uid());

drop policy if exists "Users can read scoped finding activities" on finding_activities;
create policy "Users can read scoped finding activities"
  on finding_activities for select using (has_company_access(tenant_id, company_id));
drop policy if exists "Users can add scoped finding activities" on finding_activities;
create policy "Users can add scoped finding activities"
  on finding_activities for insert with check (has_company_access(tenant_id, company_id) and user_id = auth.uid());

drop policy if exists "Users can read scoped partner signoffs" on partner_signoffs;
create policy "Users can read scoped partner signoffs"
  on partner_signoffs for select using (has_company_access(tenant_id, company_id));
drop policy if exists "Users can add scoped partner signoffs" on partner_signoffs;
create policy "Users can add scoped partner signoffs"
  on partner_signoffs for insert with check (has_company_access(tenant_id, company_id));

drop policy if exists "Users can read scoped review events" on finding_review_events;
create policy "Users can read scoped review events"
  on finding_review_events for select using (has_company_access(tenant_id, company_id));
drop policy if exists "Users can add scoped review events" on finding_review_events;
create policy "Users can add scoped review events"
  on finding_review_events for insert with check (has_company_access(tenant_id, company_id) and user_id = auth.uid());

drop policy if exists "Users can manage scoped accounting integrations" on accounting_integrations;
create policy "Users can manage scoped accounting integrations"
  on accounting_integrations for all
  using (has_company_access(tenant_id, company_id) and user_id = auth.uid())
  with check (has_company_access(tenant_id, company_id) and user_id = auth.uid());

drop policy if exists "Users can manage scoped accounting sync runs" on accounting_sync_runs;
create policy "Users can manage scoped accounting sync runs"
  on accounting_sync_runs for all
  using (has_company_access(tenant_id, company_id))
  with check (has_company_access(tenant_id, company_id));
