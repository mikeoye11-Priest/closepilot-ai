// 13-week cash flow — the treasury-standard short-term liquidity model.
//
// Projects opening cash → weekly receipts (from open receivables) − weekly
// payments (settling payables + payroll/overhead run-rate + one-offs like VAT)
// → closing cash for each of the next 13 weeks, and surfaces the liquidity low
// point and any week cash turns negative. Built from the same statements the
// review/accounts use (aged debtors/creditors, bank, P&L), so it needs no extra
// upload. It is a directional planning model — the assumptions are made explicit
// so a finance manager can sanity-check and refine them.

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
  startDate?: string; // week-1 Monday; defaults to the coming Monday
  agedReceivables?: Array<{ amount: number; daysOverdue?: number; name?: string }>;
  agedPayables?: Array<{ amount: number; daysOverdue?: number; name?: string }>;
  weeklyPayroll?: number; // recurring cash outflow / week
  weeklyOverheads?: number; // recurring cash outflow / week (ex-payroll, ex-depreciation)
  oneOffs?: Array<{ week: number; amount: number; label: string }>; // +inflow / −outflow in a given week
  termDays?: number; // assumed settlement terms for scheduling (default 30)
  overdueHaircut?: number; // 0..1 write-down applied to 90+ day receivables (doubtful)
};

export type ThirteenWeekResult = {
  weeks: WeeklyCashflow[];
  openingCash: number;
  totalReceipts: number;
  totalPayments: number;
  closingCash: number;
  netMovement: number;
  lowestBalance: number;
  lowestWeek: number;
  firstNegativeWeek: number | null;
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
  const haircut = clamp(input.overdueHaircut ?? 0, 0, 1);
  const start = mondayOnOrAfter(input.startDate);

  const receiptsByWeek = new Array(WEEKS + 1).fill(0);
  const paymentsByWeek = new Array(WEEKS + 1).fill(0);

  for (const receivable of input.agedReceivables ?? []) {
    let amount = Math.abs(receivable.amount);
    if (amount <= 0) continue;
    const overdue = receivable.daysOverdue ?? 0;
    if (overdue > 90 && haircut > 0) amount *= 1 - haircut; // doubtful older debt
    receiptsByWeek[weekFor(overdue, termDays, 3)] += amount;
  }
  for (const payable of input.agedPayables ?? []) {
    const amount = Math.abs(payable.amount);
    if (amount <= 0) continue;
    paymentsByWeek[weekFor(payable.daysOverdue ?? 0, termDays, 1)] += amount;
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

  const weeks: WeeklyCashflow[] = [];
  let opening = input.openingCash;
  for (let week = 1; week <= WEEKS; week += 1) {
    const receipts = receiptsByWeek[week] + oneOffIn[week];
    const payments = paymentsByWeek[week] + payroll + overheads + oneOffOut[week];
    const net = receipts - payments;
    const closing = opening + net;
    weeks.push({
      week,
      weekStart: addDaysISO(start, (week - 1) * 7),
      weekEnd: addDaysISO(start, week * 7 - 1),
      opening: round(opening),
      receipts: round(receipts),
      payments: round(payments),
      net: round(net),
      closing: round(closing),
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

  const assumptions = [
    `Receivables collected around ${termDays}-day terms, less how overdue they already are (overdue balances chased into the near weeks).`,
    "Payables settled when due or overdue.",
    payroll > 0 ? `Payroll spread evenly at ${money(payroll)}/week.` : "No payroll run-rate supplied.",
    overheads > 0 ? `Operating overheads (ex-depreciation) at ${money(overheads)}/week.` : "No overhead run-rate supplied.",
    haircut > 0 ? `${Math.round(haircut * 100)}% write-down applied to 90+ day (doubtful) debtors.` : "No write-down on aged debtors.",
    ...(input.oneOffs ?? []).map((item) => `${item.label}: ${money(-Math.abs(item.amount))} in week ${clamp(Math.round(item.week), 1, WEEKS)}.`),
  ];

  return {
    weeks,
    openingCash: round(input.openingCash),
    totalReceipts: round(totalReceipts),
    totalPayments: round(totalPayments),
    closingCash: weeks[WEEKS - 1].closing,
    netMovement: round(totalReceipts - totalPayments),
    lowestBalance: round(lowestBalance),
    lowestWeek,
    firstNegativeWeek,
    assumptions,
  };
}

function money(value: number): string {
  const rounded = Math.round(value);
  return `${rounded < 0 ? "−£" : "£"}${Math.abs(rounded).toLocaleString("en-GB")}`;
}

const SCENARIOS: Record<CashflowScenario, { termDays: number; overdueHaircut: number }> = {
  upside: { termDays: 21, overdueHaircut: 0 },
  base: { termDays: 30, overdueHaircut: 0 },
  conservative: { termDays: 45, overdueHaircut: 0.5 },
};

export type StatementsForCashflow = {
  agedDebtors?: Row[];
  agedCreditors?: Row[];
  bank?: Row[];
  balanceSheet?: Row[];
  profitLoss?: Row[];
  asOfDate?: string;
};

// Derive a 13-week model input from a company's statements. Opening cash from the
// bank (or balance-sheet cash), receipts/payments from aged ledgers, payroll +
// overhead run-rates from the P&L (annualised → weekly), and the VAT liability as
// a one-off payment mid-quarter.
export function thirteenWeekInputFromStatements(statements: StatementsForCashflow, scenario: CashflowScenario = "base"): ThirteenWeekInput {
  const s = SCENARIOS[scenario];
  const bank = statements.bank ?? [];
  const bankCash = bank.reduce((sum, row) => sum + num(row.closing_balance), 0);
  const bsCash = (statements.balanceSheet ?? []).filter((row) => /cash|bank/i.test(String(row.item ?? ""))).reduce((sum, row) => sum + num(row.amount), 0);
  const openingCash = bank.length ? bankCash : bsCash;

  const agedReceivables = (statements.agedDebtors ?? []).map((row) => ({ amount: num(row.amount), daysOverdue: num(row.days_overdue), name: String(row.customer ?? row.name ?? "") }));
  const agedPayables = (statements.agedCreditors ?? []).map((row) => ({ amount: num(row.amount), daysOverdue: num(row.days_overdue), name: String(row.supplier ?? row.name ?? "") }));

  // Weekly run-rates from the annual P&L. Payroll = salary/wage/direct-labour
  // lines; overheads = other expense lines excluding depreciation (non-cash).
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
    startDate: statements.asOfDate,
    agedReceivables,
    agedPayables,
    weeklyPayroll: annualPayroll / 52,
    weeklyOverheads: annualOverheads / 52,
    oneOffs,
    termDays: s.termDays,
    overdueHaircut: s.overdueHaircut,
  };
}
