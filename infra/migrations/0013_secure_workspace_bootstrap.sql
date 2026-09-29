-- Close the workspace-bootstrap privilege escalation.
--
-- The legacy function granted practice_admin on every call, including ordinary
-- workspace saves by existing client users. This replacement distinguishes a
-- genuinely new tenant/company from an existing scope and never changes a role
-- for an existing company.

begin;

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
  v_user_status text;
  v_tenant_exists boolean;
  v_company_tenant uuid;
  v_is_admin boolean := false;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  select status into v_user_status from users where id = v_user_id;
  if v_user_status is not null and v_user_status <> 'active' then
    raise exception 'Active membership required';
  end if;

  select exists(select 1 from tenants where id = p_tenant_id)
    into v_tenant_exists;
  select tenant_id into v_company_tenant
    from companies where id = p_company_id;

  if v_company_tenant is not null and v_company_tenant <> p_tenant_id then
    raise exception 'Company and tenant do not match';
  end if;

  if v_tenant_exists then
    select exists (
      select 1 from user_scope_access
      where user_id = v_user_id
        and tenant_id = p_tenant_id
        and role = 'practice_admin'
      union all
      select 1 from user_company_access
      where user_id = v_user_id
        and tenant_id = p_tenant_id
        and role = 'practice_admin'
    ) into v_is_admin;

    if not v_is_admin then
      raise exception 'Only a practice administrator may add or update companies';
    end if;
  else
    if v_company_tenant is not null then
      raise exception 'Cannot attach an existing company to a new tenant';
    end if;

    insert into tenants (id, name, tenant_type, plan)
    values (p_tenant_id, p_tenant_name, p_tenant_type, p_plan);
  end if;

  insert into users (id, tenant_id, email, role, status)
  values (v_user_id, p_tenant_id, v_email, 'practice_admin', 'active')
  on conflict (id) do update
    set email = excluded.email;

  if v_company_tenant is null then
    insert into companies (id, tenant_id, name, industry, accounting_system, currency, country)
    values (p_company_id, p_tenant_id, p_company_name, p_industry, p_accounting_system, p_currency, p_country);

    insert into user_company_access (user_id, tenant_id, company_id, role)
    values (v_user_id, p_tenant_id, p_company_id, 'practice_admin')
    on conflict (user_id, company_id) do nothing;
  else
    update companies
      set name = p_company_name,
          industry = p_industry,
          accounting_system = p_accounting_system,
          currency = p_currency,
          country = p_country
      where id = p_company_id and tenant_id = p_tenant_id;
  end if;

  -- A newly-created firm needs a tenant-wide membership. Existing admins keep
  -- their current grants; this statement never promotes a non-admin because the
  -- existing-tenant branch above has already required practice_admin.
  if not exists (
    select 1 from user_scope_access
    where user_id = v_user_id and tenant_id = p_tenant_id and org_unit_id is null
  ) then
    insert into user_scope_access (user_id, tenant_id, org_unit_id, role)
    values (v_user_id, p_tenant_id, null, 'practice_admin');
  end if;
end;
$$;

revoke all on function bootstrap_workspace(uuid, text, text, text, uuid, text, text, text, text, text) from public, anon;
grant execute on function bootstrap_workspace(uuid, text, text, text, uuid, text, text, text, text, text) to authenticated;

commit;
