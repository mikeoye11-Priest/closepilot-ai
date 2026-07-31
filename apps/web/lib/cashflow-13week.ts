// 13-week cash flow — the treasury-standard short-term liquidity model.
//
// Projects opening cash → weekly receipts (from open receivables) − weekly
// payments (settling payables + payroll/overhead run-rate + one-offs like VAT)
// → closing cash for each of the next 13 weeks, and surfaces the liquidity low
// point and any week cash turns negative. Built from the same statements the
// review/accounts use (aged debtors/creditors, bank, P&L), so it needs no extra
// upload. It is a directional planning model — the assumptions are made explicit
// so a finance manager can sanity-check and refine them.
//
// Integrity guarantees (every headline reconciles visibly):
//  - the forecast starts the CURRENT week — no past weeks presented as forecast;
//  - all weekly figures are integer-rounded and CHAINED, so opening + net =
//    closing and Σreceipts − Σpayments = net movement = closing − opening exactly;
//  - receivables are split into attributed vs unattributed; scenarios recognise
//    the unattributed portion at a stated weight (conservative excludes it).

type Row = Record<string, string>;

export type CashflowScenario = "conservative" | "base" | "upside";

export type WeeklyCashflow = {
  week: number; // 1..13
  weekStart: string; // ISO date (Monday)
  weekEnd: string; // ISO date (Sunday)
  opening: number;
  receipts: number;
  payments: number;
  net: number;
  closing: number;
  lowest: boolean; // the minimum closing-balance week
  negative: boolean; // closing < 0
};

export type ThirteenWeekInput = {
  openingCash: number;
  openingCashEvidenced?: boolean; // is opening cash backed by a bank balance?
  openingAsOf?: string; // the date the opening balance was struck (for the caveat)
  startDate?: string; // week-1 Monday; defaults to the coming Monday (current week)
  agedReceivables?: Array<{ amount: number; daysOverdue?: number; name?: string; attributed?: boolean }>;
  agedPayables?: Array<{ amount: number; daysOverdue?: number; name?: string }>;
  weeklyPayroll?: number; // recurring cash outflow / week
  weeklyOverheads?: number; // recurring cash outflow / week (ex-payroll, ex-depreciation)
  oneOffs?: Array<{ week: number; amount: number; label: string }>; // +inflow / −outflow in a given week
  termDays?: number; // assumed settlement terms for scheduling (default 30)
  receivableTermDays?: number; // override AR terms (what-if: collect faster/slower)
  payableTermDays?: number; // override AP terms (what-if: pay suppliers later)
  overdueHaircut?: number; // 0..1 write-down applied to 90+ day receivables (doubtful)
  unattributedWeight?: number; // 0..1 fraction of UN-attributed receivables recognised
  // When supplied (from the canonical debtor ledger's recovery forecast), weekly
  // receipts come straight from the selected recovery scenario instead of being
  // re-scheduled here — so the 13-week receipts equal the recovery model exactly.
  weeklyReceipts?: number[]; // index 1..13
  receivablesOverride?: ReceivablesBreakdown;
};

// Debtor populations, so the forecast's receivables basis is transparent and
// reconcilable to the ledger.
export type ReceivablesBreakdown = { aged: number; attributed: number; unattributed: number; recognised: number };

export type ThirteenWeekResult = {
  weeks: WeeklyCashflow[];
  openingCash: number;
  openingCashEvidenced: boolean;
  totalReceipts: number;
  totalPayments: number;
  closingCash: number;
  netMovement: number;
  lowestBalance: number;
  lowestWeek: number;
  firstNegativeWeek: number | null;
  receivables: ReceivablesBreakdown;
  assumptions: string[];
};

const WEEKS = 13;
const clamp = (value: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, value));
const round = (value: number) => Math.round(value);

export function num(value: unknown): number {
  const parsed = Number(String(value ?? "").replace(/[£$,\s]/g, "").replace(/^\((.*)\)$/, "-$1"));
  return Number.isFinite(parsed) ? parsed : 0;
}

// The Monday on/after the given date (or today).
function mondayOnOrAfter(dateISO?: string): string {
  const base = dateISO && /^\d{4}-\d{2}-\d{2}$/.test(dateISO) ? new Date(`${dateISO}T00:00:00Z`) : new Date();
  const day = base.getUTCDay(); // 0=Sun..6=Sat
  const add = day === 1 ? 0 : (8 - day) % 7; // days until next Monday (0 if already Monday)
  base.setUTCDate(base.getUTCDate() + add);
  return base.toISOString().slice(0, 10);
}
function addDaysISO(dateISO: string, days: number): string {
  const d = new Date(`${dateISO}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Week (1..13) an item lands in: settled `termDays` after the period start, less
// however overdue it already is — so overdue items are chased/paid in the near
// weeks and current items land around their due date.
function weekFor(daysOverdue: number, termDays: number, minDays: number): number {
  const days = clamp(termDays - daysOverdue, minDays, WEEKS * 7);
  return clamp(Math.ceil(days / 7), 1, WEEKS);
}

export function buildThirteenWeekCashflow(input: ThirteenWeekInput): ThirteenWeekResult {
  const termDays = input.termDays ?? 30;
  const arTerm = Math.max(0, input.receivableTermDays ?? termDays);
  const apTerm = Math.max(0, input.payableTermDays ?? termDays);
  const haircut = clamp(input.overdueHaircut ?? 0, 0, 1);
  const unattributedWeight = clamp(input.unattributedWeight ?? 1, 0, 1);
  const start = mondayOnOrAfter(input.startDate); // current week unless a start is given
  const evidenced = input.openingCashEvidenced ?? true;

  const receiptsByWeek = new Array(WEEKS + 1).fill(0);
  const paymentsByWeek = new Array(WEEKS + 1).fill(0);

  let aged = 0;
  let attributed = 0;
  let unattributed = 0;
  let recognised = 0;
  if (input.weeklyReceipts) {
    // Receipts come from the canonical recovery forecast — do not re-schedule.
    for (let week = 1; week <= WEEKS; week += 1) receiptsByWeek[week] = Math.max(0, input.weeklyReceipts[week] ?? 0);
    const b = input.receivablesOverride;
    if (b) { aged = b.aged; attributed = b.attributed; unattributed = b.unattributed; recognised = b.recognised; }
    else recognised = receiptsByWeek.reduce((sum, x) => sum + x, 0);
  } else {
    for (const receivable of input.agedReceivables ?? []) {
      const gross = Math.abs(receivable.amount);
      if (gross <= 0) continue;
      aged += gross;
      const overdue = receivable.daysOverdue ?? 0;
      let amount = gross;
      if (overdue > 90 && haircut > 0) amount *= 1 - haircut; // doubtful older debt
      if (receivable.attributed === false) {
        unattributed += gross;
        amount *= unattributedWeight; // exclude/weight balances not matched to a customer
      } else {
        attributed += gross;
      }
      if (amount <= 0) continue;
      receiptsByWeek[weekFor(overdue, arTerm, 3)] += amount;
      recognised += amount;
    }
  }
  for (const payable of input.agedPayables ?? []) {
    const amount = Math.abs(payable.amount);
    if (amount <= 0) continue;
    paymentsByWeek[weekFor(payable.daysOverdue ?? 0, apTerm, 1)] += amount;
  }

  const payroll = Math.max(0, input.weeklyPayroll ?? 0);
  const overheads = Math.max(0, input.weeklyOverheads ?? 0);
  const oneOffIn = new Array(WEEKS + 1).fill(0);
  const oneOffOut = new Array(WEEKS + 1).fill(0);
  for (const item of input.oneOffs ?? []) {
    const week = clamp(Math.round(item.week), 1, WEEKS);
    if (item.amount >= 0) oneOffIn[week] += item.amount;
    else oneOffOut[week] += Math.abs(item.amount);
  }

  // Chain ROUNDED weekly values so what is shown adds up exactly.
  const weeks: WeeklyCashflow[] = [];
  const openingCash = round(input.openingCash);
  let opening = openingCash;
  for (let week = 1; week <= WEEKS; week += 1) {
    const receipts = round(receiptsByWeek[week] + oneOffIn[week]);
    const payments = round(paymentsByWeek[week] + payroll + overheads + oneOffOut[week]);
    const net = receipts - payments;
    const closing = opening + net;
    weeks.push({
      week,
      weekStart: addDaysISO(start, (week - 1) * 7),
      weekEnd: addDaysISO(start, week * 7 - 1),
      opening,
      receipts,
      payments,
      net,
      closing,
      lowest: false,
      negative: closing < 0,
    });
    opening = closing;
  }

  let lowestWeek = 1;
  let lowestBalance = weeks[0].closing;
  for (const week of weeks) if (week.closing < lowestBalance) { lowestBalance = week.closing; lowestWeek = week.week; }
  weeks[lowestWeek - 1].lowest = true;
  const firstNegativeWeek = weeks.find((week) => week.closing < 0)?.week ?? null;

  const totalReceipts = weeks.reduce((sum, week) => sum + week.receipts, 0);
  const totalPayments = weeks.reduce((sum, week) => sum + week.payments, 0);
  const netMovement = totalReceipts - totalPayments; // == closingCash − openingCash
  const closingCash = weeks[WEEKS - 1].closing;

  const assumptions = [
    `Opening cash ${money(openingCash)}${input.openingAsOf ? ` (as at ${input.openingAsOf})` : ""}, projected forward from the current week.${evidenced ? "" : " Not evidenced by a bank balance — treat the absolute cash line with caution."}`,
    `Receivables: ${money(aged)} aged; ${money(round(recognised))} recognised in this scenario${unattributed > 0 ? ` (${money(unattributed)} not matched to a customer${unattributedWeight < 1 ? `, ${Math.round(unattributedWeight * 100)}% recognised` : ""})` : ""}.`,
    `Receivables collected around ${termDays}-day terms, less how overdue they already are (overdue balances chased into the near weeks).`,
    "Payables settled when due or overdue.",
    payroll > 0 ? `Payroll spread evenly at ${money(payroll)}/week.` : "No payroll run-rate supplied.",
    overheads > 0 ? `Operating overheads (ex-depreciation) at ${money(overheads)}/week.` : "No overhead run-rate supplied.",
    haircut > 0 ? `${Math.round(haircut * 100)}% write-down applied to 90+ day (doubtful) debtors.` : "No write-down on aged debtors.",
    ...(input.oneOffs ?? []).map((item) => `${item.label}: ${money(-Math.abs(item.amount))} in week ${clamp(Math.round(item.week), 1, WEEKS)}.`),
  ];

  return {
    weeks,
    openingCash,
    openingCashEvidenced: evidenced,
    totalReceipts,
    totalPayments,
    closingCash,
    netMovement,
    lowestBalance,
    lowestWeek,
    firstNegativeWeek,
    receivables: { aged: round(aged), attributed: round(attributed), unattributed: round(unattributed), recognised: round(recognised) },
    assumptions,
  };
}

function money(value: number): string {
  const rounded = Math.round(value);
  return `${rounded < 0 ? "−£" : "£"}${Math.abs(rounded).toLocaleString("en-GB")}`;
}

// Scenarios differ on collection speed, doubtful-debt write-down AND how much of
// the un-attributed (not matched to a customer) receivable balance is recognised.
const SCENARIOS: Record<CashflowScenario, { termDays: number; overdueHaircut: number; unattributedWeight: number }> = {
  upside: { termDays: 21, overdueHaircut: 0, unattributedWeight: 1 },
  base: { termDays: 30, overdueHaircut: 0, unattributedWeight: 0.7 },
  conservative: { termDays: 45, overdueHaircut: 0.5, unattributedWeight: 0 },
};

export type StatementsForCashflow = {
  agedDebtors?: Row[];
  agedCreditors?: Row[];
  bank?: Row[];
  balanceSheet?: Row[];
  profitLoss?: Row[];
  asOfDate?: string;
};

// A receivable row is "attributed" when it is matched to a named customer (not a
// generic placeholder). Unattributed balances are scenario-weighted.
function isAttributed(name: string): boolean {
  const trimmed = name.trim();
  return trimmed.length > 0 && !/^(unattributed|unallocated|unmatched|various|sundry|other|misc(ellaneous)?|n\/?a|control)$/i.test(trimmed);
}

// Derive a 13-week model input from a company's statements. Opening cash from the
// bank (or balance-sheet cash), receipts/payments from aged ledgers, payroll +
// overhead run-rates from the P&L (annualised → weekly), and the VAT liability as
// a one-off payment mid-quarter. The forecast starts the current week; the
// reporting date is retained only as the opening-balance "as at".
export function thirteenWeekInputFromStatements(statements: StatementsForCashflow, scenario: CashflowScenario = "base"): ThirteenWeekInput {
  const s = SCENARIOS[scenario];
  const bank = statements.bank ?? [];
  const bankCash = bank.reduce((sum, row) => sum + num(row.closing_balance), 0);
  const bsCash = (statements.balanceSheet ?? []).filter((row) => /cash|bank/i.test(String(row.item ?? ""))).reduce((sum, row) => sum + num(row.amount), 0);
  const openingCash = bank.length ? bankCash : bsCash;

  const agedReceivables = (statements.agedDebtors ?? []).map((row) => {
    const name = String(row.customer ?? row.name ?? "");
    return { amount: num(row.amount), daysOverdue: num(row.days_overdue), name, attributed: isAttributed(name) };
  });
  const agedPayables = (statements.agedCreditors ?? []).map((row) => ({ amount: num(row.amount), daysOverdue: num(row.days_overdue), name: String(row.supplier ?? row.name ?? "") }));

  // Weekly run-rates from the annual P&L. Payroll = salary/wage lines; overheads =
  // other expense lines excluding depreciation (non-cash).
  const pl = statements.profitLoss ?? [];
  const isCost = (row: Row) => num(row.amount) < 0 || /cost of sales|overhead|expense|admin/i.test(String(row.category ?? ""));
  const annualPayroll = pl.filter((row) => /salar|wage|payroll/i.test(String(row.description ?? "")) ).reduce((sum, row) => sum + Math.abs(num(row.amount)), 0);
  const annualOverheads = pl
    .filter((row) => isCost(row) && /overhead|admin|premises|utilit|rent|insurance|marketing|office/i.test(String(row.category ?? "") + String(row.description ?? "")))
    .filter((row) => !/salar|wage|payroll|direct labour|deprecia|amortis/i.test(String(row.description ?? "")))
    .reduce((sum, row) => sum + Math.abs(num(row.amount)), 0);

  // VAT liability → a one-off payment mid-quarter (week 6).
  const vatDue = (statements.balanceSheet ?? []).filter((row) => /vat/i.test(String(row.item ?? ""))).reduce((sum, row) => sum + num(row.amount), 0);
  const oneOffs = vatDue > 0 ? [{ week: 6, amount: -vatDue, label: "VAT payment" }] : [];

  return {
    openingCash,
    openingCashEvidenced: bank.length > 0,
    openingAsOf: statements.asOfDate,
    // startDate intentionally omitted → forecast starts the current week.
    agedReceivables,
    agedPayables,
    weeklyPayroll: annualPayroll / 52,
    weeklyOverheads: annualOverheads / 52,
    oneOffs,
    termDays: s.termDays,
    overdueHaircut: s.overdueHaircut,
    unattributedWeight: s.unattributedWeight,
  };
}
