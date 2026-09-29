\set ON_ERROR_STOP on
begin;
insert into tenants(id,name) values('dddddddd-0000-4000-8000-000000000001','Hold Test');
insert into users(id,tenant_id,email,role,status) values('dddddddd-0000-4000-8000-000000000002','dddddddd-0000-4000-8000-000000000001','hold@closepilot.invalid','practice_admin','active');
insert into companies(id,tenant_id,name) values('dddddddd-0000-4000-8000-000000000010','dddddddd-0000-4000-8000-000000000001','Held Client');
insert into uploads(id,tenant_id,company_id,file_type,file_url,storage_key,retention_until,deleted_at) values
 ('dddddddd-0000-4000-8000-000000000020','dddddddd-0000-4000-8000-000000000001','dddddddd-0000-4000-8000-000000000010','csv','held','held.csv',now()-interval '1 day',now()),
 ('dddddddd-0000-4000-8000-000000000021','dddddddd-0000-4000-8000-000000000001','dddddddd-0000-4000-8000-000000000010','csv','purge','purge.csv',now()-interval '1 day',now());
insert into analysis_jobs(id,tenant_id,company_id,job_type,status,retention_until) values
 ('dddddddd-0000-4000-8000-000000000030','dddddddd-0000-4000-8000-000000000001','dddddddd-0000-4000-8000-000000000010','upload_analysis','completed',now()-interval '1 day');
insert into retention_holds(id,tenant_id,company_id,category,resource_id,reason,created_by) values
 ('dddddddd-0000-4000-8000-000000000040','dddddddd-0000-4000-8000-000000000001','dddddddd-0000-4000-8000-000000000010','raw_uploads','dddddddd-0000-4000-8000-000000000020','Active investigation','dddddddd-0000-4000-8000-000000000002'),
 ('dddddddd-0000-4000-8000-000000000041','dddddddd-0000-4000-8000-000000000001',null,'analysis_jobs',null,'Tenant-wide analysis hold','dddddddd-0000-4000-8000-000000000002');
do $$ begin
 begin
  update retention_holds set reason='Altered evidence' where id='dddddddd-0000-4000-8000-000000000040';
  raise exception 'HOLD FAIL: active hold evidence was mutable';
 exception when others then
  if sqlerrm='HOLD FAIL: active hold evidence was mutable' then raise; end if;
 end;
end $$;
set local role service_role;
select purge_expired_retention(now(),500);
insert into retention_purge_runs(id,status,completed_at,attempt_count,next_retry_at,error_code,error_message)
 values('dddddddd-0000-4000-8000-000000000050','failed',now(),3,now()+interval '15 minutes','STORAGE_PURGE_FAILED','test failure');
reset role;
do $$ begin
 if not exists(select 1 from uploads where id='dddddddd-0000-4000-8000-000000000020') then raise exception 'HOLD FAIL: held upload purged';end if;
 if exists(select 1 from uploads where id='dddddddd-0000-4000-8000-000000000021') then raise exception 'HOLD FAIL: unheld upload retained';end if;
 if not exists(select 1 from analysis_jobs where id='dddddddd-0000-4000-8000-000000000030') then raise exception 'HOLD FAIL: tenant-held analysis purged';end if;
 if not exists(select 1 from retention_purge_runs where id='dddddddd-0000-4000-8000-000000000050' and status='failed' and attempt_count=3 and next_retry_at is not null) then raise exception 'AUDIT FAIL: failed purge not durable';end if;
end $$;
select 'PASS: legal holds exclude scoped records and failed purge attempts remain auditable' retention_hold_result;
rollback;
