import assert from "node:assert/strict";
import test from "node:test";
import type { AnalysisResult, ImportMappingProfile, PartnerSignOff, Recommendation, Upload } from "../apps/web/lib/types";
import { emptySnapshot, fetchCompanySnapshot, mergeImportProfiles, normaliseSnapshot } from "../apps/web/lib/workspace-snapshots";

test("demo ids never call the persistence API", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    throw new Error("should not fetch");
  };
  try {
    assert.deepEqual(await fetchCompanySnapshot("company_pilot_brightlane"), { ok: true, snapshot: null });
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("normalising a locked snapshot completes recommendations without mutating the input", () => {
  const recommendation = { id: "recommendation-1", completed: false } as Recommendation;
  const snapshot = {
    ...emptySnapshot(),
    uploads: [{ id: "upload-1" } as Upload],
    recommendations: [recommendation],
    partnerSignOff: { status: "signed" } as PartnerSignOff,
  } satisfies AnalysisResult;
  const normalised = normaliseSnapshot(snapshot);
  assert.equal(normalised.recommendations[0]?.completed, true);
  assert.equal(snapshot.recommendations[0]?.completed, false);
});

test("confirmed import mappings survive refreshed suggestions", () => {
  const existing = {
    id: "profile-1",
    profileName: "Confirmed",
    fileType: "trial_balance",
    mapping: { Account: "account_code" },
    fields: [],
    confidence: 1,
    status: "confirmed",
    source: "reviewer_confirmed",
    lastUsedAt: "2026-01-01T00:00:00.000Z",
  } satisfies ImportMappingProfile;
  const incoming = {
    ...existing,
    profileName: "New suggestion",
    status: "suggested",
    source: "suggested",
    lastUsedAt: "2026-02-01T00:00:00.000Z",
  } satisfies ImportMappingProfile;
  assert.deepEqual(mergeImportProfiles([existing], [incoming]), [{
    ...existing,
    lastUsedAt: incoming.lastUsedAt,
  }]);
});
