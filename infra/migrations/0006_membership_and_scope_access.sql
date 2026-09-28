-- Many-to-many membership, scope-based access, and the reviewer -> preparer
-- role rename.
--
-- Three problems this addresses:
--
-- 1. A user belonged to exactly one firm. users.tenant_id is NOT NULL and
--    users.email is globally unique, so an accountant consulting for two
--    practices, or a ClosePilot facilitator holding access to several pilot
--    firms, could not be represented at all.
--
-- 2. Access was granted one row per user per company. "Priya manages the
--    Manchester branch" meant 100 rows, and the 101st client Manchester took
--    on was invisible to her until somebody backfilled. At 1,500 clients that
--    model cannot express what a firm actually means.
--
-- 3. The role vocabulary disagreed with itself: lib/types.ts said 'reviewer',
--    while the review workflow and the pilot pack both say Preparer.

-- ---------------------------------------------------------------------------
-- 1. Membership becomes many-to-many
-- ---------------------------------------------------------------------------

-- Identity stays one row per person (email remains globally unique); which
-- firms they belong to moves to user_scope_access. tenant_id is kept as the
-- user's home tenant for existing callers such as bootstrap_workspace, but it
-- is no longer what grants access, so it must be allowed to be empty for a
-- person who belongs to several firms or none.
alter table users alter column tenant_id drop not null;

-- ---------------------------------------------------------------------------
-- 2. Scope-based access
-- ---------------------------------------------------------------------------

-- A grant over a whole tenant (org_unit_id null) or one branch/division.
-- Per-company grants in user_company_access are kept, not replaced: for a
-- client user who may see only their own entity, one row per company is
-- exactly the right shape. The two coexist and has_company_access ORs them.
create table if not exists user_scope_access (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  tenant_id uuid not null references tenants(id) on delete cascade,
  org_unit_id uuid null references org_units(id) on delete cascade,
  role text not null check (role in ('practice_admin', 'manager', 'preparer', 'client_user')),
  created_at timestamptz not null default now()
);

create index if not exists user_scope_access_user_idx on user_scope_access (user_id);
create index if not exists user_scope_access_tenant_idx on user_scope_access (tenant_id);

-- One grant per user per scope. Two partial indexes because NULL is not equal
-- to itself in a unique index: without the first, a user could collect any
-- number of duplicate tenant-wide grants.
create unique index if not exists user_scope_access_tenant_wide_idx
  on user_scope_access (user_id, tenant_id) where org_unit_id is null;
create unique index if not exists user_scope_access_unit_idx
  on user_scope_access (user_id, org_unit_id) where org_unit_id is not null;

-- An org unit belongs to exactly one tenant, so a grant naming both must agree
-- on which. Without this a grant could name tenant A and a unit in tenant B,
-- and the widened has_company_access below would honour it.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'user_scope_access_unit_same_tenant'
  ) then
    alter table user_scope_access
      add constraint user_scope_access_unit_same_tenant
      foreign key (org_unit_id, tenant_id)
      references org_units (id, tenant_id)
      on delete cascade;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. reviewer -> preparer
-- ---------------------------------------------------------------------------

update user_company_access set role = 'preparer' where role = 'reviewer';
update users set role = 'preparer' where role = 'reviewer';

-- ---------------------------------------------------------------------------
-- 4. Widen access checks
-- ---------------------------------------------------------------------------

-- Replaced rather than rewritten at every call site: every RLS policy already
-- written against has_company_access keeps working unchanged, and simply
-- starts honouring scope grants as well as per-company rows.
create or replace function has_company_access(p_tenant_id uuid, p_company_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    -- (a) the original per-company grant, still right for a client user
    select 1
    from user_company_access access
    join users app_user on app_user.id = access.user_id
    where app_user.id = auth.uid()
      and access.tenant_id = p_tenant_id
      and access.company_id = p_company_id
      and app_user.status = 'active'
  ) or exists (
    -- (b) a tenant-wide grant, or (c) a grant on the unit this company is in
    select 1
    from user_scope_access scope
    join users app_user on app_user.id = scope.user_id
    join companies company on company.id = p_company_id
    where app_user.id = auth.uid()
      and scope.tenant_id = p_tenant_id
      and company.tenant_id = p_tenant_id
      and app_user.status = 'active'
      and (scope.org_unit_id is null or scope.org_unit_id = company.org_unit_id)
  );
$$;

-- Same widening for the tenant-level check added in 0004, so a member who
-- holds only a scope grant can still see the firm's structure.
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
  ) or exists (
    select 1
    from user_scope_access scope
    join users app_user on app_user.id = scope.user_id
    where app_user.id = auth.uid()
      and scope.tenant_id = p_tenant_id
      and app_user.status = 'active'
  );
$$;

alter table user_scope_access enable row level security;

drop policy if exists "Users can read their own scope grants" on user_scope_access;
create policy "Users can read their own scope grants"
  on user_scope_access for select
  using (user_id = auth.uid());

-- A member may also see who else is in their firm, which the People page needs.
drop policy if exists "Members can read their tenant's scope grants" on user_scope_access;
create policy "Members can read their tenant's scope grants"
  on user_scope_access for select
  using (has_tenant_access(tenant_id));
