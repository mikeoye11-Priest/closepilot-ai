export type AccountingIntegrationProvider = "xero" | "quickbooks" | "sage";

export type AccountingIntegrationState = {
  provider: AccountingIntegrationProvider;
  label: string;
  status: "configuration_required" | "ready_to_connect" | "tenant_selection_required" | "connected";
  configured: boolean;
  connected: boolean;
  capabilities: Array<"trial_balance" | "vat_transactions" | "vat_returns" | "contacts">;
  detail: string;
  connectUrl?: string;
  organisations?: Array<{ id: string; name: string; selected: boolean; status: string; lastSyncedAt?: string }>;
};
