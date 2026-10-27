import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'

import {
  ASSIGNMENT,
  DEADLINE,
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

const evidenceFixture = {
  id: '0123456789abcdef0123456789abcdef',
  teamId: TEAM_IDS[0],
  snapshotSha: 'a'.repeat(40),
  path: 'README.md',
  kind: 'source',
  sha256: 'b'.repeat(64),
  text: 'x'.repeat(250000),
  lines: 1,
  pages: [{ page: 1, text: '' }],
  coverage: 'Inspected text source; execution and demo behavior unverified',
  createdAt: '2026-10-27T19:25:03.957Z',
}

function intakeFixture(artifactCount = 1, teamIndex = 0, overrides = {}) {
  const team = TEAMS[teamIndex]
  return {
    teamId: team.id,
    repoUrl: team.repoUrl,
    branch: 'main',
    sha: 'a'.repeat(40),
    retrievedAt: '2026-10-27T19:24:12.507Z',
    snapshotPath: 'repos/' + team.id + '/' + 'a'.repeat(40),
    verified: true,
    evidenceIds: [evidenceFixture.id],
    artifacts: Array.from({ length: artifactCount }, (_, index) => ({
      path: 'file-' + index + '.txt',
      size: index,
      sha256: 'b'.repeat(64),
    })),
    links: [{ url: TEAMS[0].repoUrl, kind: 'reference', status: null, parity: 'unverified' }],
    demoParity: 'unverified',
    issues: [],
    declaredDemoCommits: [],
    previousSnapshots: [],
    ...overrides,
  }
}

function allIntakes(overrides = {}) {
  return Object.fromEntries(TEAMS.map((team, index) => [team.id, intakeFixture(1, index, overrides)]))
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

function cellNumber(xml, reference) {
  return Number(cellXml(xml, reference).match(/<v>([\s\S]*?)<\/v>/)[1])
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

    const missingRepo = calculateReviews({ [TEAM_IDS[0]]: review(TEAM_IDS[0], [80, 80, 80, 80], '') })[0]
    expect(missingRepo.status).toBe('Missing repo check')
    expect(missingRepo.total).toBe(80)
    expect(missingRepo.rank).toBe(1)
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

  it('requires acknowledgements for outstanding repository warnings', () => {
    let result = readiness(judge, allReviews('No – private/broken'))
    expect(result.nineReviewed).toBe(true)
    expect(result.reviewWarningsAcknowledged).toBe(false)
    expect(result.ready).toBe(false)

    result = readiness({ ...judge, warningsAcknowledged: true }, allReviews('No – private/broken', { warningsAcknowledged: true }))
    expect(result.reviewWarningsAcknowledged).toBe(true)
    expect(result.ready).toBe(true)
  })

  it('gates supplied intake warnings while allowing acknowledged unverified demos', () => {
    const reviews = allReviews('Yes', { warningsAcknowledged: true })
    const cleanIntakes = allIntakes({
      demoParity: 'match',
      links: [{ url: 'https://example.test/deployment', kind: 'deployment', status: 200, parity: 'match', accessible: true }],
    })
    let result = readiness(judge, reviews, cleanIntakes)
    expect(result.intakesProvided).toBe(true)
    expect(result.intakeComplete).toBe(true)
    expect(result.intakeSnapshotsVerified).toBe(true)
    expect(result.ready).toBe(true)

    const unverifiedSnapshots = allIntakes({
      verified: false,
      demoParity: 'match',
      links: [{ url: 'https://example.test/deployment', kind: 'deployment', status: 200, parity: 'match', accessible: true }],
    })
    result = readiness(judge, reviews, unverifiedSnapshots)
    expect(result.intakeSnapshotsVerified).toBe(false)
    expect(result.ready).toBe(false)
    result = readiness({ ...judge, warningsAcknowledged: true }, reviews, unverifiedSnapshots)
    expect(result.ready).toBe(true)

    const unverifiedDemos = allIntakes()
    result = readiness(judge, reviews, unverifiedDemos)
    expect(result.intakeWarningsAcknowledged).toBe(false)
    expect(result.warningDetails.some(warning => warning.code === 'intake_demo_unverified')).toBe(true)
    expect(result.ready).toBe(false)

    result = readiness({ ...judge, warningsAcknowledged: true }, reviews, unverifiedDemos)
    expect(result.intakeWarningsAcknowledged).toBe(true)
    expect(result.ready).toBe(true)

    const missingIntake = { ...cleanIntakes }
    delete missingIntake[TEAM_IDS[0]]
    result = readiness({ ...judge, warningsAcknowledged: true }, reviews, missingIntake)
    expect(result.intakeComplete).toBe(false)
    expect(result.intakeSnapshotsVerified).toBe(false)
    expect(result.warningDetails.some(warning => warning.code === 'intake_missing')).toBe(true)
    expect(result.ready).toBe(false)
  })

  it('reports source and demo availability mismatches from intake issues and links', () => {
    const reviews = allReviews('Yes', { warningsAcknowledged: true })
    const mismatchedIntakes = allIntakes({
      demoParity: 'mismatch',
      issues: ['source unavailable', 'declared demo commit differs from frozen snapshot'],
      links: [{ url: 'https://example.test/deployment', kind: 'deployment', status: 404, parity: 'mismatch', accessible: false }],
    })
    let result = readiness(judge, reviews, mismatchedIntakes)
    const codes = new Set(result.warningDetails.map(warning => warning.code))
    expect(codes.has('intake_issue')).toBe(true)
    expect(codes.has('intake_source_availability_mismatch')).toBe(true)
    expect(codes.has('intake_demo_availability_mismatch')).toBe(true)
    expect(result.ready).toBe(false)

    result = readiness({ ...judge, warningsAcknowledged: true }, reviews, mismatchedIntakes)
    expect(result.ready).toBe(true)
  })

  it('validates constrained server record keys and bounded evidence/intake payloads', () => {
    expect(DEADLINE).toBe('2026-10-28T00:00:00.000Z')
    expect(validateRecord('judge', judge)).toBe(true)
    expect(validateRecord('review:' + TEAM_IDS[0], review(TEAM_IDS[0]))).toBe(true)
    expect(validateRecord('review:not-a-team', review(TEAM_IDS[0]))).toBe(false)
    expect(validateRecord('evidence:' + evidenceFixture.id, evidenceFixture)).toBe(true)
    expect(validateRecord('evidence:' + evidenceFixture.id, { ...evidenceFixture, text: 'x'.repeat(250001) })).toBe(false)
    expect(validateRecord('evidence:00000000-0000-4000-8000-000000000000', { ...evidenceFixture, id: '00000000-0000-4000-8000-000000000000' })).toBe(true)
    expect(validateRecord('intake:' + TEAM_IDS[0], intakeFixture(1000))).toBe(true)
    expect(validateRecord('intake:' + TEAM_IDS[0], intakeFixture(1001))).toBe(false)
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
    expect(cellNumber(outputSheet, 'I13')).toBeCloseTo(24.03702, 12)
    expect(cellNumber(outputSheet, 'M13')).toBeCloseTo(81.623385, 12)
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

    const missingRepo = await exportWorkbook(sourceBytes, {
      judge: { ...judge, date: '2026-10-28' },
      reviews: { [TEAM_IDS[0]]: review(TEAM_IDS[0], [80, 80, 80, 80], '') },
    })
    expect(cellXml(await sheetXml(missingRepo), 'M13')).toContain('<v>80</v>')
    expect(cellXml(await sheetXml(missingRepo), 'O13')).toContain('<v>Missing repo check</v>')

    const complete = await exportWorkbook(sourceBytes, { judge: { ...judge, date: '2026-10-28' }, reviews: allReviews('Yes', { warningsAcknowledged: true }) }, { final: true })
    expect(cellXml(await sheetXml(complete), 'C33')).toContain('YES — upload via the Google Form')
    await expect(exportWorkbook(sourceBytes, { judge: { ...judge, date: '2026-10-28' }, reviews: { ...allReviews('Yes', { warningsAcknowledged: true }), [TEAM_IDS[0]]: review(TEAM_IDS[0], [80, 80, 80, 80], 'No – private/broken') } }, { final: true })).rejects.toThrow('not ready')

    const cleanIntakes = allIntakes({
      demoParity: 'match',
      links: [{ url: 'https://example.test/deployment', kind: 'deployment', status: 200, parity: 'match', accessible: true }],
    })
    const finalWithIntakes = await exportWorkbook(sourceBytes, {
      judge: { ...judge, date: '2026-10-28' },
      reviews: allReviews('Yes', { warningsAcknowledged: true }),
      intakes: cleanIntakes,
    }, { final: true })
    expect(finalWithIntakes).toBeInstanceOf(Uint8Array)
    await expect(exportWorkbook(sourceBytes, {
      judge: { ...judge, date: '2026-10-28' },
      reviews: allReviews('Yes', { warningsAcknowledged: true }),
      intakes: allIntakes(),
    }, { final: true })).rejects.toThrow('not ready')
  }, 15000)

  parity('accepts actual intake/evidence fields and exports a local fixture workbook', async () => {
    expect(validateRecord('evidence:' + evidenceFixture.id, evidenceFixture)).toBe(true)
    expect(validateRecord('intake:' + TEAM_IDS[0], intakeFixture(330))).toBe(true)
    const sourceBytes = new Uint8Array(await readFile(SOURCE_PATH))
    const outputBytes = await exportWorkbook(sourceBytes, {
      judge: { ...judge, date: '2026-10-28', generalNotes: 'Local fixture export' },
      reviews: { [TEAM_IDS[0]]: review(TEAM_IDS[0], [0, 75, 80, 90], 'Yes', { notes: 'Fixture review' }) },
    })
    expect(outputBytes).toBeInstanceOf(Uint8Array)
    expect(cellXml(await sheetXml(outputBytes), 'P13')).toContain('Fixture review')
  })
})
