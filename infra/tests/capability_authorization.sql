-- Rollback-only role/capability proof.
\set ON_ERROR_STOP on
begin;
create function pg_temp.assert_caps(v bool,p bool,r bool,s bool,i bool,e bool) returns void language plpgsql as $$
begin
 if has_company_capability('cccccccc-0000-4000-8000-000000000001','cccccccc-0000-4000-8000-000000000010','view')<>v
 or has_company_capability('cccccccc-0000-4000-8000-000000000001','cccccccc-0000-4000-8000-000000000010','prepare')<>p
 or has_company_capability('cccccccc-0000-4000-8000-000000000001','cccccccc-0000-4000-8000-000000000010','review')<>r
 or has_company_capability('cccccccc-0000-4000-8000-000000000001','cccccccc-0000-4000-8000-000000000010','sign_off')<>s
 or has_company_capability('cccccccc-0000-4000-8000-000000000001','cccccccc-0000-4000-8000-000000000010','manage_integrations')<>i
 or has_company_capability('cccccccc-0000-4000-8000-000000000001','cccccccc-0000-4000-8000-000000000010','erase_data')<>e
 then raise exception 'AUTHORIZATION FAIL: matrix mismatch for %',auth.uid(); end if;
end $$;
create function pg_temp.denied(q text) returns void language plpgsql as $$
begin begin execute q; exception when insufficient_privilege or check_violation then return; end;
 raise exception 'AUTHORIZATION FAIL: prohibited statement succeeded'; end $$;
insert into tenants(id,name,tenant_type,plan) values('cccccccc-0000-4000-8000-000000000001','Capability Test','practice','starter');
insert into users(id,tenant_id,email,role,status) values
 ('cccccccc-0000-4000-8000-000000000002','cccccccc-0000-4000-8000-000000000001','cap-admin@closepilot.invalid','practice_admin','active'),
 ('cccccccc-0000-4000-8000-000000000003','cccccccc-0000-4000-8000-000000000001','cap-manager@closepilot.invalid','manager','active'),
 ('cccccccc-0000-4000-8000-000000000004','cccccccc-0000-4000-8000-000000000001','cap-preparer@closepilot.invalid','preparer','active'),
 ('cccccccc-0000-4000-8000-000000000005','cccccccc-0000-4000-8000-000000000001','cap-client@closepilot.invalid','client_user','active');
insert into companies(id,tenant_id,name) values('cccccccc-0000-4000-8000-000000000010','cccccccc-0000-4000-8000-000000000001','Capability Client');
insert into user_company_access(user_id,tenant_id,company_id,role)
 select id,tenant_id,'cccccccc-0000-4000-8000-000000000010',role from users where tenant_id='cccccccc-0000-4000-8000-000000000001';
insert into company_snapshots(tenant_id,company_id,data) values('cccccccc-0000-4000-8000-000000000001','cccccccc-0000-4000-8000-000000000010','{}');
insert into accounting_integrations(id,tenant_id,company_id,user_id,provider,external_tenant_id,access_token_encrypted,refresh_token_encrypted)
 values('cccccccc-0000-4000-8000-000000000020','cccccccc-0000-4000-8000-000000000001','cccccccc-0000-4000-8000-000000000010','cccccccc-0000-4000-8000-000000000002','xero','cap-test','enc','enc');
insert into accounting_sync_runs(id,tenant_id,company_id,integration_id,provider,sync_type,status)
 values('cccccccc-0000-4000-8000-000000000021','cccccccc-0000-4000-8000-000000000001','cccccccc-0000-4000-8000-000000000010','cccccccc-0000-4000-8000-000000000020','xero','full','completed');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"cccccccc-0000-4000-8000-000000000005","role":"authenticated"}',true);
select pg_temp.assert_caps(true,false,false,false,false,false);
select pg_temp.denied($q$insert into uploads(id,tenant_id,company_id,file_type,file_url) values('cccccccc-0000-4000-8000-000000000030','cccccccc-0000-4000-8000-000000000001','cccccccc-0000-4000-8000-000000000010','csv','test')$q$);
do $$ begin begin perform bootstrap_workspace('cccccccc-0000-4000-8000-000000000001','Hijacked','practice','starter','cccccccc-0000-4000-8000-000000000010','Hijacked',null,null,'GBP','UK');
 exception when others then if sqlerrm like 'Only a practice administrator%' then return; end if; raise; end;
 raise exception 'AUTHORIZATION FAIL: client invoked bootstrap'; end $$;
reset role;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"cccccccc-0000-4000-8000-000000000004","role":"authenticated"}',true);
select pg_temp.assert_caps(true,true,false,false,false,false);
insert into reports(id,tenant_id,company_id,report_type) values('cccccccc-0000-4000-8000-000000000031','cccccccc-0000-4000-8000-000000000001','cccccccc-0000-4000-8000-000000000010','management_accounts');
select pg_temp.denied($q$insert into reports(id,tenant_id,company_id,report_type) values('cccccccc-0000-4000-8000-000000000032','cccccccc-0000-4000-8000-000000000001','cccccccc-0000-4000-8000-000000000010','vat_filing_signoff')$q$);
select pg_temp.denied($q$update company_snapshots set data='{"partnerSignOff":{}}' where company_id='cccccccc-0000-4000-8000-000000000010'$q$);
reset role;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"cccccccc-0000-4000-8000-000000000003","role":"authenticated"}',true);
select pg_temp.assert_caps(true,true,true,false,false,false);
select pg_temp.denied($q$insert into accounting_integrations(id,tenant_id,company_id,user_id,provider,external_tenant_id,access_token_encrypted,refresh_token_encrypted) values('cccccccc-0000-4000-8000-000000000033','cccccccc-0000-4000-8000-000000000001','cccccccc-0000-4000-8000-000000000010','cccccccc-0000-4000-8000-000000000003','xero','denied','enc','enc')$q$);
delete from accounting_sync_runs where id='cccccccc-0000-4000-8000-000000000021';
do $$ begin if not exists(select 1 from accounting_sync_runs where id='cccccccc-0000-4000-8000-000000000021') then raise exception 'AUTHORIZATION FAIL: manager erased sync'; end if; end $$;
reset role;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"cccccccc-0000-4000-8000-000000000002","role":"authenticated"}',true);
select pg_temp.assert_caps(true,true,true,true,true,true);
insert into reports(id,tenant_id,company_id,report_type) values('cccccccc-0000-4000-8000-000000000034','cccccccc-0000-4000-8000-000000000001','cccccccc-0000-4000-8000-000000000010','vat_filing_signoff');
update company_snapshots set data='{"partnerSignOff":{}}' where company_id='cccccccc-0000-4000-8000-000000000010';
delete from accounting_sync_runs where id='cccccccc-0000-4000-8000-000000000021';
do $$ begin if exists(select 1 from accounting_sync_runs where id='cccccccc-0000-4000-8000-000000000021') then raise exception 'AUTHORIZATION FAIL: admin erase denied'; end if; end $$;
reset role;
select 'PASS: role capability matrix and privileged RLS/RPC operations are enforced' authorization_result;
rollback;
