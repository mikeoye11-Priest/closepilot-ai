export interface TrialBalanceLine {
  accountCode: string;
  accountName: string;
  balance: number;
  sourceRowIndex?: number;
  sourceFile?: string;
}
