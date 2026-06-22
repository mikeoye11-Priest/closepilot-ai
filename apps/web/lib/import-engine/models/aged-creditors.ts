export interface Creditor {
  supplierName: string;
  invoiceNumber: string;
  amount: number;
  dueDate?: Date;
  sourceRowIndex?: number;
  sourceFile?: string;
}
