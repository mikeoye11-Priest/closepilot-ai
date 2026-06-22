import { normaliseCountry } from "./country";
import type { VatReturn, VatTransaction, VatTreatment } from "./types";

export type VatBox = Exclude<keyof VatReturn, "box3" | "box5">;

export type VatCodeMapping = {
  code: string;
  aliases: string[];
  description: string;
  appliesTo: "sale" | "purchase" | "both";
  treatment: VatTreatment;
  boxes: VatBox[];
  recoverability: "recoverable" | "not_recoverable" | "review" | "not_applicable";
  riskCategory: "standard" | "reverse_charge" | "import" | "blocked" | "zero_exempt" | "outside_scope" | "specialist" | "unknown";
  vatRate?: number;
  generatedVatRate?: number;
  reclaimInputVat?: boolean;
  blockInputVat?: boolean;
};

export type ResolvedVatMapping = VatCodeMapping & {
  reason: string;
};

const saleStandard: VatCodeMapping = {
  code: "STD_SALE",
  aliases: ["STD", "S", "STANDARD", "20", "20%", "T1", "SR"],
  description: "UK standard-rated sale",
  appliesTo: "sale",
  treatment: "standard",
  boxes: ["box1", "box6"],
  recoverability: "not_applicable",
  riskCategory: "standard",
  vatRate: 0.2,
};

const purchaseStandard: VatCodeMapping = {
  code: "STD_PURCHASE",
  aliases: ["PSTD", "STD", "P", "PUR", "PURCHASE_STD", "STANDARD", "20", "20%", "T1", "SR"],
  description: "UK standard-rated purchase",
  appliesTo: "purchase",
  treatment: "standard",
  boxes: ["box4", "box7"],
  recoverability: "recoverable",
  riskCategory: "standard",
  reclaimInputVat: true,
};

export const VAT_CODE_MATRIX: VatCodeMapping[] = [
  saleStandard,
  purchaseStandard,
  {
    code: "REDUCED_SALE",
    aliases: ["RR", "REDUCED", "5", "5%", "T5"],
    description: "UK reduced-rate sale",
    appliesTo: "sale",
    treatment: "reduced",
    boxes: ["box1", "box6"],
    recoverability: "not_applicable",
    riskCategory: "standard",
    vatRate: 0.05,
  },
  {
    code: "REDUCED_PURCHASE",
    aliases: ["RR", "REDUCED", "5", "5%", "T5"],
    description: "UK reduced-rate purchase",
    appliesTo: "purchase",
    treatment: "reduced",
    boxes: ["box4", "box7"],
    recoverability: "recoverable",
    riskCategory: "standard",
    reclaimInputVat: true,
  },
  {
    code: "ZERO_RATED_SALE",
    aliases: ["ZR", "Z", "ZERO", "ZERO_RATED", "EXP", "EXPORT", "EXPORT_SALE", "EXS", "0", "0%", "T0"],
    description: "UK zero-rated sale",
    appliesTo: "sale",
    treatment: "zero",
    boxes: ["box6"],
    recoverability: "not_applicable",
    riskCategory: "zero_exempt",
  },
  {
    code: "ZERO_RATED_PURCHASE",
    aliases: ["ZR", "Z", "ZERO", "ZERO_RATED", "0", "0%", "T0"],
    description: "UK zero-rated purchase",
    appliesTo: "purchase",
    treatment: "zero",
    boxes: ["box7"],
    recoverability: "not_applicable",
    riskCategory: "zero_exempt",
  },
  {
    code: "EXEMPT_SALE",
    aliases: ["EXEMPT", "EX", "E", "ES"],
    description: "Exempt sale",
    appliesTo: "sale",
    treatment: "exempt",
    boxes: ["box6"],
    recoverability: "not_applicable",
    riskCategory: "zero_exempt",
  },
  {
    code: "EXEMPT_PURCHASE",
    aliases: ["EXEMPT", "EX", "E", "ES"],
    description: "Exempt purchase",
    appliesTo: "purchase",
    treatment: "exempt",
    boxes: ["box7"],
    recoverability: "not_applicable",
    riskCategory: "zero_exempt",
  },
  {
    code: "REVERSE_CHARGE_PURCHASE",
    aliases: ["RC", "RCSL", "RCSS", "REVERSE", "REVERSE_CHARGE"],
    description: "Reverse charge purchase",
    appliesTo: "purchase",
    treatment: "reverse_charge",
    boxes: ["box1", "box4", "box7"],
    recoverability: "recoverable",
    riskCategory: "reverse_charge",
    generatedVatRate: 0.2,
    reclaimInputVat: true,
  },
  {
    code: "CONSTRUCTION_REVERSE_CHARGE_PURCHASE",
    aliases: ["CISRC", "DRC", "CIS_RC", "DOMESTIC_REVERSE_CHARGE", "CONSTRUCTION_RC"],
    description: "Construction reverse charge purchase",
    appliesTo: "purchase",
    treatment: "construction_reverse_charge",
    boxes: ["box1", "box4", "box7"],
    recoverability: "recoverable",
    riskCategory: "reverse_charge",
    generatedVatRate: 0.2,
    reclaimInputVat: true,
  },
  {
    code: "POSTPONED_IMPORT_VAT",
    aliases: ["IMP", "PVA", "IMPORT_VAT", "MPIVS", "IMPORT"],
    description: "Postponed import VAT statement",
    appliesTo: "purchase",
    treatment: "import_vat",
    boxes: ["box1", "box4", "box7"],
    recoverability: "recoverable",
    riskCategory: "import",
    generatedVatRate: 0.2,
    reclaimInputVat: true,
  },
  {
    code: "IMPORT_PURCHASE",
    aliases: ["IPUR", "IMPORT_PURCHASE", "IMPORT_NET"],
    description: "Import purchase value",
    appliesTo: "purchase",
    treatment: "import_vat",
    boxes: ["box7"],
    recoverability: "review",
    riskCategory: "import",
  },
  {
    code: "OUTSIDE_SCOPE",
    aliases: ["OOS", "OUTSIDE", "OUTSIDE_SCOPE", "OUT_OF_SCOPE", "T9", "NA", "N/A"],
    description: "Outside the scope of UK VAT",
    appliesTo: "both",
    treatment: "outside_scope",
    boxes: [],
    recoverability: "not_applicable",
    riskCategory: "outside_scope",
  },
  {
    code: "BLOCKED_INPUT_VAT",
    aliases: ["ENT", "CAR", "BLOCKED", "BLOCKED_INPUT", "NON_RECOVERABLE"],
    description: "Blocked input VAT",
    appliesTo: "purchase",
    treatment: "standard",
    boxes: [],
    recoverability: "not_recoverable",
    riskCategory: "blocked",
    blockInputVat: true,
  },
  {
    code: "FUEL_SCALE_CHARGE",
    aliases: ["FUEL", "FUEL_SCALE", "FUEL_SCALE_CHARGE"],
    description: "Fuel scale charge",
    appliesTo: "both",
    treatment: "standard",
    boxes: ["box1"],
    recoverability: "review",
    riskCategory: "specialist",
    vatRate: 0.2,
  },
];

export function resolveVatCodeMapping(transaction: VatTransaction): ResolvedVatMapping {
  const code = normaliseVatCode(transaction.vatCode);
  const type = transaction.type ?? "unknown";
  const detail = `${transaction.party ?? ""} ${transaction.description ?? ""} ${transaction.vatCode ?? ""}`.toLowerCase();
  const country = normaliseCountry(transaction.type === "sale" ? transaction.customerCountry : transaction.supplierCountry);

  if (type === "sale" && country.region !== "domestic" && /export|goods export|dispatch|exp/i.test(detail)) {
    return { ...mappingByCode("ZERO_RATED_SALE"), reason: `Export sale: country ${country.code || "unknown"} and VAT code ${transaction.vatCode || "n/a"} mapped to Box 6.` };
  }

  if (type === "purchase" && /company car|car purchase|vehicle purchase|motor car|bmw|mercedes|audi|tesla|entertainment|hospitality|client dinner|golf/i.test(detail)) {
    return { ...mappingByCode("BLOCKED_INPUT_VAT"), reason: "Blocked input VAT indicator from transaction description." };
  }

  if (type === "purchase" && country.region === "eu" && /google|aws|azure|adobe|salesforce|microsoft|cloud|hosting|software|subscription|reverse charge|rc/i.test(detail)) {
    return { ...mappingByCode("REVERSE_CHARGE_PURCHASE"), reason: `EU supplier/service context: country ${country.code} mapped to reverse charge.` };
  }

  if (type === "purchase" && country.region === "non_eu" && /import|pva|postponed|hmrc pva|mpivs|imp/i.test(detail)) {
    return { ...mappingByCode("POSTPONED_IMPORT_VAT"), reason: `Import VAT context: country ${country.code} mapped to PVA Boxes 1, 4 and 7.` };
  }

  const direct = VAT_CODE_MATRIX.find((mapping) => {
    if (mapping.appliesTo !== "both" && mapping.appliesTo !== type) return false;
    return mapping.aliases.some((alias) => normaliseVatCode(alias) === code) || normaliseVatCode(mapping.code) === code;
  });
  if (direct) return { ...direct, reason: `Matched VAT code ${transaction.vatCode || direct.code}.` };

  const treatment = transaction.treatment;
  if (treatment === "reverse_charge") return { ...mappingByCode("REVERSE_CHARGE_PURCHASE"), reason: "Classified as reverse charge." };
  if (treatment === "construction_reverse_charge") return { ...mappingByCode("CONSTRUCTION_REVERSE_CHARGE_PURCHASE"), reason: "Classified as construction reverse charge." };
  if (treatment === "import_vat") return { ...mappingByCode("POSTPONED_IMPORT_VAT"), reason: "Classified as postponed import VAT." };
  if (treatment === "zero") return { ...mappingByCode(type === "sale" ? "ZERO_RATED_SALE" : "ZERO_RATED_PURCHASE"), reason: "Classified as zero-rated." };
  if (treatment === "exempt") return { ...mappingByCode(type === "sale" ? "EXEMPT_SALE" : "EXEMPT_PURCHASE"), reason: "Classified as exempt." };
  if (treatment === "outside_scope") return { ...mappingByCode("OUTSIDE_SCOPE"), reason: "Classified as outside scope." };
  if (treatment === "reduced") return { ...mappingByCode(type === "sale" ? "REDUCED_SALE" : "REDUCED_PURCHASE"), reason: "Classified as reduced-rate." };
  if (treatment === "standard") return { ...(type === "purchase" ? purchaseStandard : saleStandard), reason: "Classified as standard-rate." };

  return {
    code: "UNKNOWN",
    aliases: [],
    description: "Unknown VAT treatment",
    appliesTo: "both",
    treatment: "unknown",
    boxes: type === "purchase" ? ["box7"] : type === "sale" ? ["box6"] : [],
    recoverability: "review",
    riskCategory: "unknown",
    reason: "No VAT code mapping matched.",
  };
}

function mappingByCode(code: string) {
  const mapping = VAT_CODE_MATRIX.find((item) => item.code === code);
  if (!mapping) throw new Error(`Missing VAT code mapping ${code}`);
  return mapping;
}

function normaliseVatCode(value: string | undefined) {
  return (value ?? "").trim().toUpperCase().replace(/[^A-Z0-9%]/g, "");
}
