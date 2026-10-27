import type { H3Event } from 'h3'
import { getJudgingTemplate, listJudgingRecords, requireJudgingDb } from './judging'
import { loadJudgingModel } from './judging-model'

interface WorkbookModule {
  importAssignment?: (templateBytes: Uint8Array) => unknown | Promise<unknown>
  exportWorkbook?: (templateBytes: Uint8Array, input: { judge: unknown, reviews: Record<string, unknown> }, options: { final: boolean }) => unknown | Promise<unknown>
  readiness?: (...args: unknown[]) => unknown | Promise<unknown>
}

let workbookPromise: Promise<WorkbookModule | null> | undefined

async function loadWorkbook(): Promise<WorkbookModule | null> {
  // The shared workbook model is supplied by the judging UI package at integration time.
  // @ts-expect-error The isolated backend worktree intentionally does not carry that package.
  workbookPromise ??= import('../../shared/judging/workbook.mjs').then(module => module as WorkbookModule).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    if (/cannot find module|module not found|failed to resolve/i.test(message))
      return null
    throw error
  })
  return workbookPromise
}

function objectData(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function readyValue(value: unknown): boolean {
  if (typeof value === 'boolean')
    return value
  const object = objectData(value)
  if (!object)
    return false
  if (typeof object.ready === 'boolean')
    return object.ready
  if (typeof object.ok === 'boolean')
    return object.ok
  if (typeof object.final === 'boolean')
    return object.final
  return false
}

function asBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array)
    return value
  if (value instanceof ArrayBuffer)
    return new Uint8Array(value)
  if (value && typeof value === 'object' && 'buffer' in value) {
    const typed = value as { buffer: ArrayBufferLike, byteOffset?: number, byteLength?: number }
    return new Uint8Array(typed.buffer, typed.byteOffset ?? 0, typed.byteLength ?? 0)
  }
  throw createError({ statusCode: 500, statusMessage: 'Judging workbook exporter returned invalid bytes' })
}

export async function validateJudgingWorkbookTemplate(bytes: Uint8Array): Promise<unknown> {
  const workbook = await loadWorkbook()
  if (!workbook?.importAssignment)
    throw createError({ statusCode: 503, statusMessage: 'Judging workbook model is not configured' })
  try {
    return await workbook.importAssignment(bytes)
  }
  catch (error) {
    throw createError({ statusCode: 400, statusMessage: error instanceof Error ? error.message : 'Judging workbook template is invalid' })
  }
}

export async function exportJudgingWorkbook(event: H3Event, final: boolean): Promise<Uint8Array> {
  const workbook = await loadWorkbook()
  if (!workbook?.exportWorkbook)
    throw createError({ statusCode: 503, statusMessage: 'Judging workbook model is not configured' })

  const records = await listJudgingRecords(requireJudgingDb(event))
  const judgeRecord = records.find(record => record.key === 'judge')
  const reviews = Object.fromEntries(records
    .filter(record => record.key.startsWith('review:'))
    .map(record => [record.key.slice('review:'.length), record.data]))
  const judge = judgeRecord?.data ?? {}
  const intakes = Object.fromEntries(records
    .filter(record => record.key.startsWith('intake:'))
    .map(record => [record.key.slice('intake:'.length), record.data]))

  if (final) {
    const model = await loadJudgingModel()
    if (typeof model.readiness === 'function') {
      const readiness = await model.readiness(judge, reviews, intakes)
      if (!readyValue(readiness))
        throw createError({ statusCode: 409, statusMessage: 'Judging workbook is not ready for final export', data: { readiness } })
    }
  }

  const template = await getJudgingTemplate(event)
  const exported = await workbook.exportWorkbook(template, { judge, reviews }, { final })
  return asBytes(exported)
}
