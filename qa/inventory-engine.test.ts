import test from "node:test";
import assert from "node:assert/strict";
import { buildInventoryReview } from "../apps/web/lib/inventory-engine";

const ROWS = [
  { item: "Steel sheet", category: "Raw materials", qty: "100", unit_cost: "10", value: "1000", last_movement: "2026-07-01" },
  { item: "Widget A", category: "Finished goods", qty: "50", unit_cost: "20", value: "1000", last_movement: "2025-11-01" }, // slow-moving (6-12m)
  { item: "Legacy part", category: "Finished goods", qty: "30", unit_cost: "5", value: "150", last_movement: "2024-01-01" }, // obsolete (>12m)
  { item: "Assembly line 3", category: "WIP", qty: "1", unit_cost: "500", value: "500" }, // work in progress
  { item: "Bolt set", category: "Raw materials", qty: "-5", unit_cost: "10", value: "-50" }, // negative stock
  { item: "Widget B", category: "Finished goods", qty: "10", unit_cost: "12", value: "120", nrv: "8", last_movement: "2026-07-10" }, // NRV < cost
];

test("values inventory and classifies WIP, slow-moving, obsolete and negative stock", () => {
  const r = buildInventoryReview(ROWS, { asOfDate: "2026-07-16" });
  assert.equal(r.source, "computed");
  assert.equal(r.lineCount, 6);
  assert.equal(r.totalValue, 2720); // 1000+1000+150+500-50+120
  assert.equal(r.wipValue, 500);
  assert.equal(r.obsoleteValue, 150);
  assert.equal(r.slowMovingValue, 1000);
  assert.equal(r.negativeStockLines, 1);
  assert.equal(r.negativeStockValue, 50);
});

test("computes NRV write-down under FRS 102 §13", () => {
  const r = buildInventoryReview(ROWS, { asOfDate: "2026-07-16" });
  assert.equal(r.nrvWriteDown, 40); // 10 units * (12 - 8)
  const nrvFinding = r.findings.find((f) => f.id === "INV_004");
  assert.ok(nrvFinding);
  assert.match(nrvFinding.standard ?? "", /FRS 102 §13/);
});

test("derives stock days / turnover from COGS and reconciles to the ledger", () => {
  const r = buildInventoryReview(ROWS, { asOfDate: "2026-07-16", cogs: 10000, ledgerStockValue: 3000 });
  assert.equal(r.stockDays, 99); // 2720 / 10000 * 365
  assert.equal(r.turnover, 3.7); // 10000 / 2720
  assert.equal(r.ledgerDifference, 280); // |2720 - 3000|
  assert.ok(r.findings.some((f) => f.id === "INV_006")); // reconciliation gap flagged
});

test("raises the expected findings and returns empty for no stock lines", () => {
  const r = buildInventoryReview(ROWS, { asOfDate: "2026-07-16" });
  for (const id of ["INV_001", "INV_002", "INV_003", "INV_004", "INV_008"]) {
    assert.ok(r.findings.some((f) => f.id === id), `expected finding ${id}`);
  }
  assert.equal(buildInventoryReview([{ item: "x", qty: "0", value: "0" }]).source, "empty");
});
