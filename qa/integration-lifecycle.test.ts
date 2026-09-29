import assert from "node:assert/strict";
import test from "node:test";
import { integrationActivityLabel, integrationSyncSummary } from "../apps/web/lib/integrations/lifecycle";
import type { AccountingIntegrationState } from "../apps/web/lib/integrations/types";

type Org = NonNullable<AccountingIntegrationState["organisations"]>[number];

test("integration activity labels retain provider and lifecycle action", () => {
  assert.equal(integrationActivityLabel("quickbooks_sync_completed"), "QuickBooks synced");
  assert.equal(integrationActivityLabel("sage_disconnected"), "Sage disconnected");
  assert.equal(integrationActivityLabel("integration_data_erased"), "Synced data erased");
});

test("sync summaries surface failures and reconnect requirements", () => {
  assert.equal(integrationSyncSummary({ stage: "reauth_required" } as Org), "Access was revoked or has expired — reconnect to resume syncing.");
  assert.equal(integrationSyncSummary({ sync: { status: "failed", error: "expired token" } } as Org), "Last sync failed — expired token");
});

test("completed sync summaries include imported records, period and warnings", () => {
  const summary = integrationSyncSummary({
    sync: {
      status: "completed",
      recordsImported: 42,
      periodStart: "2026-01-01",
      periodEnd: "2026-01-31",
      warnings: 1,
    },
  } as Org);
  assert.match(summary, /42 records/);
  assert.match(summary, /period 2026-01-01 → 2026-01-31/);
  assert.match(summary, /1 warning$/);
});
