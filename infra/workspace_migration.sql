-- Run this in Supabase SQL Editor
create table if not exists user_workspaces (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  data jsonb not null default '{}',
  updated_at timestamptz not null default now(),
  unique(user_id)
);

alter table user_workspaces enable row level security;

create policy "Users can read their own workspace"
  on user_workspaces for select
  using (auth.uid() = user_id);

create policy "Users can insert their own workspace"
  on user_workspaces for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own workspace"
  on user_workspaces for update
  using (auth.uid() = user_id);

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
