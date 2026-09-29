begin;
alter table uploads alter column retention_until set default(now()+interval '90 days');
alter table analysis_jobs alter column retention_until set default(now()+interval '365 days');
update uploads set retention_until=uploaded_at+interval '90 days' where retention_until is null;
update analysis_jobs set retention_until=created_at+interval '365 days' where retention_until is null;
create index if not exists analysis_jobs_retention_idx on analysis_jobs(retention_until) where retention_until is not null;
create index if not exists audit_logs_created_idx on audit_logs(created_at);
create index if not exists integrations_last_synced_idx on accounting_integrations(last_synced_at) where last_synced_at is not null;

create or replace function purge_expired_retention(p_now timestamptz default now(),p_batch_size int default 500)
returns jsonb language plpgsql security definer set search_path=public as $$
declare uploads_n int:=0;jobs_n int:=0;runs_n int:=0;tokens_n int:=0;audits_n int:=0;
begin
 p_batch_size:=greatest(1,least(p_batch_size,5000));
 with doomed as(select id from uploads where deleted_at is not null and retention_until<p_now order by retention_until limit p_batch_size)
 update findings set upload_id=null where upload_id in(select id from doomed);
 with doomed as(select id from uploads where deleted_at is not null and retention_until<p_now order by retention_until limit p_batch_size)
 update finding_evidence_rows set upload_id=null where upload_id in(select id from doomed);
 with doomed as(select id from uploads where deleted_at is not null and retention_until<p_now order by retention_until limit p_batch_size)
 delete from uploads where id in(select id from doomed);get diagnostics uploads_n=row_count;
 with doomed as(select id from analysis_jobs where retention_until<p_now order by retention_until limit p_batch_size)
 update findings set analysis_job_id=null where analysis_job_id in(select id from doomed);
 with doomed as(select id from analysis_jobs where retention_until<p_now order by retention_until limit p_batch_size)
 update validation_checks set analysis_job_id=null where analysis_job_id in(select id from doomed);
 with doomed as(select id from analysis_jobs where retention_until<p_now order by retention_until limit p_batch_size)
 delete from analysis_jobs where id in(select id from doomed);get diagnostics jobs_n=row_count;
 with doomed as(select id from accounting_sync_runs where coalesce(completed_at,started_at)<p_now-interval '365 days' order by started_at limit p_batch_size)
 delete from accounting_sync_runs where id in(select id from doomed);get diagnostics runs_n=row_count;
 with stale as(select id from accounting_integrations where coalesce(last_synced_at,created_at)<p_now-interval '90 days' and status<>'retention_expired' order by coalesce(last_synced_at,created_at) limit p_batch_size)
 update accounting_integrations set access_token_encrypted='[purged]',refresh_token_encrypted='[purged]',id_token_encrypted=null,status='retention_expired',updated_at=p_now where id in(select id from stale);
 get diagnostics tokens_n=row_count;
 with doomed as(select id from audit_logs where created_at<p_now-interval '730 days' order by created_at limit p_batch_size)
 delete from audit_logs where id in(select id from doomed);get diagnostics audits_n=row_count;
 return jsonb_build_object('uploads',uploads_n,'analysis_jobs',jobs_n,'sync_runs',runs_n,'integration_tokens',tokens_n,'audit_logs',audits_n);
end $$;
revoke all on function purge_expired_retention(timestamptz,int) from public,anon,authenticated;
grant execute on function purge_expired_retention(timestamptz,int) to service_role;
commit;
