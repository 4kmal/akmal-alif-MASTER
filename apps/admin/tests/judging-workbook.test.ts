import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'

import {
  ASSIGNMENT,
  DOMAIN,
  JUDGE_NAME,
  TEAM_IDS,
  TEAMS,
  calculateReviews,
  readiness,
  validateRecord,
} from '../shared/judging/model.mjs'
import {
  SHEET_PATH,
  WORKBOOK_FORMULA_ORACLE,
  exportWorkbook,
  importAssignment,
} from '../shared/judging/workbook.mjs'

const SOURCE_PATH = 'C:/Users/Admin/Desktop/KRACKEDDEV/Hackathon/sdcHackathon/Scoresheet D1-J04 - Muhammad Akmal Alif bin Azam.xlsx'
const sourceAvailable = existsSync(SOURCE_PATH)

function review(teamId, scores = [80, 80, 80, 80], repoCheck = 'Yes', extras = {}) {
  return {
    teamId,
    scores,
    repoCheck,
    notes: '',
    reviewedAt: '2026-10-28T12:00:00.000Z',
    features: Array.from({ length: 6 }, () => ({ proposal: 'unverified', demo: 'unverified', note: '' })),
    warningsAcknowledged: false,
    ...extras,
  }
}

function allReviews(repoCheck = 'Yes', extras = {}) {
  return Object.fromEntries(TEAM_IDS.map(teamId => [teamId, review(teamId, [80, 80, 80, 80], repoCheck, extras)]))
}

const judge = {
  name: JUDGE_NAME,
  date: '2026-10-28',
  domain: DOMAIN,
  generalNotes: '',
  warningsAcknowledged: false,
}

async function sheetXml(bytes) {
  const zip = await JSZip.loadAsync(bytes)
  return zip.file(SHEET_PATH).async('string')
}

function cellXml(xml, reference) {
  const starts = [...xml.matchAll(/<c\b[^>]*>/g)]
  for (const start of starts) {
    if (!new RegExp('(?:^|\\s)r="' + reference + '"').test(start[0]))
      continue
    if (/\/\s*>$/.test(start[0]))
      return start[0]
    const end = xml.indexOf('</c>', start.index + start[0].length)
    return xml.slice(start.index, end + 4)
  }
  return undefined
}

describe('canonical judging model', () => {
  it('calculates unrounded weighted totals and competition ranks', () => {
    const rows = calculateReviews({
      [TEAM_IDS[0]]: review(TEAM_IDS[0], [80, 80, 80, 80]),
      [TEAM_IDS[1]]: review(TEAM_IDS[1], [80, 80, 80, 80]),
      [TEAM_IDS[2]]: review(TEAM_IDS[2], [60, 60, 60, 60]),
      [TEAM_IDS[3]]: review(TEAM_IDS[3], [0, 0, 0, 0]),
    })
    expect(rows[0].contribution).toEqual([24, 20, 20, 16])
    expect(rows[0].total).toBe(80)
    expect(rows[0].rank).toBe(1)
    expect(rows[1].rank).toBe(1)
    expect(rows[2].rank).toBe(3)
    expect(rows[3].total).toBe(0)
    expect(rows[3].status).toBe('Complete')
    expect(rows[4].status).toBe('Not started')
  })

  it('keeps negative repository selections score-neutral and gates readiness acknowledgements', () => {
    const reviews = allReviews('No – private/broken')
    let result = readiness(judge, reviews)
    expect(result.ready).toBe(false)
    expect(result.negativeRepoSelections).toHaveLength(9)
    expect(result.negativeSelectionWarningsAcknowledged).toBe(false)

    const acknowledged = Object.fromEntries(TEAM_IDS.map(teamId => [teamId, review(teamId, [80, 80, 80, 80], 'No – private/broken', { warningsAcknowledged: true })]))
    result = readiness({ ...judge, warningsAcknowledged: true }, acknowledged)
    expect(result.ready).toBe(true)
    expect(result.rows[0].total).toBe(80)
  })

  it('validates constrained server record keys and bounded evidence/intake payloads', () => {
    expect(validateRecord('judge', judge)).toBe(true)
    expect(validateRecord('review:' + TEAM_IDS[0], review(TEAM_IDS[0]))).toBe(true)
    expect(validateRecord('review:not-a-team', review(TEAM_IDS[0]))).toBe(false)
    expect(validateRecord('evidence:00000000-0000-4000-8000-000000000000', { teamId: TEAM_IDS[0], text: 'x'.repeat(262144) })).toBe(true)
    expect(validateRecord('evidence:00000000-0000-4000-8000-000000000000', { teamId: TEAM_IDS[0], text: 'x'.repeat(262145) })).toBe(false)
    expect(validateRecord('intake:' + TEAM_IDS[0], { teamId: TEAM_IDS[0], inventory: Array.from({ length: 1000 }, (_, index) => ({ path: String(index) })) })).toBe(true)
    expect(validateRecord('intake:' + TEAM_IDS[0], { teamId: TEAM_IDS[0], inventory: Array.from({ length: 1001 }, (_, index) => ({ path: String(index) })) })).toBe(false)
    expect(validateRecord('assessment:00000000-0000-4000-8000-000000000000', { score: Number.NaN })).toBe(false)
  })
})
describe('organizer workbook adapter', () => {
  const parity = sourceAvailable ? it : it.skip

  parity('imports the exact D1-J04 assignment and preserves unaffected ZIP entries', async () => {
    const sourceBytes = new Uint8Array(await readFile(SOURCE_PATH))
    const assignment = await importAssignment(sourceBytes)
    expect(assignment).toMatchObject({ id: ASSIGNMENT.id, judgeId: 'D1-J04', name: JUDGE_NAME, domain: DOMAIN })
    expect(assignment.teams).toEqual(TEAMS)

    const outputBytes = await exportWorkbook(sourceBytes, {
      judge: { ...judge, date: '2026-10-28', generalNotes: 'General note' },
      reviews: {
        [TEAM_IDS[0]]: review(TEAM_IDS[0], [80.1234, 81.2345, 82.3456, 83.4567], 'Yes', { notes: 'Reviewed' }),
        [TEAM_IDS[1]]: review(TEAM_IDS[1], [80, 80, 80, 80]),
        [TEAM_IDS[2]]: review(TEAM_IDS[2], [60, 60, 60, 60]),
      },
    })
    const sourceZip = await JSZip.loadAsync(sourceBytes)
    const outputZip = await JSZip.loadAsync(outputBytes)
    expect(Object.keys(outputZip.files).sort()).toEqual(Object.keys(sourceZip.files).sort())
    for (const name of Object.keys(sourceZip.files)) {
      if (name === SHEET_PATH)
        continue
      expect(Array.from(await outputZip.file(name).async('uint8array'))).toEqual(Array.from(await sourceZip.file(name).async('uint8array')))
    }

    const sourceSheet = await sourceZip.file(SHEET_PATH).async('string')
    const outputSheet = await outputZip.file(SHEET_PATH).async('string')
    expect(outputSheet).toContain('<mergeCells count="20">')
    expect(outputSheet).toContain('<dataValidations>')
    expect(outputSheet).toContain('<hyperlinks>')
    expect(outputSheet).toContain('<drawing r:id="rId11"/>')
    expect(outputSheet).toContain('<legacyDrawing r:id="rId12"/>')
    for (const [reference, oracle] of Object.entries(WORKBOOK_FORMULA_ORACLE)) {
      const before = cellXml(sourceSheet, reference)
      const after = cellXml(outputSheet, reference)
      expect(after).toContain('<f')
      const encodedFormula = oracle.formula.slice(1)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
      expect(after).toContain(encodedFormula)
      expect(after.match(/<f\b[^>]*>/)?.[0]).toBe(before.match(/<f\b[^>]*>/)?.[0])
      expect(after.match(/<f\b[\s\S]*?<\/f>/)?.[0]).toBe(before.match(/<f\b[\s\S]*?<\/f>/)?.[0])
    }
    expect(cellXml(outputSheet, 'B4')).toContain('Muhammad Akmal Alif bin Azam')
    expect(cellXml(outputSheet, 'B5')).toContain('2026-10-28')
    expect(cellXml(outputSheet, 'A37')).toContain('General note')
    expect(cellXml(outputSheet, 'D13')).toContain('Yes')
    expect(cellXml(outputSheet, 'E13')).toContain('<v>80.1234</v>')
    expect(cellXml(outputSheet, 'I13')).toContain('<v>24.03702</v>')
    expect(cellXml(outputSheet, 'M13')).toContain('<v>81.623385</v>')
    expect(cellXml(outputSheet, 'N13')).toContain('<v>1</v>')
    expect(cellXml(outputSheet, 'O13')).toContain('<v>Complete</v>')
    expect(cellXml(outputSheet, 'C28')).toContain('<v>3 / 9</v>')
  })

  parity('retains the blank versus zero distinction and enforces the final gate', async () => {
    const sourceBytes = new Uint8Array(await readFile(SOURCE_PATH))
    const outputBytes = await exportWorkbook(sourceBytes, {
      judge: { ...judge, date: '2026-10-28' },
      reviews: {
        [TEAM_IDS[0]]: review(TEAM_IDS[0], [0, 0, 0, 0]),
      },
    })
    const outputSheet = await sheetXml(outputBytes)
    expect(cellXml(outputSheet, 'E13')).toContain('<v>0</v>')
    expect(cellXml(outputSheet, 'I13')).toContain('<v>0</v>')
    expect(cellXml(outputSheet, 'M13')).toContain('<v>0</v>')
    expect(cellXml(outputSheet, 'O13')).toContain('<v>Complete</v>')
    expect(cellXml(outputSheet, 'E14')).toMatch(/<c\b[^>]*\/>$/)
    expect(cellXml(outputSheet, 'O14')).toContain('<v>Not started</v>')

    const complete = await exportWorkbook(sourceBytes, { judge: { ...judge, date: '2026-10-28' }, reviews: allReviews() }, { final: true })
    expect(cellXml(await sheetXml(complete), 'C33')).toContain('YES — upload via the Google Form')
    await expect(exportWorkbook(sourceBytes, { judge: { ...judge, date: '2026-10-28' }, reviews: { ...allReviews(), [TEAM_IDS[0]]: review(TEAM_IDS[0], [80, 80, 80, 80], 'No – private/broken') } }, { final: true })).rejects.toThrow('not ready')
  })
})
