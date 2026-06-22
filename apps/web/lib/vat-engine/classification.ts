import type { VatTransaction, VatTreatment } from "./types";

const standardCodes = /^(s|std|pstd|standard|t1|sr|20%|20)$/i;
const reducedCodes = /^(rr|reduced|t5|5%|5)$/i;
const zeroCodes = /^(z|zr|exp|export|zero|t0|0%|0)$/i;
const exemptCodes = /^(e|ex|exempt|es)$/i;
const outsideScopeCodes = /^(oos|outside|outside_scope|out_of_scope|t9|na|n\/a)$/i;
const reverseChargeCodes = /^(rc|reverse|reverse_charge|rcsl|rcss)$/i;
const importCodes = /^(imp|pva|import|import_vat|mpivs)$/i;
const constructionReverseChargeCodes = /^(cisrc|drc|cis_rc|construction_rc|domestic_reverse_charge)$/i;

export function classifyVatTransaction(input: Omit<VatTransaction, "treatment">): VatTreatment {
  const vatCode = input.vatCode?.trim() ?? "";
  const detail = `${input.party ?? ""} ${input.description ?? ""} ${vatCode}`.toLowerCase();

  if (constructionReverseChargeCodes.test(vatCode) || (/construction|cis|subcontract|brickwork|roofing|scaffolding|electrical|plumbing/.test(detail) && /reverse|rc|domestic|cisrc/.test(detail))) {
    return "construction_reverse_charge";
  }
  if (importCodes.test(vatCode) || /postponed vat|pva|import vat|mpivs/.test(detail)) return "import_vat";
  if (reverseChargeCodes.test(vatCode) || /reverse charge|google ireland|aws|azure|adobe|salesforce|microsoft ireland/.test(detail)) return "reverse_charge";
  if (standardCodes.test(vatCode)) return "standard";
  if (reducedCodes.test(vatCode)) return "reduced";
  if (zeroCodes.test(vatCode)) return "zero";
  if (exemptCodes.test(vatCode)) return "exempt";
  if (outsideScopeCodes.test(vatCode)) return "outside_scope";
  if (!vatCode && input.vatAmount === 0) return "unknown";
  if (Math.abs(input.vatAmount) > 0 && Math.abs(input.netAmount) > 0) {
    const rate = Math.abs(input.vatAmount / input.netAmount);
    if (rate > 0.17 && rate < 0.23) return "standard";
    if (rate > 0.035 && rate < 0.065) return "reduced";
  }
  return "unknown";
}
