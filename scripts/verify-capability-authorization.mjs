#!/usr/bin/env node
import{existsSync,readFileSync}from"node:fs";import{execFileSync}from"node:child_process";import{fileURLToPath}from"node:url";import{dirname,join}from"node:path";
const root=join(dirname(fileURLToPath(import.meta.url)),"..");
if(!process.env.SUPABASE_DB_URL){const f=join(root,".env.migrations.local");if(existsSync(f))for(const l of readFileSync(f,"utf8").split("\n")){const m=l.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);if(m&&!process.env[m[1]])process.env[m[1]]=m[2].replace(/^["']|["']$/g,"")}}
const url=process.env.SUPABASE_DB_URL||process.env.MIGRATION_DATABASE_URL||process.env.DATABASE_URL;if(!url)throw Error("No database URL");
console.log("→ Running capability authorization proof (all fixtures roll back)…\n");
try{const out=execFileSync("psql",[url,"-v","ON_ERROR_STOP=1","-f",join(root,"infra/tests/capability_authorization.sql")],{encoding:"utf8",stdio:["ignore","pipe","pipe"]});process.stdout.write(out);if(!out.includes("PASS: role capability matrix"))throw Error("PASS marker missing");console.log("\n✓ Capability authorization proven for all supported roles.")}
catch(e){process.stderr.write(e.stdout||"");process.stderr.write(e.stderr||"");console.error("\n✗ Capability authorization proof FAILED.");process.exit(1)}
