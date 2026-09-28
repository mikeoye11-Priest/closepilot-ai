import type { Company, OrgUnit, OrgUnitKind, TenantType } from "./types";

/**
 * One structure, two vocabularies.
 *
 * An accounting practice has branches full of clients. A multi-entity group has
 * divisions full of entities. The data model is identical, so the difference
 * lives here rather than in the schema — otherwise practice language ("client",
 * "branch") leaks into a corporate workspace, where it reads as a bug.
 *
 * A single company has neither: one tenant, one company, no grouping.
 */

const UNIT_LABELS: Record<OrgUnitKind, { one: string; many: string }> = {
  branch: { one: "Branch", many: "Branches" },
  division: { one: "Division", many: "Divisions" }
};

const MEMBER_LABELS: Record<TenantType, { one: string; many: string }> = {
  accounting_practice: { one: "Client", many: "Clients" },
  company: { one: "Entity", many: "Entities" }
};

export function orgUnitKindFor(tenantType: TenantType): OrgUnitKind {
  return tenantType === "accounting_practice" ? "branch" : "division";
}

/** "Branch" / "Branches" for a practice, "Division" / "Divisions" for a group. */
export function orgUnitLabel(tenantType: TenantType, plural = false): string {
  const label = UNIT_LABELS[orgUnitKindFor(tenantType)];
  return plural ? label.many : label.one;
}

/** "Client" / "Clients" for a practice, "Entity" / "Entities" for a group. */
export function memberLabel(tenantType: TenantType, plural = false): string {
  const label = MEMBER_LABELS[tenantType] ?? MEMBER_LABELS.company;
  return plural ? label.many : label.one;
}

export type OrgUnitGroup = {
  /** Null for companies that sit directly under the tenant. */
  unit: OrgUnit | null;
  companies: Company[];
};

/**
 * Groups companies under their org unit for display.
 *
 * Ungrouped companies are returned last under a null unit rather than dropped:
 * orgUnitId is nullable by design, and a practice part-way through organising
 * its branches must still see every client. Units with no companies are kept so
 * an empty branch is visible rather than silently missing.
 */
export function groupByOrgUnit(companies: Company[], units: OrgUnit[]): OrgUnitGroup[] {
  const byUnit = new Map<string, Company[]>(units.map((unit) => [unit.id, []]));
  const ungrouped: Company[] = [];

  for (const company of companies) {
    const bucket = company.orgUnitId ? byUnit.get(company.orgUnitId) : undefined;
    // An orgUnitId pointing at a unit we were not given is treated as ungrouped
    // rather than dropped, so a stale id can never hide a client.
    if (bucket) bucket.push(company);
    else ungrouped.push(company);
  }

  const groups: OrgUnitGroup[] = units
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name, "en-GB"))
    .map((unit) => ({ unit, companies: byUnit.get(unit.id) ?? [] }));

  if (ungrouped.length) groups.push({ unit: null, companies: ungrouped });
  return groups;
}
