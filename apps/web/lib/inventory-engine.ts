// Inventory & WIP review engine. Takes a stock/WIP report (rows from an uploaded
// CSV — item, quantity, cost, value, category, last-movement date, optional NRV)
// and produces a management + assurance view: valuation, ageing, slow-moving and
// obsolete stock, negative/zero-cost lines, NRV write-downs (FRS 102 §13),
// turnover (given COGS), and reconciliation to the ledger stock/WIP balance.
//
// Deterministic: every figure comes from the rows. Checks that need data the
// report does not carry (movement dates, NRV, COGS, ledger balance) are simply
// skipped rather than guessed.

const SKU_KEYS = ["sku", "item_code", "code", "product_code", "stock_code", "part_number", "item", "item_number"];
const NAME_KEYS = ["description", "item_name", "name", "product", "product_name", "details"];
const CATEGORY_KEYS = ["category", "type", "group", "product_group", "item_type", "stock_type", "classification", "class"];
const QTY_KEYS = ["quantity", "qty", "stock_on_hand", "soh", "units", "on_hand", "balance_qty", "closing_qty", "quantity_on_hand"];
const UNIT_COST_KEYS = ["unit_cost", "cost", "cost_price", "avg_cost", "average_cost", "standard_cost", "unit_cost_price"];
const VALUE_KEYS = ["value", "stock_value", "total_value", "valuation", "total_cost", "extended_cost", "inventory_value", "closing_value"];
const NRV_KEYS = ["nrv", "net_realisable_value", "selling_price", "sell_price", "retail_price", "sales_price", "market_value"];
const DATE_KEYS = ["last_movement", "last_movement_date", "last_sold", "last_used", "last_transaction", "last_activity", "last_sale_date", "last_receipt", "last_movement_dt"];

export type InventoryFinding = {
  id: string;
  severity: "critical" | "high" | "medium" | "low";
  title: string;
  detail: string;
  standard?: string;
  exposure: number;
};

export type InventoryReviewResult = {
  source: "computed" | "empty";
  asOfDate: string;
  lineCount: number;
  totalQty: number;
  totalValue: number;
  wipValue: number;
  byCategory: Array<{ category: string; value: number; lines: number }>;
  hasMovementDates: boolean;
  hasNrv: boolean;
  ageing: { current: number; days90: number; days180: number; days365: number; unknown: number };
  slowMovingValue: number;
  obsoleteValue: number;
  negativeStockLines: number;
  negativeStockValue: number;
  zeroCostLines: number;
  nrvWriteDown: number;
  stockDays?: number;
  turnover?: number;
  ledgerValue?: number;
  ledgerDifference?: number;
  topItems: Array<{ item: string; category: string; qty: number; value: number; daysSinceMovement?: number }>;
  findings: InventoryFinding[];
};

const EMPTY: InventoryReviewResult = {
  source: "empty", asOfDate: "", lineCount: 0, totalQty: 0, totalValue: 0, wipValue: 0, byCategory: [],
  hasMovementDates: false, hasNrv: false, ageing: { current: 0, days90: 0, days180: 0, days365: 0, unknown: 0 },
  slowMovingValue: 0, obsoleteValue: 0, negativeStockLines: 0, negativeStockValue: 0, zeroCostLines: 0,
  nrvWriteDown: 0, topItems: [], findings: [],
};

function text(row: Record<string, string>, keys: string[]): string {
  for (const key of keys) { const value = row[key]; if (value !== undefined && String(value).trim() !== "") return String(value).trim(); }
  return "";
}
function money(value: string): number {
  if (!value) return 0;
  const parsed = Number(value.replace(/[£$,()]/g, (c) => (c === "(" ? "-" : "")).replace(")", "").replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}
function isWip(category: string): boolean {
  return /\bwip\b|work.in.progress|work in process|in.production|unfinished|semi.finished/i.test(category);
}

export function buildInventoryReview(
  rows: Record<string, string>[],
  options: { asOfDate?: string; cogs?: number; ledgerStockValue?: number } = {},
): InventoryReviewResult {
  const asOfDate = options.asOfDate || new Date().toISOString().slice(0, 10);
  const asOfMs = Date.parse(asOfDate);

  const lines = rows
    .map((row) => {
      const qty = money(text(row, QTY_KEYS));
      const unitCost = money(text(row, UNIT_COST_KEYS));
      const explicitValue = money(text(row, VALUE_KEYS));
      const value = explicitValue || qty * unitCost;
      const nrvRaw = text(row, NRV_KEYS);
      const nrv = nrvRaw ? money(nrvRaw) : undefined;
      const dateRaw = text(row, DATE_KEYS);
      const movementMs = dateRaw ? Date.parse(dateRaw) : NaN;
      const daysSinceMovement = Number.isFinite(movementMs) && Number.isFinite(asOfMs) ? Math.max(0, Math.floor((asOfMs - movementMs) / 86_400_000)) : undefined;
      const category = text(row, CATEGORY_KEYS) || "Uncategorised";
      return {
        item: text(row, NAME_KEYS) || text(row, SKU_KEYS) || "Unnamed item",
        category, qty, unitCost, value, nrv,
        hasNrvCol: nrvRaw !== "",
        daysSinceMovement,
      };
    })
    .filter((line) => line.qty !== 0 || line.value !== 0 || line.unitCost !== 0);

  if (!lines.length) return { ...EMPTY, asOfDate };

  const totalValue = lines.reduce((sum, line) => sum + line.value, 0);
  const totalQty = lines.reduce((sum, line) => sum + line.qty, 0);
  const wipValue = lines.filter((line) => isWip(line.category)).reduce((sum, line) => sum + line.value, 0);
  const hasMovementDates = lines.some((line) => line.daysSinceMovement !== undefined);
  const hasNrv = lines.some((line) => line.hasNrvCol);

  const categoryMap = new Map<string, { value: number; lines: number }>();
  for (const line of lines) {
    const entry = categoryMap.get(line.category) ?? { value: 0, lines: 0 };
    entry.value += line.value; entry.lines += 1;
    categoryMap.set(line.category, entry);
  }
  const byCategory = [...categoryMap.entries()].map(([category, v]) => ({ category, value: Math.round(v.value), lines: v.lines })).sort((a, b) => b.value - a.value);

  const ageing = { current: 0, days90: 0, days180: 0, days365: 0, unknown: 0 };
  for (const line of lines) {
    const days = line.daysSinceMovement;
    if (days === undefined) ageing.unknown += line.value;
    else if (days <= 90) ageing.current += line.value;
    else if (days <= 180) ageing.days90 += line.value;
    else if (days <= 365) ageing.days180 += line.value;
    else ageing.days365 += line.value;
  }

  const slowMoving = lines.filter((line) => line.daysSinceMovement !== undefined && line.daysSinceMovement > 180 && line.daysSinceMovement <= 365 && line.value > 0);
  const obsolete = lines.filter((line) => line.daysSinceMovement !== undefined && line.daysSinceMovement > 365 && line.value > 0);
  const slowMovingValue = Math.round(slowMoving.reduce((sum, line) => sum + line.value, 0));
  const obsoleteValue = Math.round(obsolete.reduce((sum, line) => sum + line.value, 0));

  const negative = lines.filter((line) => line.qty < 0);
  const negativeStockValue = Math.round(Math.abs(negative.reduce((sum, line) => sum + line.value, 0)));
  const zeroCostLines = lines.filter((line) => line.qty > 0 && line.unitCost <= 0 && line.value <= 0).length;

  const nrvWriteDown = Math.round(lines
    .filter((line) => line.nrv !== undefined && line.qty > 0 && line.nrv < line.unitCost)
    .reduce((sum, line) => sum + Math.abs(line.qty) * (line.unitCost - (line.nrv ?? 0)), 0));

  const stockDays = options.cogs && options.cogs > 0 ? Math.round((totalValue / options.cogs) * 365) : undefined;
  const turnover = options.cogs && options.cogs > 0 && totalValue > 0 ? Math.round((options.cogs / totalValue) * 10) / 10 : undefined;

  const ledgerValue = options.ledgerStockValue;
  const ledgerDifference = ledgerValue !== undefined ? Math.round(Math.abs(totalValue - ledgerValue)) : undefined;

  const topItems = [...lines].sort((a, b) => b.value - a.value).slice(0, 8).map((line) => ({
    item: line.item, category: line.category, qty: Math.round(line.qty * 100) / 100, value: Math.round(line.value), daysSinceMovement: line.daysSinceMovement,
  }));

  const findings: InventoryFinding[] = [];
  if (negative.length) findings.push({ id: "INV_001", severity: "high", title: `${negative.length} negative stock line(s) — ${fc(negativeStockValue)}`, detail: "Negative on-hand quantities indicate mis-postings, over-issues or missing receipts; investigate before relying on the valuation.", exposure: negativeStockValue });
  if (obsoleteValue > 0) findings.push({ id: "INV_002", severity: "high", title: `Obsolete stock (>12 months no movement) — ${fc(obsoleteValue)}`, detail: `${obsolete.length} line(s) with no movement for over a year. A provision to net realisable value is likely required.`, standard: "FRS 102 §13 Inventories", exposure: obsoleteValue });
  if (slowMovingValue > 0) findings.push({ id: "INV_003", severity: "medium", title: `Slow-moving stock (6–12 months) — ${fc(slowMovingValue)}`, detail: `${slowMoving.length} line(s) with no movement for 6–12 months; review for provision or clearance.`, standard: "FRS 102 §13 Inventories", exposure: slowMovingValue });
  if (nrvWriteDown > 0) findings.push({ id: "INV_004", severity: "high", title: `Cost exceeds net realisable value — ${fc(nrvWriteDown)} write-down`, detail: "One or more lines are held above net realisable value and must be written down to the lower of cost and NRV.", standard: "FRS 102 §13 Inventories", exposure: nrvWriteDown });
  if (zeroCostLines) findings.push({ id: "INV_005", severity: "medium", title: `${zeroCostLines} line(s) held with quantity but zero cost`, detail: "Stock on hand carried at nil value understates inventory; confirm standard/average costs are loaded.", standard: "FRS 102 §13 Inventories", exposure: 0 });
  if (ledgerDifference !== undefined && ledgerDifference > Math.max(100, totalValue * 0.005)) findings.push({ id: "INV_006", severity: "high", title: `Stock report does not agree to the ledger — ${fc(ledgerDifference)}`, detail: `Report total ${fc(Math.round(totalValue))} vs ledger stock/WIP balance ${fc(Math.round(ledgerValue ?? 0))}. Reconcile before sign-off.`, exposure: ledgerDifference });
  if (stockDays !== undefined && stockDays > 120) findings.push({ id: "INV_007", severity: stockDays > 240 ? "high" : "medium", title: `Inventory days high — ${stockDays} days`, detail: `Stock represents ${stockDays} days of cost of sales (turnover ${turnover}x). Elevated stock days tie up working capital and raise obsolescence risk.`, exposure: 0 });
  if (wipValue > 0) findings.push({ id: "INV_008", severity: "medium", title: `Work in progress on hand — ${fc(Math.round(wipValue))}`, detail: "WIP valuation should include materials, labour and appropriate overheads, and exclude abnormal waste. Confirm the basis and stage of completion.", standard: "FRS 102 §13 Inventories", exposure: 0 });

  return {
    source: "computed", asOfDate,
    lineCount: lines.length, totalQty: Math.round(totalQty * 100) / 100, totalValue: Math.round(totalValue),
    wipValue: Math.round(wipValue), byCategory,
    hasMovementDates, hasNrv,
    ageing: { current: Math.round(ageing.current), days90: Math.round(ageing.days90), days180: Math.round(ageing.days180), days365: Math.round(ageing.days365), unknown: Math.round(ageing.unknown) },
    slowMovingValue, obsoleteValue,
    negativeStockLines: negative.length, negativeStockValue, zeroCostLines,
    nrvWriteDown, stockDays, turnover, ledgerValue, ledgerDifference,
    topItems,
    findings: findings.sort((a, b) => severityRank(b.severity) - severityRank(a.severity)),
  };
}

function severityRank(severity: InventoryFinding["severity"]): number {
  return { critical: 4, high: 3, medium: 2, low: 1 }[severity];
}
function fc(value: number): string {
  return `£${Math.round(value).toLocaleString("en-GB")}`;
}
