import type { FirmRole, TenantType } from "./types";

/**
 * Who may do what.
 *
 * Until now nothing checked. UserCompanyAccess declared a role field that no
 * code read, so any signed-in user with access to a company could manager-
 * approve findings and partner sign off a review — the two controls the whole
 * review workflow exists to separate. A four-eyes workflow that one person can
 * complete alone is not a control, and for an accounting firm that is the
 * product's central claim.
 *
 * Capabilities rather than role comparisons at each call site, so adding a role
 * later is one table edit instead of a hunt through the app.
 */

export type { FirmRole };

export type Capability =
  /** Open the workspace and read reviews. */
  | "view"
  /** Upload packs, run reviews, request evidence, resolve findings. */
  | "prepare"
  /** Manager approve / return a finding. */
  | "review"
  /** Partner sign-off, which locks the review pack. */
  | "sign_off"
  /** Invite people, change roles, remove members. */
  | "manage_members"
  /** Create and edit org units. */
  | "manage_structure";

const CAPABILITIES: Record<FirmRole, readonly Capability[]> = {
  practice_admin: ["view", "prepare", "review", "sign_off", "manage_members", "manage_structure"],
  manager: ["view", "prepare", "review"],
  preparer: ["view", "prepare"],
  // An SME seeing its own entity: reads its review, changes nothing.
  client_user: ["view"]
};

/**
 * Role labels differ by tenant type for the same reason org units do: a
 * practice has partners and preparers, a company has owners and analysts.
 */
const ROLE_LABELS: Record<TenantType, Record<FirmRole, string>> = {
  accounting_practice: {
    practice_admin: "Partner",
    manager: "Manager",
    preparer: "Preparer",
    client_user: "Client"
  },
  company: {
    practice_admin: "Owner",
    manager: "Finance lead",
    preparer: "Analyst",
    client_user: "Viewer"
  }
};

export const FIRM_ROLES: readonly FirmRole[] = ["practice_admin", "manager", "preparer", "client_user"];

export function isFirmRole(value: unknown): value is FirmRole {
  return typeof value === "string" && (FIRM_ROLES as readonly string[]).includes(value);
}

export function roleLabel(role: FirmRole, tenantType: TenantType): string {
  return (ROLE_LABELS[tenantType] ?? ROLE_LABELS.company)[role];
}

/**
 * A user may hold several grants — tenant-wide plus a branch, or grants in
 * more than one firm now that membership is many-to-many — so capability is
 * the union of the roles that apply, never just the first one found.
 */
export function can(roles: readonly FirmRole[], capability: Capability): boolean {
  return roles.some((role) => CAPABILITIES[role]?.includes(capability));
}

export function capabilitiesFor(roles: readonly FirmRole[]): Capability[] {
  const granted = new Set<Capability>();
  for (const role of roles) for (const capability of CAPABILITIES[role] ?? []) granted.add(capability);
  return [...granted];
}

/**
 * Nobody may grant a role they do not hold themselves, so a manager cannot
 * quietly make someone a partner — or promote themselves by inviting an alias.
 */
const RANK: Record<FirmRole, number> = { practice_admin: 3, manager: 2, preparer: 1, client_user: 0 };

export function canGrantRole(actorRoles: readonly FirmRole[], target: FirmRole): boolean {
  if (!can(actorRoles, "manage_members")) return false;
  const highest = Math.max(...actorRoles.map((role) => RANK[role] ?? -1), -1);
  return highest >= RANK[target];
}
