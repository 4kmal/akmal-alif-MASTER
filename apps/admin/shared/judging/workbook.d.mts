import type { Assignment, IntakeRecord, Judge, Review, TeamId } from './model.mjs'

export type WorkbookBytes = Uint8Array | ArrayBuffer | ArrayBufferView

export interface FormulaOracle {
  readonly formula: string
  readonly type?: 'shared' | 'array'
  readonly ref?: string
  readonly si?: string
}

export interface WorkbookPayload {
  judge: Partial<Judge>
  reviews: readonly Review[] | Partial<Record<TeamId, Partial<Review> | null>>
  intakes?: readonly IntakeRecord[] | Partial<Record<TeamId, IntakeRecord | null>>
}

export const SHEET_PATH: 'xl/worksheets/sheet1.xml'
export const WORKBOOK_FORMULA_ORACLE: Readonly<Record<string, FormulaOracle>>
export const WORKBOOK_WRITE_ALLOWLIST: readonly string[]

export function importAssignment(templateBytes: WorkbookBytes): Promise<Assignment>
export function exportWorkbook(templateBytes: WorkbookBytes, payload: WorkbookPayload, options?: { final?: boolean }): Promise<Uint8Array>
