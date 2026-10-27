import type { H3Event } from 'h3'
import { ASSIGNMENT, readiness } from '../../shared/judging/model.mjs'
import { exportWorkbook, importAssignment } from '../../shared/judging/workbook.mjs'
import { getJudgingTemplate, listJudgingRecords, requireJudgingDb } from './judging'

export async function validateJudgingWorkbookTemplate(bytes: Uint8Array): Promise<typeof ASSIGNMENT> {
  try {
    return await importAssignment(bytes)
  }
  catch (error) {
    throw createError({ statusCode: 400, statusMessage: error instanceof Error ? error.message : 'Judging workbook template is invalid' })
  }
}

export async function exportJudgingWorkbook(event: H3Event, final: boolean): Promise<Uint8Array> {
  const records = await listJudgingRecords(requireJudgingDb(event))
  const judgeRecord = records.find(record => record.key === 'judge')
  const reviews = Object.fromEntries(records
    .filter(record => record.key.startsWith('review:'))
    .map(record => [record.key.slice('review:'.length), record.data]))
  const judge = judgeRecord?.data ?? { name: ASSIGNMENT.judgeName, domain: ASSIGNMENT.domain, date: '', generalNotes: '', warningsAcknowledged: false }
  const intakes = Object.fromEntries(records
    .filter(record => record.key.startsWith('intake:'))
    .map(record => [record.key.slice('intake:'.length), record.data]))

  if (final) {
    const result = readiness(judge, reviews, intakes)
    if (!result.ready)
      throw createError({ statusCode: 409, statusMessage: 'Judging workbook is not ready for final export', data: { readiness: result } })
  }

  const template = await getJudgingTemplate(event)
  return await exportWorkbook(template, { judge, reviews, intakes }, { final })
}
