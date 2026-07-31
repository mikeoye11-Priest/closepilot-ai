// Canonical debtor ledger — the single authoritative receivables model.
//
// Every debtor-derived figure (AR exposure, supported balance, unique exposure,
// recovery forecast, cash-flow receipts, concentration, collections) must draw
// from ONE deduplicated set of receivables so the totals reconcile and every
// number drills back to a source record.
//
//  - Canonical identity: tenant|company|provider|invoice_id|currency. When the
//    invoice id is missing a controlled fingerprint (customer|reference|date|
//    amount) is used and flagged lower-confidence.
//  - One invoice contributes its balance ONCE. Ageing bands, risk, promises and
//    disputes are child SIGNALS of the invoice, never additional receivables.
//  - Duplicate/unreconciled records are excluded from exposure and raise a
//    validation blocker.
//  - Recovery is Σ(unique balance × recovery probability) under a disclosed,
//    configurable probability table — unattributed balances excluded from base.

export type CashflowScenario = "conservative" | "base" | "upside";

// Recovery status a receivable is scored under.
export type RecoveryProfile = "valid_promise" | "overdue_promise" | "disputed" | "unattributed" | "current" | "d1_30" | "d31_60" | "d61_90" | "d90plus";

// Disclosed starting assumptions for TESTING — not permanent accounting policy.
// Configurable + visible; overqualify before treating as fact.
export const DEFAULT_RECOVERY_PROBABILITY: Record<CashflowScenario, Record<RecoveryProfile, number>> = {
  conservative: { valid_promise: 0.80, overdue_promise: 0.35, current: 0.70, d1_30: 0.70, d31_60: 0.55, d61_90: 0.35, d90plus: 0.15, disputed: 0.00, unattributed: 0.00 },
  base: { valid_promise: 0.95, overdue_promise: 0.50, current: 0.90, d1_30: 0.90, d31_60: 0.80, d61_90: 0.65, d90plus: 0.40, disputed: 0.20, unattributed: 0.00 },
  upside: { valid_promise: 1.00, overdue_promise: 0.70, current: 1.00, d1_30: 1.00, d31_60: 0.95, d61_90: 0.85, d90plus: 0.65, disputed: 0.50, unattributed: 0.00 },
};

type Row = Record<string, string>;

export type CanonicalReceivable = {
  key: string;
  keyConfidence: "high" | "low"; // high = invoice id, low = fingerprint match
  customer: string;
  attributed: boolean;
  invoiceId?: string;
  balance: number;
  daysOverdue: number;
  band: "current" | "d1_30" | "d31_60" | "d61_90" | "d90plus";
  profile: RecoveryProfile;
  duplicate: boolean; // excluded from exposure; raised as a blocker
  promiseAmount?: number;
  promiseDate?: string;
  signals: string[]; // child signals — informational, never add balance
};

export type DebtorBridge = {
  tbControl: number | null;
  agedTotal: number;
  difference: number | null; // tbControl − agedTotal
  reconciled: boolean;
  customerAttributed: number;
  unattributed: number;
  uniqueInvoiceBalance: number; // after de-duplication
  duplicatesExcluded: number;
  disputed: number;
  promised: number;
  eligible: number; // matched, non-duplicate, collectable balance
};

export type DebtorLedger = {
  receivables: CanonicalReceivable[]; // all, including duplicates (flagged)
  unique: CanonicalReceivable[]; // de-duplicated
  bridge: DebtorBridge;
  validationBlockers: string[];
};

const num = (value: unknown): number => {
  const parsed = Number(String(value ?? "").replace(/[£$,\s]/g, "").replace(/^\((.*)\)$/, "-$1"));
  return Number.isFinite(parsed) ? parsed : 0;
};
const round = (value: number) => Math.round(value);

function isAttributed(name: string): boolean {
  const t = name.trim();
  return t.length > 0 && !/^(unattributed|unallocated|unmatched|various|sundry|other|misc(ellaneous)?|n\/?a|control)$/i.test(t);
}

function bandFor(daysOverdue: number): CanonicalReceivable["band"] {
  if (daysOverdue <= 0) return "current";
  if (daysOverdue <= 30) return "d1_30";
  if (daysOverdue <= 60) return "d31_60";
  if (daysOverdue <= 90) return "d61_90";
  return "d90plus";
}

const first = (row: Row, keys: string[]): string => {
  for (const key of keys) if (row[key] != null && String(row[key]).trim() !== "") return String(row[key]).trim();
  return "";
};

export type CollectionSignal = { customer?: string; invoiceId?: string; status?: string; promiseAmount?: number; promiseDate?: string };

export type DebtorLedgerInputs = {
  agedDebtors?: Row[];
  tbControl?: number | null;
  collectionCases?: CollectionSignal[];
  tenantId?: string;
  companyId?: string;
  sourceProvider?: string;
  currency?: string;
  today?: string; // for promise valid/overdue determination
};

export function buildDebtorLedger(inputs: DebtorLedgerInputs): DebtorLedger {
  const { tenantId = "", companyId = "", sourceProvider = "upload", currency = "GBP" } = inputs;
  const today = inputs.today && /^\d{4}-\d{2}-\d{2}$/.test(inputs.today) ? inputs.today : new Date().toISOString().slice(0, 10);
  const blockers: string[] = [];

  // Index collection signals by customer (and invoice id where present).
  const caseByCustomer = new Map<string, CollectionSignal>();
  const caseByInvoice = new Map<string, CollectionSignal>();
  for (const c of inputs.collectionCases ?? []) {
    if (c.invoiceId) caseByInvoice.set(String(c.invoiceId), c);
    if (c.customer) caseByCustomer.set(c.customer.trim().toLowerCase(), c);
  }

  const seen = new Map<string, CanonicalReceivable>();
  const receivables: CanonicalReceivable[] = [];

  for (const row of inputs.agedDebtors ?? []) {
    const balance = Math.abs(num(row.amount ?? row.balance));
    if (balance <= 0) continue;
    const customer = first(row, ["customer", "name", "account"]);
    const invoiceId = first(row, ["invoice_id", "invoice_number", "invoice_no", "invoice", "document_number"]);
    const reference = first(row, ["reference", "invoice_ref", "ref"]);
    const date = first(row, ["date", "invoice_date", "due_date"]);
    const daysOverdue = num(row.days_overdue ?? row.days ?? 0);
    const attributed = isAttributed(customer);

    const keyConfidence: "high" | "low" = invoiceId ? "high" : "low";
    const key = invoiceId
      ? `${tenantId}|${companyId}|${sourceProvider}|${invoiceId}|${currency}`
      : `fp|${customer.toLowerCase()}|${reference.toLowerCase()}|${date}|${round(balance)}|${currency}`;

    const signal = (invoiceId && caseByInvoice.get(invoiceId)) || (customer && caseByCustomer.get(customer.toLowerCase())) || undefined;
    const band = bandFor(daysOverdue);

    // Recovery profile: dispute > promise > unattributed > ageing band.
    let profile: RecoveryProfile = attributed ? band : "unattributed";
    const childSignals: string[] = [];
    if (daysOverdue > 90) childSignals.push("90+ days", "high collection risk");
    else if (daysOverdue > 60) childSignals.push("61–90 days");
    let promiseAmount: number | undefined;
    let promiseDate: string | undefined;
    if (signal?.status === "disputed") { profile = "disputed"; childSignals.push("disputed"); }
    else if (signal?.status === "promised") {
      promiseAmount = signal.promiseAmount;
      promiseDate = signal.promiseDate;
      const overdue = promiseDate && promiseDate < today;
      profile = overdue ? "overdue_promise" : "valid_promise";
      childSignals.push(overdue ? "broken promise" : "valid promise");
    }

    const receivable: CanonicalReceivable = { key, keyConfidence, customer, attributed, invoiceId: invoiceId || undefined, balance, daysOverdue, band, profile, duplicate: false, promiseAmount, promiseDate, signals: childSignals };

    const existing = seen.get(key);
    if (existing) {
      // Same canonical key twice → a duplicate/unreconciled record. Exclude the
      // extra from exposure and raise a blocker.
      receivable.duplicate = true;
      blockers.push(`Duplicate receivable for ${customer || "unattributed"}${invoiceId ? ` invoice ${invoiceId}` : ""} (${keyConfidence}-confidence match) — excluded from exposure.`);
    } else {
      seen.set(key, receivable);
    }
    receivables.push(receivable);
  }

  const unique = receivables.filter((r) => !r.duplicate);
  const sum = (list: CanonicalReceivable[], predicate: (r: CanonicalReceivable) => boolean = () => true) => list.filter(predicate).reduce((s, r) => s + r.balance, 0);

  const agedTotal = sum(receivables); // the raw aged report total (includes duplicates)
  const uniqueInvoiceBalance = sum(unique);
  const duplicatesExcluded = agedTotal - uniqueInvoiceBalance;
  const customerAttributed = sum(unique, (r) => r.attributed);
  const unattributed = sum(unique, (r) => !r.attributed);
  const disputed = sum(unique, (r) => r.profile === "disputed");
  const promised = unique.filter((r) => r.profile === "valid_promise" || r.profile === "overdue_promise").reduce((s, r) => s + Math.min(r.promiseAmount ?? r.balance, r.balance), 0);
  const eligible = sum(unique, (r) => r.attributed && r.profile !== "disputed");

  const tbControl = inputs.tbControl == null ? null : round(inputs.tbControl);
  const difference = tbControl == null ? null : round(tbControl - agedTotal);
  const reconciled = difference == null ? true : Math.abs(difference) <= 1;
  if (difference != null && !reconciled) blockers.push(`TB debtors control (${tbControl}) does not agree to the aged report (${round(agedTotal)}); difference ${difference}.`);

  return {
    receivables,
    unique,
    bridge: {
      tbControl,
      agedTotal: round(agedTotal),
      difference,
      reconciled,
      customerAttributed: round(customerAttributed),
      unattributed: round(unattributed),
      uniqueInvoiceBalance: round(uniqueInvoiceBalance),
      duplicatesExcluded: round(duplicatesExcluded),
      disputed: round(disputed),
      promised: round(promised),
      eligible: round(eligible),
    },
    validationBlockers: blockers,
  };
}

// Weeks 1..13 relative to the current week (Monday-aligned), matching the 13-week
// forecast so receipts line up.
function weekIndexFromDaysOverdue(daysOverdue: number, termDays = 30): number {
  const days = Math.min(Math.max(termDays - daysOverdue, 3), 13 * 7);
  return Math.min(Math.max(Math.ceil(days / 7), 1), 13);
}
function weekIndexFromDate(dateISO: string | undefined, today: string): number {
  if (!dateISO || !/^\d{4}-\d{2}-\d{2}$/.test(dateISO)) return 1;
  const days = Math.round((Date.parse(`${dateISO}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  return Math.min(Math.max(Math.ceil((days + 1) / 7), 1), 13);
}

export type RecoveryForecast = {
  expected: number; // total probability-adjusted recovery from eligible unique balances
  weekly: number[]; // index 1..13 (0 unused)
  eligibleUnique: number; // the balance base the forecast draws on
  excludedUnattributed: number;
};

// Expected recovery = Σ(unique outstanding balance × recovery probability), using
// ONLY non-duplicate receivables, under the (configurable) probability table.
export function forecastRecovery(
  ledger: DebtorLedger,
  scenario: CashflowScenario,
  probability: Record<CashflowScenario, Record<RecoveryProfile, number>> = DEFAULT_RECOVERY_PROBABILITY,
  today: string = new Date().toISOString().slice(0, 10),
): RecoveryForecast {
  const table = probability[scenario];
  const weekly = new Array(14).fill(0);
  let expected = 0;
  let eligibleUnique = 0;
  let excludedUnattributed = 0;

  for (const r of ledger.unique) {
    if (!r.attributed) { excludedUnattributed += r.balance; if (table.unattributed <= 0) continue; }
    // Split a promised invoice: promised portion on the promise date; residual on ageing.
    const promisedPortion = (r.profile === "valid_promise" || r.profile === "overdue_promise") ? Math.min(r.promiseAmount ?? r.balance, r.balance) : 0;
    const residual = r.balance - promisedPortion;

    if (promisedPortion > 0) {
      const p = table[r.profile];
      const week = weekIndexFromDate(r.promiseDate, today);
      const amount = promisedPortion * p;
      weekly[week] += amount; expected += amount; eligibleUnique += promisedPortion;
    }
    if (residual > 0) {
      // The unpromised remainder keeps the invoice's status: disputed stays
      // disputed, unattributed stays unattributed, otherwise it ages normally.
      const profile: RecoveryProfile = r.profile === "disputed" ? "disputed" : !r.attributed ? "unattributed" : r.band;
      const p = table[profile];
      const week = weekIndexFromDaysOverdue(r.daysOverdue);
      const amount = residual * p;
      weekly[week] += amount; expected += amount; eligibleUnique += residual;
    }
  }

  return { expected: round(expected), weekly: weekly.map(round), eligibleUnique: round(eligibleUnique), excludedUnattributed: round(excludedUnattributed) };
}
