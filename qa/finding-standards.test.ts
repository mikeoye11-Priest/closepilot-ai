import test from "node:test";
import assert from "node:assert/strict";
import { findingStandardReference } from "../apps/web/lib/finding-standards";

test("maps revenue/deferred-income findings to FRS 102 §23", () => {
  const ref = findingStandardReference({ category: "financial_statements", title: "Deferred income", description: "Invoice posted before performance obligation met" });
  assert.ok(ref);
  assert.match(ref.label, /§23/);
});

test("maps VAT findings to the HMRC VAT guide", () => {
  const ref = findingStandardReference({ category: "vat", title: "VAT box arithmetic", description: "Box 5 does not agree" });
  assert.ok(ref);
  assert.match(ref.label, /VAT Notice 700/);
});

test("maps depreciation/fixed-asset findings to FRS 102 §17", () => {
  const ref = findingStandardReference({ category: "financial_statements", title: "Depreciation not posted", description: "No depreciation charge for the period" });
  assert.ok(ref);
  assert.match(ref.label, /§17/);
});

test("keyword match beats the category fallback", () => {
  // An AR-category finding about bad debt still resolves to the impairment ref.
  const ref = findingStandardReference({ category: "ar", title: "Irrecoverable balance", description: "Debtor likely bad debt, provision required" });
  assert.ok(ref);
  assert.match(ref.label, /§11/);
});

test("returns undefined for governance/data-quality items with no reporting standard", () => {
  assert.equal(findingStandardReference({ category: "controls", title: "Segregation of duties", description: "Same user posts and approves" }), undefined);
  assert.equal(findingStandardReference({ category: "data_quality", title: "Missing customer names", description: "AR rows have no customer" }), undefined);
});
