begin;

create or replace function has_tenant_capability(p_tenant_id uuid, p_capability text)
returns boolean language sql security definer set search_path = public stable as $$
  with applicable_roles(role) as (
    select access.role from user_company_access access join users app_user on app_user.id=access.user_id
     where access.user_id=auth.uid() and access.tenant_id=p_tenant_id and app_user.status='active'
    union
    select scope.role from user_scope_access scope join users app_user on app_user.id=scope.user_id
     where scope.user_id=auth.uid() and scope.tenant_id=p_tenant_id and app_user.status='active'
  )
  select exists(select 1 from applicable_roles where case p_capability
    when 'view' then role in ('practice_admin','manager','preparer','client_user')
    when 'erase_data' then role='practice_admin' else false end);
$$;
revoke all on function has_tenant_capability(uuid,text) from public,anon;
grant execute on function has_tenant_capability(uuid,text) to authenticated,service_role;

create table if not exists retention_holds(
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null references tenants(id),
 company_id uuid references companies(id),
 category text not null check(category in('all','raw_uploads','analysis_jobs','audit_logs','sync_runs','integration_tokens')),
 resource_id uuid,
 reason text not null check(length(btrim(reason)) between 3 and 2000),
 created_by uuid not null references users(id),
 created_at timestamptz not null default now(),
 released_by uuid references users(id),
 released_at timestamptz,
 release_reason text,
 check(company_id is not null or resource_id is null),
 check((released_at is null and released_by is null) or (released_at is not null and released_by is not null))
);
create index if not exists retention_holds_active_scope_idx on retention_holds(tenant_id,company_id,category,resource_id) where released_at is null;

create table if not exists retention_purge_runs(
 id uuid primary key default gen_random_uuid(),
 status text not null default 'running' check(status in('running','completed','failed')),
 started_at timestamptz not null default now(),
 completed_at timestamptz,
 attempt_count integer not null default 1 check(attempt_count between 1 and 10),
 next_retry_at timestamptz,
 storage_objects integer not null default 0 check(storage_objects>=0),
 purged_counts jsonb not null default '{}'::jsonb,
 error_code text,
 error_message text,
 check(status='running' or completed_at is not null),
 check(status<>'failed' or(error_code is not null and error_message is not null and next_retry_at is not null))
);
create index if not exists retention_purge_runs_status_started_idx on retention_purge_runs(status,started_at desc);
create index if not exists retention_purge_runs_retry_idx on retention_purge_runs(next_retry_at) where status='failed';

alter table retention_holds enable row level security;
alter table retention_purge_runs enable row level security;
drop policy if exists "Members can read retention holds" on retention_holds;
create policy "Members can read retention holds" on retention_holds for select using(has_tenant_capability(tenant_id,'view'));
drop policy if exists "Partners can create retention holds" on retention_holds;
create policy "Partners can create retention holds" on retention_holds for insert with check(
 has_tenant_capability(tenant_id,'erase_data') and created_by=auth.uid()
 and(retention_holds.company_id is null or exists(
   select 1 from companies company
   where company.id=retention_holds.company_id and company.tenant_id=retention_holds.tenant_id
 ))
);
drop policy if exists "Partners can release retention holds" on retention_holds;
create policy "Partners can release retention holds" on retention_holds for update using(has_tenant_capability(tenant_id,'erase_data')) with check(has_tenant_capability(tenant_id,'erase_data') and released_by=auth.uid());
drop policy if exists "Service manages retention purge runs" on retention_purge_runs;
create policy "Service manages retention purge runs" on retention_purge_runs for all to service_role
 using(true) with check(true);

create or replace function retention_is_held(p_tenant_id uuid,p_company_id uuid,p_category text,p_resource_id uuid)
returns boolean language sql security definer set search_path=public stable as $$
 select exists(select 1 from retention_holds hold where hold.tenant_id=p_tenant_id and hold.released_at is null
  and(hold.company_id is null or hold.company_id=p_company_id)
  and(hold.category='all' or hold.category=p_category)
  and(hold.resource_id is null or hold.resource_id=p_resource_id));
$$;
revoke all on function retention_is_held(uuid,uuid,text,uuid) from public,anon,authenticated;
grant execute on function retention_is_held(uuid,uuid,text,uuid) to service_role;

create or replace function list_expired_retention_uploads(p_now timestamptz default now(),p_batch_size int default 500)
returns table(id uuid,storage_key text) language sql security definer set search_path=public as $$
 select upload.id,upload.storage_key from uploads upload
 where upload.deleted_at is null and upload.retention_until<p_now
 and not retention_is_held(upload.tenant_id,upload.company_id,'raw_uploads',upload.id)
 order by upload.retention_until limit greatest(1,least(p_batch_size,5000));
$$;
revoke all on function list_expired_retention_uploads(timestamptz,int) from public,anon,authenticated;
grant execute on function list_expired_retention_uploads(timestamptz,int) to service_role;

create or replace function purge_expired_retention(p_now timestamptz default now(),p_batch_size int default 500)
returns jsonb language plpgsql security definer set search_path=public as $$
declare uploads_n int:=0;jobs_n int:=0;runs_n int:=0;tokens_n int:=0;audits_n int:=0;
begin
 p_batch_size:=greatest(1,least(p_batch_size,5000));
 with doomed as(select id from uploads where deleted_at is not null and retention_until<p_now and not retention_is_held(tenant_id,company_id,'raw_uploads',id) order by retention_until limit p_batch_size)
 update findings set upload_id=null where upload_id in(select id from doomed);
 with doomed as(select id from uploads where deleted_at is not null and retention_until<p_now and not retention_is_held(tenant_id,company_id,'raw_uploads',id) order by retention_until limit p_batch_size)
 update finding_evidence_rows set upload_id=null where upload_id in(select id from doomed);
 with doomed as(select id from uploads where deleted_at is not null and retention_until<p_now and not retention_is_held(tenant_id,company_id,'raw_uploads',id) order by retention_until limit p_batch_size)
 delete from uploads where id in(select id from doomed);get diagnostics uploads_n=row_count;
 with doomed as(select id from analysis_jobs where retention_until<p_now and not retention_is_held(tenant_id,company_id,'analysis_jobs',id) order by retention_until limit p_batch_size)
 update findings set analysis_job_id=null where analysis_job_id in(select id from doomed);
 with doomed as(select id from analysis_jobs where retention_until<p_now and not retention_is_held(tenant_id,company_id,'analysis_jobs',id) order by retention_until limit p_batch_size)
 update validation_checks set analysis_job_id=null where analysis_job_id in(select id from doomed);
 with doomed as(select id from analysis_jobs where retention_until<p_now and not retention_is_held(tenant_id,company_id,'analysis_jobs',id) order by retention_until limit p_batch_size)
 delete from analysis_jobs where id in(select id from doomed);get diagnostics jobs_n=row_count;
 with doomed as(select id from accounting_sync_runs where coalesce(completed_at,started_at)<p_now-interval '365 days' and not retention_is_held(tenant_id,company_id,'sync_runs',id) order by started_at limit p_batch_size)
 delete from accounting_sync_runs where id in(select id from doomed);get diagnostics runs_n=row_count;
 with stale as(select id from accounting_integrations where coalesce(last_synced_at,created_at)<p_now-interval '90 days' and status<>'retention_expired' and not retention_is_held(tenant_id,company_id,'integration_tokens',id) order by coalesce(last_synced_at,created_at) limit p_batch_size)
 update accounting_integrations set access_token_encrypted='[purged]',refresh_token_encrypted='[purged]',id_token_encrypted=null,status='retention_expired',updated_at=p_now where id in(select id from stale);
 get diagnostics tokens_n=row_count;
 with doomed as(select id from audit_logs where created_at<p_now-interval '730 days' and not retention_is_held(tenant_id,null,'audit_logs',id) order by created_at limit p_batch_size)
 delete from audit_logs where id in(select id from doomed);get diagnostics audits_n=row_count;
 return jsonb_build_object('uploads',uploads_n,'analysis_jobs',jobs_n,'sync_runs',runs_n,'integration_tokens',tokens_n,'audit_logs',audits_n);
end $$;
revoke all on function purge_expired_retention(timestamptz,int) from public,anon,authenticated;
grant execute on function purge_expired_retention(timestamptz,int) to service_role;
commit;
