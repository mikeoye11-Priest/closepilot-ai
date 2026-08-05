// Retention mechanism — codifies the Data Retention & Deletion Policy
// (docs/compliance/retention-and-deletion-policy.md §2) as data the app can act on:
// each retention category is bound to the table + timestamp column that holds it
// and the period after which a row is past retention.
//
// IMPORTANT — this is a PLANNER, not an executor. planRetention() computes which
// rows are expired; it deletes nothing. It is deliberately NOT wired to any
// scheduled job, because the periods below are still DEFAULTS pending the
// company's confirmation (the policy marks them [bracketed]). A future purge job
// must gate on retentionEnforcementEnabled() so it refuses to auto-delete until the
// Data Protection lead has confirmed each period. Right-to-erasure (immediate,
// per-client) is separate and already live — see infra/tests/erasure_proof.sql.

export type RetentionCategory = "audit_logs" | "sync_runs" | "integration_tokens" | "operational_logs";

// A retention target: the table + timestamp column that starts the clock, the
// default period in days, and whether that period has been confirmed. Periods
// mirror the policy's [bracketed] defaults and MUST be confirmed before any purge.
export type RetentionTarget = {
  category: RetentionCategory;
  table: string;
  timestampColumn: string;
  days: number;
  basis: string;
  confirmed: boolean;
};

export const RETENTION_TARGETS: Record<RetentionCategory, RetentionTarget> = {
  // Audit logs — retained for accountability, then pruned. [24 months]
  audit_logs: { category: "audit_logs", table: "audit_logs", timestampColumn: "created_at", days: 730, basis: "Security / accountability (UK GDPR Art 5(2))", confirmed: false },
  // Sync runs hold an operational copy of the client financials (result_summary).
  // [Engagement + 12 months] — modelled here as a fixed 365-day default until a
  // controller's instruction (from the DPA) overrides it. [12 months]
  sync_runs: { category: "sync_runs", table: "accounting_sync_runs", timestampColumn: "started_at", days: 365, basis: "Processing on controller instruction", confirmed: false },
  // Accounting-integration tokens — dropped after a period of inactivity. [90 days]
  integration_tokens: { category: "integration_tokens", table: "accounting_integrations", timestampColumn: "last_synced_at", days: 90, basis: "Necessary to provide the service", confirmed: false },
  // Operational / error logs (host + Sentry). [90 days] — enforced at the host, not
  // in this table; listed so the policy and code agree on the period.
  operational_logs: { category: "operational_logs", table: "(host / Sentry)", timestampColumn: "created_at", days: 90, basis: "Legitimate interest (security, reliability)", confirmed: false },
};

const DAY_MS = 86_400_000;

// The cutoff instant for a category: rows whose timestamp is strictly before this
// are past retention. `now` defaults to the current time.
export function retentionCutoff(category: RetentionCategory, now: Date = new Date()): Date {
  return new Date(now.getTime() - RETENTION_TARGETS[category].days * DAY_MS);
}

// A purge job may only run automatically once EVERY period has been confirmed.
// Until then a caller must treat planRetention() as report-only.
export function retentionEnforcementEnabled(): boolean {
  return Object.values(RETENTION_TARGETS).every((target) => target.confirmed);
}

export type RetentionItem = { id: string; category: RetentionCategory; timestamp: string | Date | null | undefined };

export type CategorySummary = { expired: number; retained: number; cutoff: string; days: number; confirmed: boolean };

export type RetentionPlan = {
  expired: RetentionItem[];
  retained: RetentionItem[];
  byCategory: Record<RetentionCategory, CategorySummary>;
  enforcementEnabled: boolean; // false while any period is an unconfirmed default
};

function toDate(value: string | Date | null | undefined): Date | null {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

// True when an item is past its category's retention period. A missing/invalid
// timestamp is NEVER expired — we don't delete data whose age we can't establish.
export function isExpired(item: RetentionItem, now: Date = new Date()): boolean {
  const date = toDate(item.timestamp);
  if (!date) return false;
  return date.getTime() < retentionCutoff(item.category, now).getTime();
}

// Classify dated items into expired vs retained per category. Pure — inspects
// nothing, deletes nothing. This is what a (future, confirmed) purge job would call
// to decide what to remove, and what a read-only retention report shows today.
export function planRetention(items: RetentionItem[], now: Date = new Date()): RetentionPlan {
  const categories = Object.keys(RETENTION_TARGETS) as RetentionCategory[];
  const byCategory = Object.fromEntries(
    categories.map((category) => [category, {
      expired: 0,
      retained: 0,
      cutoff: retentionCutoff(category, now).toISOString(),
      days: RETENTION_TARGETS[category].days,
      confirmed: RETENTION_TARGETS[category].confirmed,
    }]),
  ) as Record<RetentionCategory, CategorySummary>;

  const expired: RetentionItem[] = [];
  const retained: RetentionItem[] = [];
  for (const item of items) {
    if (isExpired(item, now)) { expired.push(item); byCategory[item.category].expired += 1; }
    else { retained.push(item); byCategory[item.category].retained += 1; }
  }

  return { expired, retained, byCategory, enforcementEnabled: retentionEnforcementEnabled() };
}
