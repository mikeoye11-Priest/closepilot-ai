export type CanonicalField =
  | "accountCode"
  | "accountName"
  | "balance"
  | "debit"
  | "credit"
  | "customerName"
  | "supplierName"
  | "invoiceNumber"
  | "dueDate"
  | "amount"
  | "date"
  | "vatCode"
  | "netAmount"
  | "vatAmount";

export type ColumnMapping = Partial<Record<CanonicalField, string>>;

export interface MappingSuggestion {
  sourceColumn: string;
  targetField: CanonicalField;
  confidence: number;
}

export const fieldAliases: Record<CanonicalField, string[]> = {
  accountCode: ["account_code", "code", "account", "acct", "nominal", "nominal_code", "gl_account", "gl_code", "account_no"],
  accountName: ["account_name", "name", "description", "desc", "account_description", "nominal_name", "gl_account_name"],
  balance: ["balance", "closing_balance", "period_balance", "current_year", "this_year", "current_year_balance", "cy_balance", "amount", "net", "movement", "net_movement"],
  debit: ["debit", "debits", "dr", "debit_amount"],
  credit: ["credit", "credits", "cr", "credit_amount"],
  customerName: ["customer", "customer_name", "contact", "contact_name", "debtor", "debtor_name", "client", "client_name", "account_name", "name"],
  supplierName: ["supplier", "supplier_name", "contact", "contact_name", "vendor", "vendor_name", "creditor", "creditor_name", "payee", "account_name", "name"],
  invoiceNumber: ["invoice", "invoice_no", "invoice_number", "invoice_ref", "inv_no", "inv_ref", "reference", "ref", "document_number"],
  dueDate: ["due_date", "due_local", "payment_due", "due", "pay_by", "maturity_date"],
  amount: ["amount", "balance", "outstanding", "current", "invoice_amount", "net_amount", "total", "total_due", "value", "gross"],
  date: ["date", "invoice_date", "transaction_date", "posting_date", "entry_date", "document_date"],
  vatCode: ["vat_code", "tax_code", "vat_rate", "tax_rate", "vat_treatment", "tax_treatment"],
  netAmount: ["net", "net_amount", "amount", "gross_ex_vat", "ex_vat", "taxable_amount"],
  vatAmount: ["vat", "vat_amount", "tax", "tax_amount", "vat_value", "tax_value"],
};

export function normaliseColumnName(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

export function suggestMappings(headers: string[], fields: CanonicalField[]): MappingSuggestion[] {
  const normalised = headers.map((header) => ({ sourceColumn: header, normalised: normaliseColumnName(header) }));
  const suggestions: MappingSuggestion[] = [];

  for (const field of fields) {
    const aliases = fieldAliases[field];
    if (field === "accountName") {
      const genericAccount = normalised.find((header) => header.normalised === "account");
      if (genericAccount) {
        suggestions.push({ sourceColumn: genericAccount.sourceColumn, targetField: field, confidence: 0.97 });
        continue;
      }
    }
    const exact = normalised.find((header) => aliases.includes(header.normalised));
    if (exact) {
      suggestions.push({ sourceColumn: exact.sourceColumn, targetField: field, confidence: 0.97 });
      continue;
    }

    const fuzzy = normalised.find((header) => aliases.some((alias) => header.normalised.includes(alias) || alias.includes(header.normalised)));
    if (fuzzy) {
      suggestions.push({ sourceColumn: fuzzy.sourceColumn, targetField: field, confidence: 0.78 });
    }
  }

  return suggestions;
}

export function mappingFromSuggestions(suggestions: MappingSuggestion[]): ColumnMapping {
  return Object.fromEntries(suggestions.map((item) => [item.targetField, item.sourceColumn])) as ColumnMapping;
}

export function readMappedValue(row: Record<string, string>, mapping: ColumnMapping, field: CanonicalField) {
  const sourceColumn = mapping[field];
  return sourceColumn ? row[sourceColumn] ?? "" : "";
}
