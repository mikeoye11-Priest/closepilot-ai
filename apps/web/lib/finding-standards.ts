// Maps a review finding to the accounting standard or HMRC guidance it engages,
// so each finding can answer "which rule does this relate to?". Deterministic and
// conservative: where no clear reporting standard applies (governance/control or
// data-quality items), it returns undefined rather than inventing a reference.

export type StandardReference = { label: string; detail: string };

export type FindingLike = { category?: string; title?: string; description?: string; ruleId?: string };

// Ordered most-specific-first: the first pattern that matches wins.
const KEYWORD_REFERENCES: Array<{ pattern: RegExp; ref: StandardReference }> = [
  { pattern: /deferred income|performance obligation|revenue recognition|unbilled|accrued income|invoiced?.*(before|ahead)|bill(ed)?.*advance/, ref: { label: "FRS 102 §23 Revenue", detail: "Recognise revenue as performance obligations are satisfied; amounts billed ahead of delivery are deferred income." } },
  { pattern: /bad debt|doubtful|irrecoverable|impairment|recoverab|write.?off.*(debt|receivable)/, ref: { label: "FRS 102 §11 Basic Financial Instruments", detail: "Trade receivables are carried net of any expected impairment loss." } },
  { pattern: /depreciation|fixed asset|tangible|property, plant|\bppe\b|motor vehicle|useful life|capitalis|capital expenditure|capex/, ref: { label: "FRS 102 §17 Property, Plant & Equipment", detail: "Assets are depreciated over their useful lives; additions and disposals must be reflected." } },
  { pattern: /goodwill|intangible|amortis|amortiz/, ref: { label: "FRS 102 §18/§19 Intangibles & Business Combinations", detail: "Intangible assets and goodwill are recognised and amortised under FRS 102." } },
  { pattern: /\bstock\b|inventor/, ref: { label: "FRS 102 §13 Inventories", detail: "Inventory is measured at the lower of cost and estimated selling price less costs to complete and sell." } },
  { pattern: /provision|contingen|onerous|dilapidation/, ref: { label: "FRS 102 §21 Provisions & Contingencies", detail: "Provide when there is a present obligation, a probable outflow and a reliable estimate." } },
  { pattern: /related party|director.?s?\s*loan|intercompany|intra.?group|\bdla\b/, ref: { label: "FRS 102 §33 Related Party Disclosures", detail: "Related-party balances and transactions require disclosure in the accounts." } },
  { pattern: /accrual|prepayment|cut.?off/, ref: { label: "FRS 102 §2 Concepts (accruals basis)", detail: "Income and costs are recognised in the period they relate to, not when cash moves." } },
  { pattern: /payroll|\bpaye\b|\bnic\b|national insurance|wages|salary|salaries/, ref: { label: "HMRC PAYE / RTI obligations", detail: "Payroll is reported to HMRC in real time; PAYE/NIC liabilities must reconcile to the ledger." } },
];

const CATEGORY_REFERENCES: Record<string, StandardReference> = {
  vat: { label: "VAT Notice 700 (HMRC VAT guide)", detail: "Output/input VAT treatment, recovery restrictions and record-keeping requirements." },
  financial_statements: { label: "FRS 102 §3–§8 Financial Statement Presentation", detail: "Statutory accounts must present a true and fair view and reconcile across the primary statements." },
  ar: { label: "FRS 102 §11 Basic Financial Instruments", detail: "Trade receivables are carried net of expected impairment." },
  ap: { label: "FRS 102 §2 Concepts (completeness & accruals)", detail: "Liabilities are recognised when incurred; confirm completeness of creditors and no duplicate postings." },
  month_end: { label: "FRS 102 §2 Concepts (accruals basis)", detail: "Recognise income and costs in the correct period at the reporting date." },
};

export function findingStandardReference(finding: FindingLike): StandardReference | undefined {
  const text = `${finding.title ?? ""} ${finding.description ?? ""} ${finding.ruleId ?? ""}`.toLowerCase();
  for (const { pattern, ref } of KEYWORD_REFERENCES) {
    if (pattern.test(text)) return ref;
  }
  return finding.category ? CATEGORY_REFERENCES[finding.category] : undefined;
}
