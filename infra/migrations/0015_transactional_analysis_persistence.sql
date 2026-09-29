-- Persist a complete analysis as one database transaction. Any invalid child
-- row aborts the function call and leaves no partial job, finding, or score.
begin;
-- Reconcile columns that existed only in the legacy schema.sql and were never
-- guaranteed by the numbered migration chain.
alter table findings add column if not exists analysis_job_id uuid references analysis_jobs(id);
alter table findings add column if not exists upload_id uuid references uploads(id);
alter table findings add column if not exists rule_id text references rule_registry(id);
alter table findings add column if not exists confidence_score numeric(5,2);
alter table findings add column if not exists evidence_strength text not null default 'indicator';
alter table findings add column if not exists evidence jsonb not null default '{}';
alter table findings add column if not exists review_action text;
alter table findings add column if not exists review_reason text;
alter table findings add column if not exists reviewed_at timestamptz;
create or replace function persist_analysis_result(p jsonb)
returns void language plpgsql security invoker set search_path=public as $$
declare j jsonb:=p->'job'; s jsonb:=p->'score'; a jsonb:=p->'audit';
begin
 if not has_company_capability((j->>'tenant_id')::uuid,(j->>'company_id')::uuid,'prepare')
 then raise exception 'Prepare capability required'; end if;
 insert into analysis_jobs(id,tenant_id,company_id,job_type,status,input_upload_ids,result_summary,started_at,completed_at)
 select id,tenant_id,company_id,job_type,status,input_upload_ids,result_summary,started_at,completed_at
 from jsonb_to_record(j) x(id uuid,tenant_id uuid,company_id uuid,job_type text,status text,input_upload_ids uuid[],result_summary jsonb,started_at timestamptz,completed_at timestamptz);
 insert into uploads(id,tenant_id,company_id,file_type,file_url,storage_key,uploaded_at)
 select id,tenant_id,company_id,file_type,file_url,storage_key,uploaded_at from jsonb_to_recordset(coalesce(p->'uploads','[]'))
 x(id uuid,tenant_id uuid,company_id uuid,file_type text,file_url text,storage_key text,uploaded_at timestamptz);
 insert into validation_checks(id,tenant_id,company_id,analysis_job_id,name,status,detail)
 select id,tenant_id,company_id,analysis_job_id,name,status,detail from jsonb_to_recordset(coalesce(p->'validation_checks','[]'))
 x(id uuid,tenant_id uuid,company_id uuid,analysis_job_id uuid,name text,status text,detail text);
 insert into findings(id,tenant_id,company_id,analysis_job_id,upload_id,rule_id,severity,category,title,description,expected_impact,status,confidence,confidence_score,evidence_strength,source_file,account_code,period,calculation,evidence,reviewer,review_action,review_reason,reviewed_at)
 select id,tenant_id,company_id,analysis_job_id,upload_id,rule_id,severity,category,title,description,expected_impact,status,confidence,confidence_score,evidence_strength,source_file,account_code,period,calculation,evidence,reviewer,review_action,review_reason,reviewed_at
 from jsonb_to_recordset(coalesce(p->'findings','[]')) x(id uuid,tenant_id uuid,company_id uuid,analysis_job_id uuid,upload_id uuid,rule_id text,severity text,category text,title text,description text,expected_impact text,status text,confidence text,confidence_score numeric,evidence_strength text,source_file text,account_code text,period text,calculation text,evidence jsonb,reviewer text,review_action text,review_reason text,reviewed_at timestamptz);
 insert into finding_evidence_rows(id,tenant_id,company_id,finding_id,upload_id,source_file,sheet_name,row_index,account_code,period,amount,source_row,calculation_input)
 select id,tenant_id,company_id,finding_id,upload_id,source_file,sheet_name,row_index,account_code,period,amount,source_row,calculation_input
 from jsonb_to_recordset(coalesce(p->'evidence','[]')) x(id uuid,tenant_id uuid,company_id uuid,finding_id uuid,upload_id uuid,source_file text,sheet_name text,row_index int,account_code text,period text,amount numeric,source_row jsonb,calculation_input jsonb);
 insert into recommendations(id,tenant_id,company_id,finding_id,action,expected_impact,priority,completed)
 select id,tenant_id,company_id,finding_id,action,expected_impact,priority,completed from jsonb_to_recordset(coalesce(p->'recommendations','[]'))
 x(id uuid,tenant_id uuid,company_id uuid,finding_id uuid,action text,expected_impact text,priority text,completed boolean);
 insert into finance_health_scores(id,tenant_id,company_id,score,risk_level)
 values((s->>'id')::uuid,(s->>'tenant_id')::uuid,(s->>'company_id')::uuid,(s->>'score')::int,s->>'risk_level');
 insert into audit_logs(id,tenant_id,user_id,action,entity_type,entity_id)
 values((a->>'id')::uuid,(a->>'tenant_id')::uuid,(a->>'user_id')::uuid,a->>'action',a->>'entity_type',(a->>'entity_id')::uuid);
end $$;
revoke all on function persist_analysis_result(jsonb) from public,anon;
grant execute on function persist_analysis_result(jsonb) to authenticated,service_role;
commit;
