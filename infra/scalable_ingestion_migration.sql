-- Scalable ingestion foundation for resumable uploads and accounting connectors.
-- Safe to run more than once in the Supabase SQL Editor.

begin;

alter table if exists public.uploads
  add column if not exists size_bytes bigint,
  add column if not exists content_hash text,
  add column if not exists ingestion_status text not null default 'stored',
  add column if not exists retention_until timestamptz,
  add column if not exists deleted_at timestamptz;

alter table if exists public.analysis_jobs
  add column if not exists source_type text not null default 'upload',
  add column if not exists progress_percent integer not null default 0,
  add column if not exists current_stage text,
  add column if not exists checkpoint jsonb not null default '{}',
  add column if not exists bytes_processed bigint not null default 0,
  add column if not exists rows_processed bigint not null default 0,
  add column if not exists attempt_count integer not null default 0,
  add column if not exists heartbeat_at timestamptz,
  add column if not exists retention_until timestamptz;

alter table if exists public.accounting_sync_runs
  add column if not exists progress_percent integer not null default 0,
  add column if not exists current_stage text,
  add column if not exists checkpoint jsonb not null default '{}',
  add column if not exists pages_processed integer not null default 0,
  add column if not exists heartbeat_at timestamptz;

create index if not exists uploads_retention_idx
  on public.uploads(retention_until)
  where deleted_at is null and retention_until is not null;

create index if not exists analysis_jobs_queue_idx
  on public.analysis_jobs(status, created_at)
  where status in ('queued', 'running');

create index if not exists accounting_sync_runs_queue_idx
  on public.accounting_sync_runs(status, started_at)
  where status in ('queued', 'running');

comment on column public.uploads.retention_until is
  'Raw source-file deletion date. ClosePilot defaults to 90 days; findings and audit evidence may be retained longer.';
comment on column public.analysis_jobs.checkpoint is
  'Resumable parser position, such as storage byte offset, sheet, row, or provider page.';
comment on column public.accounting_sync_runs.checkpoint is
  'Provider-specific cursor/page checkpoints used to resume an interrupted sync.';

commit;

