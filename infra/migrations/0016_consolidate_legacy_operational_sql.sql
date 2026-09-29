-- Consolidate operational objects that previously existed only in hand-run
-- infra/*.sql files. Keep current capability-aware write policies intact.
begin;

create table if not exists user_workspaces(
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 data jsonb not null default '{}',
 updated_at timestamptz not null default now(),
 unique(user_id)
);
alter table user_workspaces enable row level security;
drop policy if exists "Users can read their own workspace" on user_workspaces;
create policy "Users can read their own workspace" on user_workspaces for select using(auth.uid()=user_id);
drop policy if exists "Users can insert their own workspace" on user_workspaces;
create policy "Users can insert their own workspace" on user_workspaces for insert with check(auth.uid()=user_id);
drop policy if exists "Users can update their own workspace" on user_workspaces;
create policy "Users can update their own workspace" on user_workspaces for update using(auth.uid()=user_id) with check(auth.uid()=user_id);

alter table reports add column if not exists title text;
alter table reports add column if not exists export_status text not null default 'draft';
alter table reports add column if not exists metadata jsonb not null default '{}';

alter table uploads add column if not exists size_bytes bigint;
alter table uploads add column if not exists content_hash text;
alter table uploads add column if not exists ingestion_status text not null default 'stored';
alter table uploads add column if not exists retention_until timestamptz;
alter table uploads add column if not exists deleted_at timestamptz;
alter table analysis_jobs add column if not exists input_upload_ids uuid[] not null default '{}';
alter table analysis_jobs add column if not exists result_summary jsonb not null default '{}';
alter table analysis_jobs add column if not exists error_message text;
alter table analysis_jobs add column if not exists created_at timestamptz not null default now();
alter table analysis_jobs add column if not exists source_type text not null default 'upload';
alter table analysis_jobs add column if not exists progress_percent integer not null default 0;
alter table analysis_jobs add column if not exists current_stage text;
alter table analysis_jobs add column if not exists checkpoint jsonb not null default '{}';
alter table analysis_jobs add column if not exists bytes_processed bigint not null default 0;
alter table analysis_jobs add column if not exists rows_processed bigint not null default 0;
alter table analysis_jobs add column if not exists attempt_count integer not null default 0;
alter table analysis_jobs add column if not exists heartbeat_at timestamptz;
alter table analysis_jobs add column if not exists retention_until timestamptz;
alter table accounting_sync_runs add column if not exists progress_percent integer not null default 0;
alter table accounting_sync_runs add column if not exists current_stage text;
alter table accounting_sync_runs add column if not exists checkpoint jsonb not null default '{}';
alter table accounting_sync_runs add column if not exists pages_processed integer not null default 0;
alter table accounting_sync_runs add column if not exists heartbeat_at timestamptz;

create index if not exists uploads_retention_idx on uploads(retention_until) where deleted_at is null and retention_until is not null;
create index if not exists analysis_jobs_queue_idx on analysis_jobs(status,created_at) where status in('queued','running');
create index if not exists accounting_sync_runs_queue_idx on accounting_sync_runs(status,started_at) where status in('queued','running');

create or replace function claim_next_analysis_job()
returns setof analysis_jobs language plpgsql security definer set search_path=public as $$
begin
 return query update analysis_jobs job set
  status='running',current_stage='Claimed by background worker',
  progress_percent=greatest(job.progress_percent,6),attempt_count=job.attempt_count+1,
  started_at=coalesce(job.started_at,now()),heartbeat_at=now(),error_message=null
 where job.id=(select candidate.id from analysis_jobs candidate
  where candidate.job_type='large_upload_analysis' and candidate.attempt_count<3
  and(candidate.status='queued' or(candidate.status='running' and candidate.heartbeat_at<now()-interval '10 minutes'))
  order by candidate.created_at for update skip locked limit 1)
 returning job.*;
end $$;
revoke all on function claim_next_analysis_job() from public,anon,authenticated;
grant execute on function claim_next_analysis_job() to service_role;

insert into storage.buckets(id,name,public) values('finance-uploads','finance-uploads',false)
on conflict(id) do update set name=excluded.name,public=false;
update storage.buckets set file_size_limit=104857600,allowed_mime_types=array[
 'text/csv','text/tab-separated-values','text/plain','application/vnd.ms-excel',
 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/octet-stream'
] where id='finance-uploads';
drop policy if exists "Users can read scoped finance files" on storage.objects;
create policy "Users can read scoped finance files" on storage.objects for select using(
 bucket_id='finance-uploads' and(storage.foldername(name))[1]='tenants'
 and(storage.foldername(name))[3]='companies'
 and has_company_access(((storage.foldername(name))[2])::uuid,((storage.foldername(name))[4])::uuid)
);

comment on column uploads.retention_until is 'Raw source-file deletion date. ClosePilot defaults to 90 days; findings and audit evidence may be retained longer.';
comment on column analysis_jobs.checkpoint is 'Resumable parser position, such as storage byte offset, sheet, row, or provider page.';
comment on column accounting_sync_runs.checkpoint is 'Provider-specific cursor/page checkpoints used to resume an interrupted sync.';
commit;
