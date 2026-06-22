-- Run this in Supabase SQL Editor before enabling live accounting connectors.
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

create index if not exists accounting_integrations_company_idx on accounting_integrations(tenant_id, company_id, provider);
create index if not exists accounting_sync_runs_company_idx on accounting_sync_runs(tenant_id, company_id, started_at desc);

alter table accounting_integrations enable row level security;
alter table accounting_sync_runs enable row level security;

create policy "Users can manage scoped accounting integrations"
  on accounting_integrations for all
  using (has_company_access(tenant_id, company_id) and user_id = auth.uid())
  with check (has_company_access(tenant_id, company_id) and user_id = auth.uid());

create policy "Users can manage scoped accounting sync runs"
  on accounting_sync_runs for all
  using (has_company_access(tenant_id, company_id))
  with check (has_company_access(tenant_id, company_id));
