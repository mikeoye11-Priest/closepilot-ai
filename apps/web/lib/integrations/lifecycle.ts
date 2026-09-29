import type { AnalysisResult } from "../types";
import type { AccountingIntegrationState } from "./types";

export type IntegrationProvider = "xero" | "quickbooks" | "sage";
export type IntegrationSyncPollResult = {
  status: "queued" | "running" | "completed" | "failed";
  counts?: { trialBalance?: number; vatRows?: number };
  warnings?: string[];
  analysis?: AnalysisResult;
  vatPeriod?: { start: string; end: string };
  error?: string;
};
export type IntegrationOrg = NonNullable<AccountingIntegrationState["organisations"]>[number];
export type IntegrationActivity = { action: string; at: string; entityType?: string };

export const INTEGRATION_STAGE_META: Record<string, { label: string; cls: string }> = {
  authorised: { label: "Authorised", cls: "bg-slate-100 text-slate-600" },
  ready_to_sync: { label: "Ready to sync", cls: "bg-blue-50 text-blue-700 border border-blue-200" },
  syncing: { label: "Syncing…", cls: "bg-amber-50 text-amber-800 border border-amber-200" },
  synced: { label: "Synced", cls: "bg-emerald-50 text-emerald-700 border border-emerald-200" },
  needs_attention: { label: "Needs attention", cls: "bg-red-50 text-red-700 border border-red-200" },
  reauth_required: { label: "Reconnect needed", cls: "bg-red-50 text-red-700 border border-red-200" },
};

export async function pollIntegrationSync(
  provider: IntegrationProvider,
  syncId: string,
  onProgress: (status: IntegrationSyncPollResult["status"]) => void,
): Promise<IntegrationSyncPollResult> {
  const deadline = Date.now() + 5 * 60 * 1000;
  while (Date.now() < deadline) {
    const response = await fetch(`/api/integrations/${provider}/sync?syncId=${encodeURIComponent(syncId)}`, { cache: "no-store" });
    const result = await response.json() as IntegrationSyncPollResult;
    if (!response.ok) throw new Error(result.error || "Could not read sync progress.");
    if (result.status === "completed") return result;
    if (result.status === "failed") throw new Error(result.error || "Sync failed.");
    onProgress(result.status);
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw new Error("The sync is still running. You can leave this page and check again shortly.");
}

export function integrationSyncSummary(org: IntegrationOrg): string {
  if (org.stage === "reauth_required") return "Access was revoked or has expired — reconnect to resume syncing.";
  const sync = org.sync;
  if (!sync) return "Not yet synced";
  if (sync.status === "queued" || sync.status === "running") return "Sync in progress…";
  if (sync.status === "failed") return `Last sync failed${sync.error ? ` — ${sync.error}` : ""}`;
  const parts: string[] = [];
  const when = sync.completedAt ?? org.lastSyncedAt;
  if (when) parts.push(`Last synced ${new Date(when).toLocaleString("en-GB")}`);
  if (sync.recordsImported != null) parts.push(`${sync.recordsImported} records`);
  if (sync.periodStart && sync.periodEnd) parts.push(`period ${sync.periodStart} → ${sync.periodEnd}`);
  if (sync.vatPeriodStart && sync.vatPeriodEnd) parts.push(`VAT ${sync.vatPeriodStart} → ${sync.vatPeriodEnd}`);
  if (sync.warnings) parts.push(`${sync.warnings} warning${sync.warnings === 1 ? "" : "s"}`);
  return parts.join(" · ") || "Synced";
}

export function integrationActivityLabel(action: string): string {
  if (action === "integration_data_erased") return "Synced data erased";
  const provider = action.startsWith("quickbooks") ? "QuickBooks"
    : action.startsWith("sage") ? "Sage"
      : action.startsWith("xero") ? "Xero"
        : "";
  const event = action.endsWith("_sync_completed") ? "synced"
    : action.endsWith("_disconnected") ? "disconnected"
      : action.endsWith("_connected") ? "connected"
        : action.replace(/_/g, " ");
  return provider ? `${provider} ${event}` : action.replace(/_/g, " ");
}
