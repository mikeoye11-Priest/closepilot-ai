export type AccountingIntegrationProvider = "xero" | "quickbooks" | "sage";

// Connection lifecycle stage — makes "Connected" unambiguous about whether data
// is actually available. authorised/ready_to_sync = connected but no data yet;
// syncing = a run in flight; synced = last run completed; needs_attention = the
// last run failed; reauth_required = the OAuth grant was revoked or expired and
// the connection must be reconnected before it can sync again.
export type IntegrationSyncStage = "authorised" | "ready_to_sync" | "syncing" | "synced" | "needs_attention" | "reauth_required";

export type IntegrationSyncDetail = {
  status: string;
  recordsImported?: number;
  periodStart?: string;
  periodEnd?: string;
  vatPeriodStart?: string;
  vatPeriodEnd?: string;
  completedAt?: string;
  warnings?: number;
  error?: string;
  // Cross-file reconciliation result for the imported data (REC checks): how many
  // passed and which need review. Proves the sync is complete/accurate, not just
  // that it ran.
  integrity?: { passed: number; total: number; issues: Array<{ name: string; status: string; detail?: string }> };
};

// How the imported data moved between the two most recent completed syncs. A
// negative recordsDelta (fewer records than last time) is the signal worth
// surfacing — it usually means a partial pull or newly missing data.
export type IntegrationSyncChange = { sinceDate?: string; recordsDelta: number; previousRecords: number };

export type AccountingIntegrationState = {
  provider: AccountingIntegrationProvider;
  label: string;
  status: "configuration_required" | "ready_to_connect" | "tenant_selection_required" | "connected";
  configured: boolean;
  connected: boolean;
  capabilities: Array<"trial_balance" | "vat_transactions" | "vat_returns" | "contacts">;
  detail: string;
  connectUrl?: string;
  organisations?: Array<{ id: string; name: string; selected: boolean; status: string; lastSyncedAt?: string; stage?: IntegrationSyncStage; sync?: IntegrationSyncDetail; change?: IntegrationSyncChange }>;
};
