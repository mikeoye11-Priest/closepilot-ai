export type VatLayerId = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export type VatRuleDefinition = {
  id: string;
  layer: VatLayerId;
  name: string;
  purpose: string;
};

export const VAT_LAYERS: Record<VatLayerId, string> = {
  1: "VAT Computation Engine",
  2: "VAT Classification Engine",
  3: "VAT Assurance Rules",
  4: "Blocked VAT Engine",
  5: "VAT Reconciliation Engine",
  6: "Advanced VAT Rules",
  7: "VAT Risk Scoring",
};

export const VAT_RULE_CATALOG: VatRuleDefinition[] = [
  { id: "VAT001", layer: 1, name: "Standard Rated Sale", purpose: "Map output VAT to Box 1 and net sales to Box 6." },
  { id: "VAT002", layer: 1, name: "Standard Rated Purchase", purpose: "Map input VAT to Box 4 and net purchases to Box 7." },
  { id: "VAT003", layer: 1, name: "Zero Rated Sale", purpose: "Map zero-rated sales to Box 6." },
  { id: "VAT004", layer: 1, name: "Exempt Sale", purpose: "Map exempt sales to Box 6 for VAT return totals." },
  { id: "VAT005", layer: 1, name: "Reverse Charge Service", purpose: "Self-account output and input VAT, with net purchases in Box 7." },
  { id: "VAT006", layer: 1, name: "Import VAT PVA", purpose: "Self-account postponed import VAT and include imports in purchases." },
  { id: "VAT007", layer: 1, name: "EU Acquisition Goods", purpose: "Map EU acquisitions to Boxes 2, 4, 7 and 9." },
  { id: "VAT010", layer: 2, name: "Digital Services Supplier", purpose: "Classify Google, AWS, Azure, Adobe, Microsoft and Salesforce as reverse charge candidates." },
  { id: "VAT011", layer: 2, name: "Zero Rated Description", purpose: "Classify books, children clothing and food as zero-rated indicators." },
  { id: "VAT012", layer: 2, name: "Exempt Description", purpose: "Classify insurance and financial services as exempt indicators." },
  { id: "VAT013", layer: 2, name: "Construction Reverse Charge", purpose: "Classify construction supplier transactions as domestic reverse charge candidates." },
  { id: "VAT100", layer: 3, name: "Missing VAT Code", purpose: "Detect transactions without VAT/tax code." },
  { id: "VAT101", layer: 3, name: "Invalid VAT Rate", purpose: "Detect unexpected VAT rates such as 18%." },
  { id: "VAT102", layer: 3, name: "VAT Amount Mismatch", purpose: "Check VAT amount against net times expected rate." },
  { id: "VAT103", layer: 3, name: "Manual VAT Override", purpose: "Identify manual override indicators requiring review." },
  { id: "VAT104", layer: 3, name: "Negative VAT Transaction", purpose: "Flag negative VAT entries for review." },
  { id: "VAT105", layer: 3, name: "VAT On Non-VAT Invoice", purpose: "Flag VAT claimed where evidence suggests no VAT invoice." },
  { id: "VAT106", layer: 3, name: "VAT Claimed But No VAT Number", purpose: "Flag recoveries lacking supplier VAT number evidence." },
  { id: "VAT200", layer: 4, name: "Client Entertainment", purpose: "Block or review client entertainment VAT." },
  { id: "VAT201", layer: 4, name: "Hospitality", purpose: "Review hospitality input VAT recovery." },
  { id: "VAT202", layer: 4, name: "Company Car Purchase", purpose: "Block or restrict company car input VAT." },
  { id: "VAT203", layer: 4, name: "Private Expenditure", purpose: "Flag private expenditure VAT risk." },
  { id: "VAT204", layer: 4, name: "Director Personal Expenses", purpose: "Flag director personal expense VAT risk." },
  { id: "VAT205", layer: 4, name: "Mixed Business Private Expense", purpose: "Flag mixed use input VAT apportionment risk." },
  { id: "VAT300", layer: 5, name: "VAT Return vs VAT Control", purpose: "Reconcile VAT return payable to VAT control account." },
  { id: "VAT301", layer: 5, name: "Box 1 vs Sales VAT Ledger", purpose: "Reconcile Box 1 to output VAT transactions." },
  { id: "VAT302", layer: 5, name: "Box 4 vs Purchase VAT Ledger", purpose: "Reconcile Box 4 to recoverable input VAT transactions." },
  { id: "VAT303", layer: 5, name: "HMRC Payment vs VAT Control", purpose: "Review HMRC payment against VAT control movement." },
  { id: "VAT304", layer: 5, name: "PVA Statement vs Import VAT", purpose: "Reconcile PVA statement to import VAT entries." },
  { id: "VAT305", layer: 5, name: "Opening Balance Roll Forward", purpose: "Check VAT opening balance roll-forward." },
  { id: "VAT400", layer: 6, name: "Fuel Scale Charge", purpose: "Review fuel scale charge requirement." },
  { id: "VAT401", layer: 6, name: "Mileage Adjustment", purpose: "Review mileage input VAT adjustment." },
  { id: "VAT402", layer: 6, name: "Partial Exemption", purpose: "Review partial exemption recovery restrictions." },
  { id: "VAT403", layer: 6, name: "Charity VAT", purpose: "Review charity VAT treatment." },
  { id: "VAT404", layer: 6, name: "Capital Goods Scheme", purpose: "Review capital goods scheme adjustments." },
  { id: "VAT405", layer: 6, name: "Property VAT", purpose: "Review property VAT treatment." },
  { id: "VAT406", layer: 6, name: "Option To Tax", purpose: "Review option to tax evidence." },
  { id: "VAT407", layer: 6, name: "International Services", purpose: "Review international services place of supply." },
  { id: "VAT500", layer: 7, name: "VAT Health Score", purpose: "Score computation, reconciliation, coding, blocked VAT, documentation and manual adjustment risk." },
];

export function vatRule(id: string) {
  return VAT_RULE_CATALOG.find((rule) => rule.id === id);
}
