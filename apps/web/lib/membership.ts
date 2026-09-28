import type { createClient } from "./supabase-server";
import type { FirmRole } from "./types";
import { isFirmRole } from "./permissions";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * The roles a user holds over one company.
 *
 * Membership is many-to-many and grants come from three places, so this
 * returns every role that applies rather than one:
 *
 *   - a per-company grant (user_company_access), right for a client user
 *   - a tenant-wide scope grant
 *   - a scope grant on the org unit that company belongs to
 *
 * An empty array means no access at all, which callers must treat as a refusal
 * rather than as a default role.
 */
export async function rolesForCompany(
  supabase: Supabase,
  userId: string,
  companyId: string
): Promise<FirmRole[]> {
  const { data: company } = await supabase
    .from("companies")
    .select("tenant_id, org_unit_id")
    .eq("id", companyId)
    .maybeSingle();

  if (!company) return [];

  const tenantId = String(company.tenant_id);
  const orgUnitId = company.org_unit_id ? String(company.org_unit_id) : null;

  const [perCompany, scoped] = await Promise.all([
    supabase
      .from("user_company_access")
      .select("role")
      .eq("user_id", userId)
      .eq("company_id", companyId),
    supabase
      .from("user_scope_access")
      .select("role, org_unit_id")
      .eq("user_id", userId)
      .eq("tenant_id", tenantId)
  ]);

  const roles = new Set<FirmRole>();

  for (const row of perCompany.data ?? []) {
    if (isFirmRole(row.role)) roles.add(row.role);
  }

  for (const row of scoped.data ?? []) {
    // A tenant-wide grant covers every company; a unit grant only its own.
    const grantUnit = row.org_unit_id ? String(row.org_unit_id) : null;
    if (grantUnit !== null && grantUnit !== orgUnitId) continue;
    if (isFirmRole(row.role)) roles.add(row.role);
  }

  return [...roles];
}

/** As above, for actions against a firm rather than one of its companies. */
export async function rolesForTenant(
  supabase: Supabase,
  userId: string,
  tenantId: string
): Promise<FirmRole[]> {
  const [perCompany, scoped] = await Promise.all([
    supabase.from("user_company_access").select("role").eq("user_id", userId).eq("tenant_id", tenantId),
    supabase.from("user_scope_access").select("role").eq("user_id", userId).eq("tenant_id", tenantId)
  ]);

  const roles = new Set<FirmRole>();
  for (const row of [...(perCompany.data ?? []), ...(scoped.data ?? [])]) {
    if (isFirmRole(row.role)) roles.add(row.role);
  }
  return [...roles];
}
