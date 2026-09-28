-- Org units: the optional grouping layer between a tenant and its companies.
--
-- The same structure serves every shape ClosePilot needs to support:
--   * accounting practice  -> tenant = the firm, org unit = a branch/office,
--                             company = a client
--   * multi-entity group   -> tenant = the group, org unit = a division or
--                             region, company = a legal entity
--   * single company       -> tenant = the company, one company row, and no
--                             org unit at all
--
-- companies.org_unit_id is therefore NULLABLE. A null means the company hangs
-- directly off the tenant, which is the correct and common case for a single
-- entity and for a small practice that has no branches. Nothing existing has
-- to be backfilled.

create table if not exists org_units (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,
  -- 'branch' for a practice's office, 'division' for a group's division.
  kind text not null default 'branch' check (kind in ('branch', 'division')),
  created_at timestamptz not null default now()
);

create index if not exists org_units_tenant_idx on org_units (tenant_id);

-- One name per tenant, case-insensitively: two "Manchester" branches in the
-- same firm is a data-entry error, not a structure.
create unique index if not exists org_units_tenant_name_idx
  on org_units (tenant_id, lower(name));

alter table companies add column if not exists org_unit_id uuid;

-- Listing a practice's clients filters by tenant, and a branch view filters by
-- org unit. Neither had an index; at 1,500 clients both are sequential scans.
create index if not exists companies_tenant_idx on companies (tenant_id);
create index if not exists companies_org_unit_idx on companies (org_unit_id);

-- A plain FK on org_unit_id alone would allow a company in tenant A to be
-- assigned to an org unit in tenant B. The composite FK makes that
-- unrepresentable: the referenced unit must share the company's tenant.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'org_units_id_tenant_key'
  ) then
    alter table org_units add constraint org_units_id_tenant_key unique (id, tenant_id);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'companies_org_unit_same_tenant'
  ) then
    alter table companies
      add constraint companies_org_unit_same_tenant
      foreign key (org_unit_id, tenant_id)
      references org_units (id, tenant_id)
      on delete set null;
  end if;
end $$;

-- Access to an org unit follows access to the tenant. has_company_access is
-- per-company and cannot answer "may this user see the firm's structure", so
-- this is the tenant-level equivalent, built on the same user_company_access
-- table and the same active-user rule.
create or replace function has_tenant_access(p_tenant_id uuid)
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
      and app_user.status = 'active'
  );
$$;

alter table org_units enable row level security;

drop policy if exists "Users can read org units in their tenant" on org_units;
create policy "Users can read org units in their tenant"
  on org_units for select
  using (has_tenant_access(tenant_id));
