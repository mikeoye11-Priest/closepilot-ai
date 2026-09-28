import test from "node:test";
import assert from "node:assert/strict";
import { groupByOrgUnit, memberLabel, orgUnitKindFor, orgUnitLabel } from "../apps/web/lib/org-units";
import type { Company, OrgUnit } from "../apps/web/lib/types";

const company = (id: string, orgUnitId?: string | null): Company => ({
  id,
  tenantId: "t",
  name: id,
  industry: "",
  accountingSystem: "",
  currency: "GBP",
  country: "United Kingdom",
  orgUnitId
});

const unit = (id: string, name: string): OrgUnit => ({ id, tenantId: "t", name, kind: "branch" });

test("a practice and a group get different vocabulary from the same model", () => {
  assert.equal(orgUnitLabel("accounting_practice"), "Branch");
  assert.equal(orgUnitLabel("accounting_practice", true), "Branches");
  assert.equal(orgUnitLabel("company"), "Division");
  assert.equal(orgUnitLabel("company", true), "Divisions");
  assert.equal(memberLabel("accounting_practice", true), "Clients");
  assert.equal(memberLabel("company", true), "Entities");
  assert.equal(orgUnitKindFor("accounting_practice"), "branch");
  assert.equal(orgUnitKindFor("company"), "division");
});

test("single entity: no org units, the company is still returned", () => {
  const groups = groupByOrgUnit([company("c1")], []);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].unit, null);
  assert.deepEqual(groups[0].companies.map((item) => item.id), ["c1"]);
});

test("units are sorted by name and ungrouped companies come last", () => {
  const units = [unit("u2", "Manchester"), unit("u1", "Leeds")];
  const groups = groupByOrgUnit([company("a", "u2"), company("b", "u1"), company("c")], units);
  assert.deepEqual(groups.map((group) => group.unit?.name ?? null), ["Leeds", "Manchester", null]);
  assert.deepEqual(groups[2].companies.map((item) => item.id), ["c"]);
});

test("an empty unit stays visible rather than disappearing", () => {
  const groups = groupByOrgUnit([], [unit("u1", "Leeds")]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].unit?.name, "Leeds");
  assert.equal(groups[0].companies.length, 0);
});

test("a stale orgUnitId never hides a company", () => {
  const groups = groupByOrgUnit([company("a", "deleted-unit")], [unit("u1", "Leeds")]);
  assert.deepEqual(groups.flatMap((group) => group.companies.map((item) => item.id)), ["a"]);
});

test("15 branches of 100 clients: nothing lost, nothing duplicated", () => {
  const units = Array.from({ length: 15 }, (_, index) => unit(`u${index}`, `Branch ${index}`));
  const companies = Array.from({ length: 1500 }, (_, index) =>
    company(`c${index}`, index % 10 === 0 ? null : `u${index % 15}`)
  );

  const groups = groupByOrgUnit(companies, units);
  const ids = groups.flatMap((group) => group.companies.map((item) => item.id));

  assert.equal(ids.length, 1500, "every company appears exactly once");
  assert.equal(new Set(ids).size, 1500, "no duplicates");
  assert.equal(groups.find((group) => group.unit === null)?.companies.length, 150);
});
