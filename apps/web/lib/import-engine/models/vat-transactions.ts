export interface VatTransaction {
  vatCode: string;
  netAmount: number;
  vatAmount: number;
  date?: Date;
  sourceRowIndex?: number;
  sourceFile?: string;
}
