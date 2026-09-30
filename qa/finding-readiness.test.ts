import assert from "node:assert/strict";
import test from "node:test";
import { readinessForecast, signOffTrafficLight, trafficLightClasses } from "../apps/web/lib/finding-readiness";
import type { Finding, Upload, ValidationCheck } from "../apps/web/lib/types";

function finding(id: string, severity: Finding["severity"], status: Finding["status"]): Finding {
  return {
    id,
    tenantId: "tenant-1",
    companyId: "company-1",
    severity,
    category: "controls",
    title: `${severity} review item`,
    description: "Review item",
    expectedImpact: "Unknown",
    status,
    confidence: "high",
    evidenceStrength: "indicator",
    evidence: { sourceFile: "trial-balance.csv", accountCode: "1000", period: "2026-09", calculation: "Review required" },
  };
}

const uploads = [{ fileType: "trial_balance" }] as Upload[];
const failedChecks = [{ status: "failed", name: "Bank reconciliation" }] as ValidationCheck[];

test("readiness forecast prioritises high-risk work and estimates review effort", () => {
  const high = finding("high-1", "high", "open");
  const medium = finding("medium-1", "medium", "open");
  const forecast = readinessForecast([medium, high], failedChecks, uploads);

  assert.equal(forecast.nextFinding?.id, "high-1");
  assert.equal(forecast.highRiskOpen, 1);
  assert.equal(forecast.open, 2);
  assert.equal(forecast.effortMinutes, 20);
  assert.ok(forecast.nextResolved >= forecast.current);
  assert.ok(forecast.allResolved >= forecast.current);
});

test("sign-off traffic state preserves blockers and accepted risks", () => {
  const blocked = signOffTrafficLight({
    signOffEnabled: false,
    signOffComplete: false,
    acceptedRiskCount: 0,
    criticalOpen: 1,
    highOpen: 2,
    validationBlockers: 1,
    evidenceOutstanding: 3,
    managerReviewComplete: false,
  });
  assert.equal(blocked.state, "red");
  assert.match(blocked.detail, /1 critical open/);
  assert.match(blocked.detail, /manager review outstanding/);

  const accepted = signOffTrafficLight({
    signOffEnabled: true,
    signOffComplete: false,
    acceptedRiskCount: 2,
    criticalOpen: 0,
    highOpen: 0,
    validationBlockers: 0,
    evidenceOutstanding: 0,
    managerReviewComplete: true,
  });
  assert.equal(accepted.state, "amber");
  assert.equal(accepted.label, "Ready With Accepted Risks");

  const signed = signOffTrafficLight({
    signOffEnabled: true,
    signOffComplete: true,
    acceptedRiskCount: 0,
    criticalOpen: 0,
    highOpen: 0,
    validationBlockers: 0,
    evidenceOutstanding: 0,
    managerReviewComplete: true,
  });
  assert.equal(signed.state, "green");
  assert.equal(signed.label, "Signed Off");
  assert.equal(trafficLightClasses(signed.state).dot, "bg-emerald-600");
});
