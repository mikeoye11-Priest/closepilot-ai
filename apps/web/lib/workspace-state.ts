import type { AnalysisResult, ClientCompany, Company, FirmRole, OrgUnit, Tenant } from "./types";
import type { ReportSchedule, ScheduledReport } from "./scheduled-reports";

/**
 * The workspace shell: structure and settings, no reviews.
 *
 * Extracted from app-shell so the guard below can be tested. It could not be
 * before, and that mattered: two separately-correct changes — one adding the
 * guard, one removing snapshots from the shell — merged cleanly and produced a
 * guard that rejected every server response, silently falling every load back
 * to the local cache. Nothing caught it because nothing could import it.
 */
export type WorkspaceState = {
  tenant: Tenant;
  companies: Company[];
  currentCompanyId: string;
  portfolioClients: ClientCompany[];
  /**
   * Only ever present on a legacy blob or the local cache, which holds just
   * the open company. The persisted shell does not carry snapshots: they live
   * a row per company and are fetched on demand.
   */
  companySnapshots?: Record<string, AnalysisResult>;
  /** The tenant's branches or divisions; read from the shared table. */
  orgUnits?: OrgUnit[];
  /** Roles the signed-in user holds; server-provided, never persisted back. */
  callerRoles?: FirmRole[];
  reportSchedules?: ReportSchedule[];
  scheduledReports?: ScheduledReport[];
};

/**
 * Validates state parsed from localStorage or /api/workspace before it is
 * restored.
 *
 * Both sources were cast straight to WorkspaceState. A cast satisfies the
 * compiler and proves nothing at runtime: the try/catch around the
 * localStorage read catches malformed JSON but not a wrong shape, and the
 * restore then dereferences parsed.companies immediately — a white screen the
 * user can only escape by clearing site data.
 *
 * Checks exactly the fields the restore relies on, and no more. Requiring
 * anything else is not caution but a way to reject valid state, which is the
 * bug described above.
 */
export function isWorkspaceState(value: unknown): value is WorkspaceState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<WorkspaceState>;

  if (typeof candidate.currentCompanyId !== "string") return false;
  if (!Array.isArray(candidate.companies)) return false;
  if (!Array.isArray(candidate.portfolioClients)) return false;
  if (typeof candidate.tenant !== "object" || candidate.tenant === null) return false;

  // Absent is correct for a server shell. Present must still be an object,
  // because the restore indexes into it.
  if (candidate.companySnapshots !== undefined) {
    if (typeof candidate.companySnapshots !== "object" || candidate.companySnapshots === null) return false;
    if (Array.isArray(candidate.companySnapshots)) return false;
  }

  return true;
}
