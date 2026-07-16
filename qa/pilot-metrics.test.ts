import test from "node:test";
import assert from "node:assert/strict";
import { buildPilotMetrics } from "../apps/web/lib/pilot-metrics";
import type { AnalysisResult, Finding } from "../apps/web/lib/types";

function finding(over: Partial<Finding>): Finding {
  return {
    id: over.id ?? "f1", tenantId: "t", companyId: "c", severity: over.severity ?? "high",
    category: over.category ?? "vat", title: over.title ?? "Finding", description: "desc",
    expectedImpact: over.expectedImpact ?? "£1,000", status: over.status ?? "open",
    confidence: "medium", evidence: over.evidence ?? { sourceFile: "vat.csv", period: "May", calculation: "x" },
    amount: over.amount, evidenceStrength: over.evidenceStrength,
  } as Finding;
}

function snapshot(over: Partial<AnalysisResult>): AnalysisResult {
  return {
    uploads: over.uploads ?? [{ id: "u1", tenantId: "t", companyId: "c", fileType: "vat_report", fileName: "vat.csv", uploadedAt: "2026-07-01" } as never],
    validationChecks: [], findings: over.findings ?? [], importProfiles: [],
    findingEvidence: [], findingComments: [], findingActivities: over.findingActivities ?? [],
    collectionCases: [], partnerSignOff: over.partnerSignOff, recommendations: [],
  } as AnalysisResult;
}

test("aggregates reviews, findings, hours saved and £ capacity across companies", () => {
  const m = buildPilotMetrics([
    snapshot({ findings: [finding({ id: "a", amount: 500 }), finding({ id: "b", amount: 300 })] }),
    snapshot({ findings: [finding({ id: "c", amount: 200 })] }),
    snapshot({ uploads: [], findings: [] }), // not reviewed
  ]);
  assert.equal(m.companiesTotal, 3);
  assert.equal(m.reviewsCompleted, 2);
  assert.equal(m.totalFindings, 3);
  assert.ok(m.hoursSaved > 0);
  assert.equal(m.managerValue, Math.round(m.hoursSaved * 80));
  assert.equal(m.openExposure, 1000); // 500 + 300 + 200, all open non-advisory
});

test("evidence traceability reflects the share of evidence-linked findings", () => {
  const m = buildPilotMetrics([
    snapshot({ findings: [
      finding({ id: "a", evidence: { sourceFile: "vat.csv", period: "May", calculation: "x" } }),
      finding({ id: "b", evidence: { sourceFile: "", period: "May", calculation: "x" } }),
    ] }),
  ]);
  assert.equal(m.evidenceTraceabilityPct, 50);
});

test("turnaround and pre-sign-off metrics use real timestamps; undefined when no sign-off", () => {
  const noSignoff = buildPilotMetrics([snapshot({ findings: [finding({ id: "a" })] })]);
  assert.equal(noSignoff.avgTurnaroundDays, undefined);
  assert.equal(noSignoff.issuesSurfacedPreSignOffPct, undefined);
  assert.equal(noSignoff.signedOffCount, 0);

  const signed = buildPilotMetrics([snapshot({
    uploads: [{ id: "u1", tenantId: "t", companyId: "c", fileType: "vat_report", fileName: "vat.csv", uploadedAt: "2026-07-01T09:00:00.000Z" } as never],
    findings: [finding({ id: "a" })],
    findingActivities: [{ id: "act1", findingId: "a", action: "created", userId: "u", timestamp: "2026-07-01T09:00:00.000Z" }],
    partnerSignOff: { status: "signed", signedBy: "Partner", signedAt: "2026-07-03T09:00:00.000Z", gateSnapshot: {} } as never,
  })]);
  assert.equal(signed.signedOffCount, 1);
  assert.equal(signed.avgTurnaroundDays, 2); // first activity 07-01 09:00 -> sign-off 07-03 09:00 = 2 days
  assert.equal(signed.issuesSurfacedPreSignOffPct, 100); // created before sign-off
});
