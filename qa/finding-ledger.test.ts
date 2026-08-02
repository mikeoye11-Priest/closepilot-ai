import test from "node:test";
import assert from "node:assert/strict";
import { buildFindingLedger, dedupeFindings, isOpenFinding, isScoreableFinding, lifecycleStatus } from "../apps/web/lib/finding-ledger";
import { checkInvariants } from "../apps/web/lib/invariants";
import type { Finding, FindingStatus, RiskLevel } from "../apps/web/lib/types";

let seq = 0;
const finding = (over: Partial<Finding> = {}): Finding => ({
  id: `f_${++seq}`,
  tenantId: "t", companyId: "c",
  severity: (over.severity ?? "high") as RiskLevel,
  category: over.category ?? "ar",
  title: over.title ?? "Overdue debtor balance",
  description: "", expectedImpact: over.expectedImpact ?? "£10,000",
  status: (over.status ?? "open") as FindingStatus,
  confidence: "high",
  evidence: { sourceFile: over.sourceFile ?? "aged-debtors.csv", accountCode: "", period: "", calculation: "" },
  ...over,
});

test("dedupeFindings collapses one issue cited twice and is idempotent", () => {
  const raw = [
    finding({ title: "90+ days overdue", sourceFile: "ar.csv" }),
    finding({ title: "90+ days overdue", sourceFile: "ar.csv" }), // same canonical identity
    finding({ title: "Different issue", sourceFile: "ar.csv" }),
  ];
  const once = dedupeFindings(raw);
  assert.equal(once.length, 2, "the duplicate is collapsed");
  const twice = dedupeFindings(once);
  assert.deepEqual(twice.map((f) => f.id), once.map((f) => f.id), "running again is a no-op (idempotent)");
});

test("classification: open excludes decided; scoreable excludes advisory + decided", () => {
  assert.equal(isOpenFinding(finding({ status: "open" })), true);
  assert.equal(isOpenFinding(finding({ status: "approved" })), false, "approved is decided");
  assert.equal(isOpenFinding(finding({ status: "resolved" })), false);
  assert.equal(isScoreableFinding(finding({ status: "open" })), true);
  assert.equal(isScoreableFinding(finding({ status: "open", evidenceStrength: "advisory" })), false, "advisory never scores");
  assert.equal(isScoreableFinding(finding({ status: "accepted_risk" })), false);
  assert.equal(lifecycleStatus("in_review"), "under_review");
  assert.equal(lifecycleStatus("accepted"), "approved");
});

test("buildFindingLedger rolls up open/critical counts, cash-at-risk and coverage over the unique set", () => {
  const ledger = buildFindingLedger([
    finding({ title: "A", severity: "critical", expectedImpact: "£50,000", sourceFile: "ar.csv" }),
    finding({ title: "A", severity: "critical", expectedImpact: "£50,000", sourceFile: "ar.csv" }), // duplicate
    finding({ title: "B", severity: "medium", category: "vat", expectedImpact: "£5,000", sourceFile: "vat.csv", status: "resolved" }),
    finding({ title: "C", severity: "high", expectedImpact: "£0", evidenceStrength: "advisory", sourceFile: "" }),
  ]);
  assert.equal(ledger.all.length, 4);
  assert.equal(ledger.unique.length, 3, "one duplicate removed");
  assert.equal(ledger.duplicatesExcluded, 1);
  assert.equal(ledger.openCount, 2, "resolved one is not open");
  assert.equal(ledger.criticalOpenCount, 2, "A (critical) and C (high) are both open critical/high");
  // cash-at-risk mirrors the historical definition: non-advisory with a positive
  // amount, counted once per unique finding, regardless of status.
  assert.equal(ledger.cashAtRisk, 55000, "A £50k + resolved-but-non-advisory B £5k; advisory + duplicate excluded");
  assert.equal(ledger.evidenceCoverage, 67, "2 of 3 unique findings have a source file");
});

test("INV-08 passes on a clean set and flags duplicates for review", () => {
  const clean = [finding({ title: "X" }), finding({ title: "Y" })];
  assert.equal(checkInvariants({ findings: clean }).invariants.find((i) => i.id === "INV-08")?.status, "pass");

  const dup = [finding({ title: "X", sourceFile: "a.csv" }), finding({ title: "X", sourceFile: "a.csv" })];
  const inv = checkInvariants({ findings: dup }).invariants.find((i) => i.id === "INV-08");
  assert.equal(inv?.status, "review");
  assert.match(inv!.detail, /duplicate/i);
});
