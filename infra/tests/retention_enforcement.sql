\set ON_ERROR_STOP on
begin;
insert into tenants(id,name) values('eeeeeeee-0000-4000-8000-000000000001','Retention Test');
insert into users(id,tenant_id,email,role,status) values('eeeeeeee-0000-4000-8000-000000000002','eeeeeeee-0000-4000-8000-000000000001','retention@closepilot.invalid','practice_admin','active');
insert into companies(id,tenant_id,name) values('eeeeeeee-0000-4000-8000-000000000010','eeeeeeee-0000-4000-8000-000000000001','Retention Client');
insert into uploads(id,tenant_id,company_id,file_type,file_url,retention_until,deleted_at) values
 ('eeeeeeee-0000-4000-8000-000000000020','eeeeeeee-0000-4000-8000-000000000001','eeeeeeee-0000-4000-8000-000000000010','csv','test',now()-interval '1 day',now()),
 ('eeeeeeee-0000-4000-8000-000000000021','eeeeeeee-0000-4000-8000-000000000001','eeeeeeee-0000-4000-8000-000000000010','csv','test',now()+interval '1 day',null);
insert into analysis_jobs(id,tenant_id,company_id,job_type,status,retention_until) values
 ('eeeeeeee-0000-4000-8000-000000000030','eeeeeeee-0000-4000-8000-000000000001','eeeeeeee-0000-4000-8000-000000000010','upload_analysis','completed',now()-interval '1 day');
insert into findings(id,tenant_id,company_id,analysis_job_id,upload_id,severity,category,title,description,source_file,account_code,period,calculation)
 values('eeeeeeee-0000-4000-8000-000000000031','eeeeeeee-0000-4000-8000-000000000001','eeeeeeee-0000-4000-8000-000000000010','eeeeeeee-0000-4000-8000-000000000030','eeeeeeee-0000-4000-8000-000000000020','low','test','Retained finding','Evidence retained','test.csv','4000','2026','test');
insert into accounting_integrations(id,tenant_id,company_id,user_id,provider,external_tenant_id,access_token_encrypted,refresh_token_encrypted,last_synced_at)
 values('eeeeeeee-0000-4000-8000-000000000040','eeeeeeee-0000-4000-8000-000000000001','eeeeeeee-0000-4000-8000-000000000010','eeeeeeee-0000-4000-8000-000000000002','xero','retention','secret','refresh',now()-interval '91 days');
insert into accounting_sync_runs(id,tenant_id,company_id,integration_id,provider,sync_type,status,started_at,completed_at)
 values('eeeeeeee-0000-4000-8000-000000000041','eeeeeeee-0000-4000-8000-000000000001','eeeeeeee-0000-4000-8000-000000000010','eeeeeeee-0000-4000-8000-000000000040','xero','full','completed',now()-interval '366 days',now()-interval '366 days');
insert into audit_logs(id,tenant_id,user_id,action,created_at) values('eeeeeeee-0000-4000-8000-000000000050','eeeeeeee-0000-4000-8000-000000000001','eeeeeeee-0000-4000-8000-000000000002','old',now()-interval '731 days');
set local role service_role;
select purge_expired_retention(now(),500);
reset role;
do $$ begin
 if exists(select 1 from uploads where id='eeeeeeee-0000-4000-8000-000000000020') then raise exception 'RETENTION FAIL: expired upload retained';end if;
 if not exists(select 1 from uploads where id='eeeeeeee-0000-4000-8000-000000000021') then raise exception 'RETENTION FAIL: current upload deleted';end if;
 if exists(select 1 from analysis_jobs where id='eeeeeeee-0000-4000-8000-000000000030') then raise exception 'RETENTION FAIL: expired job retained';end if;
 if not exists(select 1 from findings where id='eeeeeeee-0000-4000-8000-000000000031' and upload_id is null and analysis_job_id is null) then raise exception 'RETENTION FAIL: evidence not preserved/detached';end if;
 if exists(select 1 from accounting_sync_runs where id='eeeeeeee-0000-4000-8000-000000000041') then raise exception 'RETENTION FAIL: old sync retained';end if;
 if not exists(select 1 from accounting_integrations where id='eeeeeeee-0000-4000-8000-000000000040' and access_token_encrypted='[purged]' and status='retention_expired') then raise exception 'RETENTION FAIL: token not redacted';end if;
 if exists(select 1 from audit_logs where id='eeeeeeee-0000-4000-8000-000000000050') then raise exception 'RETENTION FAIL: old audit retained';end if;
end $$;
select 'PASS: expired rows purged, tokens redacted, current data and evidence retained' retention_result;
rollback;
