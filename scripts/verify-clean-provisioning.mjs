#!/usr/bin/env node
import{mkdtempSync,rmSync}from"node:fs";import{tmpdir}from"node:os";import{join}from"node:path";import{spawnSync}from"node:child_process";
const root=join(import.meta.dirname,".."),data=mkdtempSync(join(tmpdir(),"closepilot-pg-")),sock=mkdtempSync(join(tmpdir(),"closepilot-sock-")),port=56000+Math.floor(Math.random()*3000);
const bin=["/usr/lib/postgresql/18/bin","/usr/lib/postgresql/17/bin","/usr/lib/postgresql/16/bin"].find(p=>spawnSync(join(p,"postgres"),["--version"]).status===0);if(!bin)throw Error("Local PostgreSQL server binaries are required.");
const run=(cmd,args,opt={})=>{const r=spawnSync(cmd,args,{cwd:root,encoding:"utf8",stdio:"pipe",...opt});if(r.status!==0)throw Error((r.stdout||"")+(r.stderr||""));return r.stdout||""};let started=false;
try{
 run(join(bin,"initdb"),["-D",data,"-A","trust","--no-locale"]);run(join(bin,"pg_ctl"),["-D",data,"-o",`-k ${sock} -p ${port}`,"-w","start"],{stdio:"ignore"});started=true;
 const url=`postgresql://${process.env.USER||"postgres"}@localhost:${port}/postgres?host=${sock}`;
 const shim=`create role anon nologin;create role authenticated nologin;create role service_role nologin;create schema auth;create table auth.users(id uuid primary key,email text);create function auth.uid() returns uuid language sql stable as $$select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid$$;create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}')$$;create schema storage;create table storage.buckets(id text primary key,name text not null,public boolean not null default false,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text not null,owner uuid);create function storage.foldername(name text) returns text[] language sql immutable as $$select string_to_array(name,'/')$$;grant usage on schema auth,storage to anon,authenticated,service_role;grant select,insert,update,delete on all tables in schema storage to authenticated,service_role;`;
 run("psql",[url,"-v","ON_ERROR_STOP=1","-c",shim]);const env={...process.env,SUPABASE_DB_URL:url};run("node",["scripts/migrate.mjs"],{env});const second=run("node",["scripts/migrate.mjs"],{env});if(!second.includes("Up to date"))throw Error("Second migration run was not clean.");
 const expected=run("bash",["-lc","find infra/migrations -maxdepth 1 -name '*.sql' | wc -l"]).trim(),counts=run("psql",[url,"-Atc","select count(*)||':'||(select count(*) from information_schema.tables where table_schema='public') from schema_migrations;"]).trim().split(":");
 if(counts[0]!==expected||Number(counts[1])<29)throw Error(`Provisioned schema incomplete: migrations=${counts[0]}/${expected}, tables=${counts[1]}`);
 run("psql",[url,"-v","ON_ERROR_STOP=1","-c","grant select,insert,update,delete on all tables in schema public to authenticated,service_role; grant usage,select on all sequences in schema public to authenticated,service_role;"]);
 const proofs=[
  ["RLS coverage","infra/tests/rls_coverage.sql","PASS:"],
  ["tenant isolation","infra/tests/tenant_isolation.sql","PASS: tenant B"],
  ["right to erasure","infra/tests/erasure_proof.sql","PASS: target erased"],
  ["capability authorization","infra/tests/capability_authorization.sql","PASS: role capability matrix"],
  ["analysis transactionality","infra/tests/analysis_transactionality.sql","PASS: induced late failure"],
  ["retention enforcement","infra/tests/retention_enforcement.sql","PASS: expired rows purged"],
 ];
 for(const[name,file,marker]of proofs){const output=run("psql",[url,"-v","ON_ERROR_STOP=1","-f",file]);if(!output.includes(marker))throw Error(`${name} proof did not emit its PASS marker.`);console.log(`PASS: ${name}`)}
 console.log(`PASS: clean database provisioned with ${counts[0]} migrations and ${counts[1]} public tables; repeat run was clean.`);
}finally{if(started)spawnSync(join(bin,"pg_ctl"),["-D",data,"-m","fast","-w","stop"],{stdio:"ignore"});rmSync(data,{recursive:true,force:true});rmSync(sock,{recursive:true,force:true})}
