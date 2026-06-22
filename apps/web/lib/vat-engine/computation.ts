import type { VatBoxContribution, VatReturn, VatTransaction } from "./types";
import { roundPounds } from "./utils";
import { resolveVatCodeMapping } from "./vat-code-matrix";

export const emptyVatReturn: VatReturn = {
  box1: 0,
  box2: 0,
  box3: 0,
  box4: 0,
  box5: 0,
  box6: 0,
  box7: 0,
  box8: 0,
  box9: 0,
};

export function computeVatReturn(transactions: VatTransaction[]): VatReturn {
  return computeVatReturnWithContributions(transactions).vatReturn;
}

export function computeVatReturnWithContributions(transactions: VatTransaction[]): { vatReturn: VatReturn; boxContributions: VatBoxContribution[] } {
  const result = { ...emptyVatReturn };
  const boxContributions: VatBoxContribution[] = [];

  for (const transaction of transactions) {
    const net = Math.abs(transaction.netAmount);
    const vat = Math.abs(transaction.vatAmount);
    const mapping = resolveVatCodeMapping(transaction);
    const generatedVat = mapping.generatedVatRate ? Math.round(net * mapping.generatedVatRate * 100) / 100 : vat;
    const outputVat = mapping.generatedVatRate ? generatedVat : vat;
    const inputVat = mapping.blockInputVat ? 0 : mapping.generatedVatRate ? generatedVat : vat;

    addContribution("box1", outputVat);
    addContribution("box2", outputVat);
    if (mapping.reclaimInputVat !== false) addContribution("box4", inputVat);
    addContribution("box6", net);
    addContribution("box7", net);
    addContribution("box8", net);
    addContribution("box9", net);

    function addContribution(box: Exclude<keyof VatReturn, "box3" | "box5">, amount: number) {
      if (!mapping.boxes.includes(box) || amount === 0) return;
      result[box] += amount;
      boxContributions.push({
        box,
        amount,
        party: transaction.party,
        description: transaction.description,
        vatCode: transaction.vatCode,
        canonicalCode: mapping.code,
        countryCode: transaction.countryCode,
        countryRegion: transaction.countryRegion,
        recoverability: mapping.recoverability,
        riskCategory: mapping.riskCategory,
        treatment: transaction.treatment,
        sourceFile: transaction.sourceFile,
        reason: mapping.reason,
      });
    }
  }

  result.box3 = result.box1 + result.box2;
  result.box5 = result.box3 - result.box4;

  const vatReturn = {
    box1: roundPounds(result.box1),
    box2: roundPounds(result.box2),
    box3: roundPounds(result.box3),
    box4: roundPounds(result.box4),
    box5: roundPounds(result.box5),
    box6: roundPounds(result.box6),
    box7: roundPounds(result.box7),
    box8: roundPounds(result.box8),
    box9: roundPounds(result.box9),
  };

  return { vatReturn, boxContributions };
}
