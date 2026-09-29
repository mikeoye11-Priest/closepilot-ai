import type { createClient } from "./supabase-server";
import { rolesForCompany, rolesForTenant } from "./membership";
import { can, type Capability } from "./permissions";

type Supabase = Awaited<ReturnType<typeof createClient>>;

export async function hasCompanyCapability(
  supabase: Supabase,
  userId: string,
  companyId: string,
  capability: Capability,
): Promise<boolean> {
  return can(await rolesForCompany(supabase, userId, companyId), capability);
}

export async function hasTenantCapability(
  supabase: Supabase,
  userId: string,
  tenantId: string,
  capability: Capability,
): Promise<boolean> {
  return can(await rolesForTenant(supabase, userId, tenantId), capability);
}
