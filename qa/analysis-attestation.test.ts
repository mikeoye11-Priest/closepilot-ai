import assert from "node:assert/strict";
import test from "node:test";
import { signAnalysis, verifyAnalysis } from "../apps/web/lib/analysis-attestation";
import type { AnalysisResult } from "../apps/web/lib/types";

process.env.ANALYSIS_PERSISTENCE_SECRET="test-only-analysis-secret";
const result={uploads:[],validationChecks:[],findings:[],recommendations:[]} as AnalysisResult;
test("accepts an unchanged server analysis and preserves server score",()=>{
 const token=signAnalysis(result,"tenant-a","company-a",83,"low");
 assert.ok(token);
 const claims=verifyAnalysis(token,result,"tenant-a","company-a");
 assert.equal(claims?.score,83);assert.equal(claims?.risk,"low");
});
test("rejects browser-authored findings",()=>{
 const token=signAnalysis(result,"tenant-a","company-a",83,"low")!;
 const changed={...result,findings:[{id:"injected"}]} as unknown as AnalysisResult;
 assert.equal(verifyAnalysis(token,changed,"tenant-a","company-a"),null);
});
test("rejects replay into another company",()=>{
 const token=signAnalysis(result,"tenant-a","company-a",83,"low")!;
 assert.equal(verifyAnalysis(token,result,"tenant-a","company-b"),null);
});
