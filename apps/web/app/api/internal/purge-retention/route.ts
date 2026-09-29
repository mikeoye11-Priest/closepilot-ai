import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { authoriseWorkerRequest } from "@/lib/worker-auth";
export const runtime="nodejs";export const dynamic="force-dynamic";export const maxDuration=300;
const BUCKET=process.env.CLOSEPILOT_UPLOAD_BUCKET||"finance-uploads";
export async function POST(request:Request){
 const auth=authoriseWorkerRequest(request.headers.get("authorization"),process.env.CRON_SECRET);
 if(!auth.ok)return NextResponse.json({error:auth.error},{status:auth.status});
 if(process.env.RETENTION_ENFORCEMENT_ENABLED!=="1")return NextResponse.json({error:"Retention enforcement is not enabled."},{status:503});
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!url||!key)return NextResponse.json({error:"Retention service credentials are not configured."},{status:503});
 const admin=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
 const now=new Date().toISOString();
 const {data:uploads,error:listError}=await admin.from("uploads").select("id,storage_key").lt("retention_until",now).is("deleted_at",null).limit(500);
 if(listError)return NextResponse.json({error:listError.message},{status:500});
 const keys=(uploads??[]).map(row=>row.storage_key).filter((key):key is string=>Boolean(key));
 if(keys.length){const {error}=await admin.storage.from(BUCKET).remove(keys);if(error)return NextResponse.json({error:`Storage purge failed: ${error.message}`},{status:503})}
 const ids=(uploads??[]).map(row=>row.id);
 if(ids.length){const {error}=await admin.from("uploads").update({deleted_at:now,ingestion_status:"retention_deleted"}).in("id",ids);if(error)return NextResponse.json({error:error.message},{status:500})}
 const {data:purged,error:purgeError}=await admin.rpc("purge_expired_retention",{p_now:now,p_batch_size:500});
 if(purgeError)return NextResponse.json({error:purgeError.message},{status:500});
 return NextResponse.json({purged,storageObjects:keys.length,completedAt:now});
}
export async function GET(request:Request){return POST(request)}
