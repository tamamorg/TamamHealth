/**
 * ICD-11 common codes reference (see src/lib/icd11-codes.ts for the data).
 */
export interface ICD11Code {
  code: string;
  title: string;
  chapter: string;
}
