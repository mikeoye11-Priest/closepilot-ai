-- Prove that a late failure rolls back the earlier analysis-job insert.
\set ON_ERROR_STOP on
begin;
insert into tenants(id,name,tenant_type,plan) values('dddddddd-0000-4000-8000-000000000001','Transaction Test','practice','starter');
insert into users(id,tenant_id,email,role,status) values('dddddddd-0000-4000-8000-000000000002','dddddddd-0000-4000-8000-000000000001','transaction-test@closepilot.invalid','practice_admin','active');
insert into companies(id,tenant_id,name) values('dddddddd-0000-4000-8000-000000000010','dddddddd-0000-4000-8000-000000000001','Transaction Client');
insert into user_company_access(user_id,tenant_id,company_id,role) values('dddddddd-0000-4000-8000-000000000002','dddddddd-0000-4000-8000-000000000001','dddddddd-0000-4000-8000-000000000010','practice_admin');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"dddddddd-0000-4000-8000-000000000002","role":"authenticated"}',true);
do $$
declare payload jsonb:=jsonb_build_object(
 'job',jsonb_build_object('id','dddddddd-0000-4000-8000-000000000020','tenant_id','dddddddd-0000-4000-8000-000000000001','company_id','dddddddd-0000-4000-8000-000000000010','job_type','upload_analysis','status','completed','input_upload_ids',jsonb_build_array(),'result_summary',jsonb_build_object(),'started_at',now(),'completed_at',now()),
 'uploads','[]'::jsonb,'validation_checks','[]'::jsonb,'findings','[]'::jsonb,'evidence','[]'::jsonb,'recommendations','[]'::jsonb,
 'score',jsonb_build_object('id','dddddddd-0000-4000-8000-000000000021','tenant_id','dddddddd-0000-4000-8000-000000000001','company_id','dddddddd-0000-4000-8000-000000000010','score',80),
 'audit',jsonb_build_object('id','dddddddd-0000-4000-8000-000000000022','tenant_id','dddddddd-0000-4000-8000-000000000001','user_id','dddddddd-0000-4000-8000-000000000002','action','analysis_result_persisted','entity_type','analysis_job','entity_id','dddddddd-0000-4000-8000-000000000020'));
begin
begin
 perform persist_analysis_result(payload);
 raise exception 'TRANSACTION FAIL: deliberately invalid score unexpectedly persisted';
exception when not_null_violation then null;
end;
if exists(select 1 from analysis_jobs where id='dddddddd-0000-4000-8000-000000000020')
then raise exception 'TRANSACTION FAIL: partial analysis job survived'; end if;
if exists(select 1 from finance_health_scores where id='dddddddd-0000-4000-8000-000000000021')
then raise exception 'TRANSACTION FAIL: partial score survived'; end if;
end $$;
reset role;
select 'PASS: induced late failure rolled back the complete analysis transaction' transactionality_result;
rollback;
