import test from "node:test";
import assert from "node:assert/strict";
import { planRetention, isExpired, retentionCutoff, retentionEnforcementEnabled, RETENTION_TARGETS, type RetentionItem } from "../apps/web/lib/retention";

const NOW = new Date("2026-08-06T00:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

test("cutoff is the category period before now", () => {
  // audit_logs default is 730 days.
  const cutoff = retentionCutoff("audit_logs", NOW);
  assert.equal(cutoff.toISOString(), new Date(NOW.getTime() - 730 * 86_400_000).toISOString());
});

test("an item older than its period is expired; a fresh one is retained", () => {
  assert.equal(isExpired({ id: "a", category: "integration_tokens", timestamp: daysAgo(120) }, NOW), true, "120d > 90d token period");
  assert.equal(isExpired({ id: "b", category: "integration_tokens", timestamp: daysAgo(30) }, NOW), false, "30d < 90d token period");
});

test("a row exactly at the cutoff is retained (strictly-before expires)", () => {
  const at = retentionCutoff("sync_runs", NOW).toISOString();
  assert.equal(isExpired({ id: "c", category: "sync_runs", timestamp: at }, NOW), false, "exactly at cutoff is not yet expired");
});

test("a missing or invalid timestamp is never expired (we don't delete data of unknown age)", () => {
  assert.equal(isExpired({ id: "d", category: "audit_logs", timestamp: null }, NOW), false);
  assert.equal(isExpired({ id: "e", category: "audit_logs", timestamp: undefined }, NOW), false);
  assert.equal(isExpired({ id: "f", category: "audit_logs", timestamp: "not-a-date" }, NOW), false);
});

test("planRetention splits items and tallies per category against the policy periods", () => {
  const items: RetentionItem[] = [
    { id: "audit-old", category: "audit_logs", timestamp: daysAgo(800) },      // > 730 → expired
    { id: "audit-new", category: "audit_logs", timestamp: daysAgo(10) },       // retained
    { id: "run-old", category: "sync_runs", timestamp: daysAgo(400) },         // > 365 → expired
    { id: "run-new", category: "sync_runs", timestamp: daysAgo(100) },         // retained
    { id: "tok-stale", category: "integration_tokens", timestamp: daysAgo(200) }, // > 90 → expired
    { id: "tok-live", category: "integration_tokens", timestamp: null },       // unknown → retained
  ];
  const plan = planRetention(items, NOW);
  assert.deepEqual(plan.expired.map((i) => i.id).sort(), ["audit-old", "run-old", "tok-stale"]);
  assert.equal(plan.byCategory.audit_logs.expired, 1);
  assert.equal(plan.byCategory.audit_logs.retained, 1);
  assert.equal(plan.byCategory.sync_runs.expired, 1);
  assert.equal(plan.byCategory.integration_tokens.expired, 1);
  assert.equal(plan.byCategory.integration_tokens.retained, 1);
});

test("enforcement is DISABLED until every retention period is confirmed (safety interlock)", () => {
  // Periods ship as unconfirmed defaults, so an automated purge must refuse to run.
  assert.equal(retentionEnforcementEnabled(), false);
  assert.equal(planRetention([], NOW).enforcementEnabled, false);
  assert.ok(Object.values(RETENTION_TARGETS).every((t) => t.confirmed === false), "no period is pre-confirmed in code");
});

test("every retention target is bound to a real schema location", () => {
  // The mechanism must name where each category lives so a purge job is unambiguous.
  assert.equal(RETENTION_TARGETS.audit_logs.table, "audit_logs");
  assert.equal(RETENTION_TARGETS.sync_runs.table, "accounting_sync_runs");
  assert.equal(RETENTION_TARGETS.integration_tokens.table, "accounting_integrations");
  for (const target of Object.values(RETENTION_TARGETS)) {
    assert.ok(target.timestampColumn.length > 0, `${target.category} names a timestamp column`);
    assert.ok(target.days > 0, `${target.category} has a positive period`);
  }
});
