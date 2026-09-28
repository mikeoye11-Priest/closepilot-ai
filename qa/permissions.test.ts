import test from "node:test";
import assert from "node:assert/strict";
import { can, canGrantRole, capabilitiesFor, isFirmRole, roleLabel, type FirmRole } from "../apps/web/lib/permissions";

test("the four-eyes split holds: a manager cannot sign off their own review", () => {
  assert.equal(can(["manager"], "review"), true);
  assert.equal(can(["manager"], "sign_off"), false, "manager approving AND signing off is not a control");
  assert.equal(can(["practice_admin"], "sign_off"), true);
});

test("a preparer prepares but does not approve", () => {
  assert.equal(can(["preparer"], "prepare"), true);
  assert.equal(can(["preparer"], "review"), false);
  assert.equal(can(["preparer"], "sign_off"), false);
});

test("a client user reads and nothing else", () => {
  assert.deepEqual(capabilitiesFor(["client_user"]), ["view"]);
  assert.equal(can(["client_user"], "prepare"), false);
});

test("only a partner manages members and structure", () => {
  for (const role of ["manager", "preparer", "client_user"] as FirmRole[]) {
    assert.equal(can([role], "manage_members"), false, `${role} must not invite`);
    assert.equal(can([role], "manage_structure"), false, `${role} must not edit branches`);
  }
  assert.equal(can(["practice_admin"], "manage_members"), true);
});

test("capability is the union of every grant a user holds", () => {
  // Tenant-wide preparer plus manager on one branch, which the scope model allows.
  assert.equal(can(["preparer", "manager"], "review"), true);
  assert.equal(can(["preparer", "manager"], "sign_off"), false, "union must not invent a capability");
});

test("nobody can grant a role above their own", () => {
  assert.equal(canGrantRole(["practice_admin"], "practice_admin"), true);
  assert.equal(canGrantRole(["practice_admin"], "preparer"), true);
  // A manager cannot invite at all, so cannot promote by inviting an alias.
  assert.equal(canGrantRole(["manager"], "manager"), false);
  assert.equal(canGrantRole(["manager"], "practice_admin"), false);
  assert.equal(canGrantRole([], "client_user"), false);
});

test("empty roles grant nothing", () => {
  assert.deepEqual(capabilitiesFor([]), []);
  assert.equal(can([], "view"), false);
});

test("unknown roles are rejected rather than silently trusted", () => {
  assert.equal(isFirmRole("reviewer"), false, "renamed to preparer in 0006");
  assert.equal(isFirmRole("admin"), false);
  assert.equal(isFirmRole("practice_admin"), true);
  // A stale role string must not leak capabilities through `can`.
  assert.equal(can(["reviewer" as FirmRole], "prepare"), false);
});

test("labels follow the tenant type", () => {
  assert.equal(roleLabel("practice_admin", "accounting_practice"), "Partner");
  assert.equal(roleLabel("preparer", "accounting_practice"), "Preparer");
  assert.equal(roleLabel("practice_admin", "company"), "Owner");
  assert.equal(roleLabel("preparer", "company"), "Analyst");
});
