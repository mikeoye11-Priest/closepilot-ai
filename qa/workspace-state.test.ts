import test from "node:test";
import assert from "node:assert/strict";
import { isWorkspaceState } from "../apps/web/lib/workspace-state";

const shell = {
  tenant: { id: "t1", name: "Firm", type: "accounting_practice", plan: "practice" },
  companies: [{ id: "c1", tenantId: "t1", name: "Client" }],
  currentCompanyId: "c1",
  portfolioClients: []
};

test("a server shell with no snapshots is valid", () => {
  // The regression this file exists for. Snapshots moved to their own rows, so
  // the shell no longer carries them. A guard that required companySnapshots
  // rejected every server response, which silently fell every load back to the
  // local cache and left a user on a new device with nothing.
  assert.equal(isWorkspaceState(shell), true);
});

test("a legacy blob and a local cache, which do carry snapshots, are valid", () => {
  assert.equal(isWorkspaceState({ ...shell, companySnapshots: {} }), true);
  assert.equal(isWorkspaceState({ ...shell, companySnapshots: { c1: { uploads: [] } } }), true);
});

test("the crash case is still rejected", () => {
  // restoreWorkspace does parsed.companies.find(...) immediately; without
  // companies that is a white screen only clearing site data escapes.
  assert.equal(isWorkspaceState({ ...shell, companies: undefined }), false);
  assert.equal(isWorkspaceState({ ...shell, companies: {} }), false);
});

test("near-misses a loose check would wave through", () => {
  assert.equal(isWorkspaceState({ ...shell, portfolioClients: undefined }), false);
  assert.equal(isWorkspaceState({ ...shell, tenant: null }), false);
  assert.equal(isWorkspaceState({ ...shell, currentCompanyId: 3 }), false);
  // Present but the wrong kind: the restore indexes into it.
  assert.equal(isWorkspaceState({ ...shell, companySnapshots: null }), false);
  assert.equal(isWorkspaceState({ ...shell, companySnapshots: [] }), false);
  assert.equal(isWorkspaceState({ ...shell, companySnapshots: "x" }), false);
});

test("non-objects are rejected", () => {
  for (const value of [null, undefined, [], "workspace", 7, true, {}]) {
    assert.equal(isWorkspaceState(value), false, `${JSON.stringify(value)} must not pass`);
  }
});

test("optional fields may be absent or present", () => {
  assert.equal(isWorkspaceState({ ...shell, orgUnits: [], callerRoles: ["manager"] }), true);
  assert.equal(isWorkspaceState({ ...shell, reportSchedules: [], scheduledReports: [] }), true);
});
