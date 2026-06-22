export interface Debtor {
  customerName: string;
  invoiceNumber: string;
  amount: number;
  dueDate?: Date;
  sourceRowIndex?: number;
  sourceFile?: string;
}
