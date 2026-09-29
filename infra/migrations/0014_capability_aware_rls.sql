-- Make role capabilities authoritative at the database boundary. API checks
-- improve errors, but RLS must still refuse direct PostgREST/Supabase writes.

begin;

create or replace function has_company_capability(
  p_tenant_id uuid,
  p_company_id uuid,
  p_capability text
)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  with applicable_roles(role) as (
    select access.role
      from user_company_access access
      join users app_user on app_user.id = access.user_id
     where access.user_id = auth.uid()
       and access.tenant_id = p_tenant_id
       and access.company_id = p_company_id
       and app_user.status = 'active'
    union
    select scope.role
      from user_scope_access scope
      join users app_user on app_user.id = scope.user_id
      join companies company on company.id = p_company_id
     where scope.user_id = auth.uid()
       and scope.tenant_id = p_tenant_id
       and company.tenant_id = p_tenant_id
       and app_user.status = 'active'
       and (scope.org_unit_id is null or scope.org_unit_id = company.org_unit_id)
  )
  select exists (
    select 1 from applicable_roles
     where case p_capability
       when 'view' then role in ('practice_admin', 'manager', 'preparer', 'client_user')
       when 'prepare' then role in ('practice_admin', 'manager', 'preparer')
       when 'review' then role in ('practice_admin', 'manager')
       when 'sign_off' then role = 'practice_admin'
       when 'manage_integrations' then role = 'practice_admin'
       when 'erase_data' then role = 'practice_admin'
       else false
     end
  );
$$;

revoke all on function has_company_capability(uuid, uuid, text) from public, anon;
grant execute on function has_company_capability(uuid, uuid, text) to authenticated, service_role;

-- Snapshot JSON still carries partnerSignOff. Preparers may update the review,
-- but only partners may add, change, or remove that embedded approval.
create or replace function can_write_company_snapshot(
  p_tenant_id uuid,
  p_company_id uuid,
  p_data jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_existing_signoff jsonb;
begin
  if not has_company_capability(p_tenant_id, p_company_id, 'prepare') then
    return false;
  end if;
  if has_company_capability(p_tenant_id, p_company_id, 'sign_off') then
    return true;
  end if;
  select data -> 'partnerSignOff' into v_existing_signoff
    from company_snapshots where company_id = p_company_id;
  if not found then
    return coalesce(p_data -> 'partnerSignOff', 'null'::jsonb) = 'null'::jsonb;
  end if;
  return coalesce(v_existing_signoff, 'null'::jsonb)
       = coalesce(p_data -> 'partnerSignOff', 'null'::jsonb);
end;
$$;

revoke all on function can_write_company_snapshot(uuid, uuid, jsonb) from public, anon;
grant execute on function can_write_company_snapshot(uuid, uuid, jsonb) to authenticated, service_role;

-- Keep the migration safe to exercise repeatedly in rollback-based validation.
drop policy if exists "Preparers can insert snapshots" on company_snapshots;
drop policy if exists "Preparers can update snapshots" on company_snapshots;
drop policy if exists "Preparers can add uploads" on uploads;
drop policy if exists "Preparers can update uploads" on uploads;
drop policy if exists "Preparers can delete uploads" on uploads;
drop policy if exists "Preparers can add analysis jobs" on analysis_jobs;
drop policy if exists "Preparers can update analysis jobs" on analysis_jobs;
drop policy if exists "Preparers can add findings" on findings;
drop policy if exists "Preparers can update findings" on findings;
drop policy if exists "Preparers can add finding evidence" on finding_evidence_rows;
drop policy if exists "Preparers can add finding comments" on finding_comments;
drop policy if exists "Preparers can add finding activities" on finding_activities;
drop policy if exists "Preparers can add review events" on finding_review_events;
drop policy if exists "Partners can add signoffs" on partner_signoffs;
drop policy if exists "Preparers can add validation checks" on validation_checks;
drop policy if exists "Preparers can add recommendations" on recommendations;
drop policy if exists "Preparers can update recommendations" on recommendations;
drop policy if exists "Preparers can add finance scores" on finance_health_scores;
drop policy if exists "Preparers can add cash forecasts" on cashflow_forecasts;
drop policy if exists "Preparers can add reports" on reports;
drop policy if exists "Preparers can add AI conversations" on ai_conversations;
drop policy if exists "Members can read own accounting integrations" on accounting_integrations;
drop policy if exists "Admins can add accounting integrations" on accounting_integrations;
drop policy if exists "Admins can update accounting integrations" on accounting_integrations;
drop policy if exists "Admins can delete accounting integrations" on accounting_integrations;
drop policy if exists "Members can read accounting sync runs" on accounting_sync_runs;
drop policy if exists "Admins can add accounting sync runs" on accounting_sync_runs;
drop policy if exists "Admins can update accounting sync runs" on accounting_sync_runs;
drop policy if exists "Admins can delete accounting sync runs" on accounting_sync_runs;
drop policy if exists "Preparers can upload finance files" on storage.objects;
drop policy if exists "Preparers can delete finance files" on storage.objects;

-- Snapshot writes
drop policy if exists "Users can write snapshots they can access" on company_snapshots;
drop policy if exists "Users can update snapshots they can access" on company_snapshots;
create policy "Preparers can insert snapshots" on company_snapshots for insert
  with check (can_write_company_snapshot(tenant_id, company_id, data));
create policy "Preparers can update snapshots" on company_snapshots for update
  using (has_company_capability(tenant_id, company_id, 'prepare'))
  with check (can_write_company_snapshot(tenant_id, company_id, data));

-- Upload metadata
drop policy if exists "Users can add scoped uploads" on uploads;
drop policy if exists "Users can update scoped uploads" on uploads;
drop policy if exists "Users can delete scoped uploads" on uploads;
create policy "Preparers can add uploads" on uploads for insert
  with check (has_company_capability(tenant_id, company_id, 'prepare'));
create policy "Preparers can update uploads" on uploads for update
  using (has_company_capability(tenant_id, company_id, 'prepare'))
  with check (has_company_capability(tenant_id, company_id, 'prepare'));
create policy "Preparers can delete uploads" on uploads for delete
  using (has_company_capability(tenant_id, company_id, 'prepare'));

-- Analysis jobs
drop policy if exists "Users can add scoped analysis jobs" on analysis_jobs;
drop policy if exists "Users can update scoped analysis jobs" on analysis_jobs;
create policy "Preparers can add analysis jobs" on analysis_jobs for insert
  with check (has_company_capability(tenant_id, company_id, 'prepare'));
create policy "Preparers can update analysis jobs" on analysis_jobs for update
  using (has_company_capability(tenant_id, company_id, 'prepare'))
  with check (has_company_capability(tenant_id, company_id, 'prepare'));

-- Findings and their review/evidence records
drop policy if exists "Users can add scoped findings" on findings;
drop policy if exists "Users can update scoped findings" on findings;
create policy "Preparers can add findings" on findings for insert
  with check (has_company_capability(tenant_id, company_id, 'prepare'));
create policy "Preparers can update findings" on findings for update
  using (has_company_capability(tenant_id, company_id, 'prepare'))
  with check (has_company_capability(tenant_id, company_id, 'prepare'));

drop policy if exists "Users can add scoped finding evidence" on finding_evidence_rows;
create policy "Preparers can add finding evidence" on finding_evidence_rows for insert
  with check (has_company_capability(tenant_id, company_id, 'prepare'));

drop policy if exists "Users can add scoped finding comments" on finding_comments;
create policy "Preparers can add finding comments" on finding_comments for insert
  with check (has_company_capability(tenant_id, company_id, 'prepare') and user_id = auth.uid());

drop policy if exists "Users can add scoped finding activities" on finding_activities;
create policy "Preparers can add finding activities" on finding_activities for insert
  with check (has_company_capability(tenant_id, company_id, 'prepare') and user_id = auth.uid());

drop policy if exists "Users can add scoped review events" on finding_review_events;
create policy "Preparers can add review events" on finding_review_events for insert
  with check (has_company_capability(tenant_id, company_id, 'prepare') and user_id = auth.uid());

drop policy if exists "Users can add scoped partner signoffs" on partner_signoffs;
create policy "Partners can add signoffs" on partner_signoffs for insert
  with check (has_company_capability(tenant_id, company_id, 'sign_off'));

-- Derived assurance data
drop policy if exists "Users can add scoped validation checks" on validation_checks;
create policy "Preparers can add validation checks" on validation_checks for insert
  with check (has_company_capability(tenant_id, company_id, 'prepare'));

drop policy if exists "Users can add scoped recommendations" on recommendations;
drop policy if exists "Users can update scoped recommendations" on recommendations;
create policy "Preparers can add recommendations" on recommendations for insert
  with check (has_company_capability(tenant_id, company_id, 'prepare'));
create policy "Preparers can update recommendations" on recommendations for update
  using (has_company_capability(tenant_id, company_id, 'prepare'))
  with check (has_company_capability(tenant_id, company_id, 'prepare'));

drop policy if exists "Users can add scoped finance scores" on finance_health_scores;
create policy "Preparers can add finance scores" on finance_health_scores for insert
  with check (has_company_capability(tenant_id, company_id, 'prepare'));

drop policy if exists "Users can add scoped cash forecasts" on cashflow_forecasts;
create policy "Preparers can add cash forecasts" on cashflow_forecasts for insert
  with check (has_company_capability(tenant_id, company_id, 'prepare'));

drop policy if exists "Users can add scoped reports" on reports;
create policy "Preparers can add reports" on reports for insert
  with check (
    case when report_type = 'vat_filing_signoff'
      then has_company_capability(tenant_id, company_id, 'sign_off')
      else has_company_capability(tenant_id, company_id, 'prepare')
    end
  );

drop policy if exists "Users can add scoped AI conversations" on ai_conversations;
create policy "Preparers can add AI conversations" on ai_conversations for insert
  with check (has_company_capability(tenant_id, company_id, 'prepare') and user_id = auth.uid());

-- Connector tokens are administrator-managed. Sync runs retain broad reads but
-- mutations require the same integration-management capability.
drop policy if exists "Users can manage scoped accounting integrations" on accounting_integrations;
create policy "Members can read own accounting integrations" on accounting_integrations for select
  using (has_company_access(tenant_id, company_id) and user_id = auth.uid());
create policy "Admins can add accounting integrations" on accounting_integrations for insert
  with check (has_company_capability(tenant_id, company_id, 'manage_integrations') and user_id = auth.uid());
create policy "Admins can update accounting integrations" on accounting_integrations for update
  using (has_company_capability(tenant_id, company_id, 'manage_integrations') and user_id = auth.uid())
  with check (has_company_capability(tenant_id, company_id, 'manage_integrations') and user_id = auth.uid());
create policy "Admins can delete accounting integrations" on accounting_integrations for delete
  using (has_company_capability(tenant_id, company_id, 'manage_integrations') and user_id = auth.uid());

drop policy if exists "Users can manage scoped accounting sync runs" on accounting_sync_runs;
create policy "Members can read accounting sync runs" on accounting_sync_runs for select
  using (has_company_access(tenant_id, company_id));
create policy "Admins can add accounting sync runs" on accounting_sync_runs for insert
  with check (has_company_capability(tenant_id, company_id, 'manage_integrations'));
create policy "Admins can update accounting sync runs" on accounting_sync_runs for update
  using (has_company_capability(tenant_id, company_id, 'manage_integrations'))
  with check (has_company_capability(tenant_id, company_id, 'manage_integrations'));
create policy "Admins can delete accounting sync runs" on accounting_sync_runs for delete
  using (has_company_capability(tenant_id, company_id, 'erase_data'));

-- Private finance-file storage follows the same prepare/read split as uploads.
drop policy if exists "Users can upload scoped finance files" on storage.objects;
create policy "Preparers can upload finance files" on storage.objects for insert
  with check (
    bucket_id = 'finance-uploads'
    and (storage.foldername(name))[1] = 'tenants'
    and (storage.foldername(name))[3] = 'companies'
    and has_company_capability(
      ((storage.foldername(name))[2])::uuid,
      ((storage.foldername(name))[4])::uuid,
      'prepare'
    )
  );

drop policy if exists "Users can delete scoped finance files" on storage.objects;
create policy "Preparers can delete finance files" on storage.objects for delete
  using (
    bucket_id = 'finance-uploads'
    and (storage.foldername(name))[1] = 'tenants'
    and (storage.foldername(name))[3] = 'companies'
    and has_company_capability(
      ((storage.foldername(name))[2])::uuid,
      ((storage.foldername(name))[4])::uuid,
      'prepare'
    )
  );

commit;
