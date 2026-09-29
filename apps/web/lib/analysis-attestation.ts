import { createHmac, timingSafeEqual } from "node:crypto";
import type { AnalysisResult } from "./types";

type Claims={tenantId:string;companyId:string;digest:string;score:number;risk:string;expiresAt:number};
function secret(){return process.env.ANALYSIS_PERSISTENCE_SECRET||process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.CRON_SECRET||""}
export function attestableAnalysis(result:AnalysisResult){
 return {uploads:result.uploads,validationChecks:result.validationChecks,findings:result.findings,recommendations:result.recommendations,vatReview:result.vatReview};
}
function digest(result:AnalysisResult){return createHmac("sha256",secret()).update(JSON.stringify(attestableAnalysis(result))).digest("base64url")}
export function signAnalysis(result:AnalysisResult,tenantId:string,companyId:string,score:number,risk:string){
 const key=secret();if(!key)return null;
 const claims:Claims={tenantId,companyId,digest:digest(result),score,risk,expiresAt:Date.now()+15*60_000};
 const body=Buffer.from(JSON.stringify(claims)).toString("base64url");
 const signature=createHmac("sha256",key).update(body).digest("base64url");
 return body+"."+signature;
}
export function verifyAnalysis(token:string,result:AnalysisResult,tenantId:string,companyId:string):Claims|null{
 const key=secret(),[body,provided]=token.split(".");if(!key||!body||!provided)return null;
 const expected=createHmac("sha256",key).update(body).digest();
 let actual:Buffer;try{actual=Buffer.from(provided,"base64url")}catch{return null}
 if(actual.length!==expected.length||!timingSafeEqual(actual,expected))return null;
 let claims:Claims;try{claims=JSON.parse(Buffer.from(body,"base64url").toString())}catch{return null}
 if(claims.expiresAt<Date.now()||claims.tenantId!==tenantId||claims.companyId!==companyId)return null;
 const actualDigest=digest(result),a=Buffer.from(claims.digest),b=Buffer.from(actualDigest);
 return a.length===b.length&&timingSafeEqual(a,b)?claims:null;
}
