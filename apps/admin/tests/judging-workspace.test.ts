import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  ASSIGNMENT,
  CRITERIA,
  DOMAIN,
  JUDGE_NAME,
  TEAM_IDS,
  calculateReviews,
  emptyReview,
  readiness,
} from '../shared/judging/model.mjs'

const adminRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const workspace = readFileSync(resolve(adminRoot, 'app/components/judging/JudgingWorkspace.vue'), 'utf8')
const localEntry = readFileSync(resolve(adminRoot, '../judging-local/client/main.ts'), 'utf8')
const adminPage = readFileSync(resolve(adminRoot, 'app/pages/admin/judging/sdc-2026.vue'), 'utf8')
const navigation = readFileSync(resolve(adminRoot, 'app/components/dashboard/sidebar/AppSidebar.vue'), 'utf8')
const routeConfig = readFileSync(resolve(adminRoot, 'app/composables/dashboard.ts'), 'utf8')

describe('SDC judging workspace UI contract', () => {
  it('keeps the shared workspace on the durable record and evidence APIs', () => {
    expect(workspace).toContain("apiBase: '/api/admin/judging/sdc-2026'")
    expect(workspace).toContain("const stateEndpoint = `${props.apiBase}/state${stateCursor.value === null ? '' : `?cursor=${stateCursor.value}`}`")
    expect(workspace).toContain("fetch(`${props.apiBase}/records`")
    expect(workspace).toContain("fetch(`${props.apiBase}/evidence/${encodeURIComponent(item.id)}`")
    expect(workspace).toContain("fetch(`${props.apiBase}/sync/status`")
    expect(workspace).toContain("fetch('/api/local/sync/resolve'")
  })

  it('keeps participant material in a safe text viewer', () => {
    expect(workspace).not.toContain('v-html')
    expect(workspace).not.toContain('<iframe')
    expect(workspace).toContain('Rendered as text; participant HTML is never executed.')
    expect(workspace).toContain('source-line')
  })

  it('mounts the same workspace for the local station and admin route', () => {
    expect(localEntry).toContain("apiBase: '/api/local'")
    expect(localEntry).toContain('local: true')
    expect(adminPage).toContain("import JudgingWorkspace from '@/components/judging/JudgingWorkspace.vue'")
    expect(adminPage).toContain("layout: 'dashboard'")
    expect(navigation).toContain("url: '/admin/judging/sdc-2026'")
    expect(routeConfig).toContain("paths: ['/admin/judging/sdc-2026']")
  })

  it('requires explicit reviewed approval before the final review state', () => {
    expect(workspace).toContain('Approve reviewed')
    expect(workspace).toContain('selectedReviewReady')
    expect(workspace).toContain('canApproveReview(selectedReview.value)')
    expect(workspace).toContain('reviewedAt = new Date().toISOString()')
    expect(workspace).toContain('Blank is different from zero.')
    expect(workspace).toContain('AI assessment suggestion')
    expect(workspace).toContain('Use as draft')
  })

  it('uses the canonical official criteria, teams, and six evidence features', () => {
    expect(CRITERIA).toEqual([
      { id: 'innovation', label: 'Innovation & Creativity', weight: 0.3 },
      { id: 'problemSolutionFit', label: 'Problem-Solution Fit', weight: 0.25 },
      { id: 'feasibility', label: 'Feasibility of Build', weight: 0.25 },
      { id: 'clarity', label: 'Clarity of Proposal', weight: 0.2 },
    ])
    expect(ASSIGNMENT.domain).toBe(DOMAIN)
    expect(JUDGE_NAME).toBe('Muhammad Akmal Alif bin Azam')
    expect(workspace).toContain('name: JUDGE_NAME')
    expect(workspace).toContain("todayInTimezone('Asia/Kuala_Lumpur')")
    for (const inventedDomain of ['Domain 1 · Digital fluency', 'Domain 2 · Future skills', 'Domain 3 · Community impact']) expect(workspace).not.toContain(inventedDomain)
    expect(TEAM_IDS).toHaveLength(9)
    for (const feature of ['Profiles', 'Trends', 'Matching', 'Reskilling', 'SDG alignment', 'Scenarios']) expect(workspace).toContain(feature)
    expect(workspace).not.toContain('FALLBACK_FEATURES')
    expect(workspace).not.toContain('Human judgement')
    expect(workspace).not.toContain('Problem framing')
  })

  it('calculates the weighted total and readiness through the shared model', () => {
    const reviews = Object.fromEntries(TEAM_IDS.map(teamId => [teamId, {
      ...emptyReview(teamId),
      scores: [100, 80, 60, 40],
      repoCheck: 'Yes',
      reviewedAt: '2026-10-28T00:00:00.000Z',
    }]))
    const rows = calculateReviews(reviews)
    expect(rows).toHaveLength(9)
    expect(rows[0].total).toBe(73)
    expect(readiness({
      name: 'Judge',
      date: '2026-10-28',
      domain: DOMAIN,
      generalNotes: '',
      warningsAcknowledged: false,
    }, reviews).ready).toBe(true)
    expect(workspace).toContain('calculateReviews(reviewInputMap.value)')
    expect(workspace).toContain('readiness(judgeDraft, reviewInputMap.value, intakeInputMap.value)')
    expect(workspace).not.toContain('score / 10')
  })

  it('surfaces the complete sync state vocabulary and evidence digests', () => {
    for (const status of ['unpaired', 'pending', 'syncing', 'synced', 'offline', 'expired', 'conflict']) expect(workspace).toContain(status)
    expect(workspace).toContain('syncConflicts')
    expect(workspace).toContain('sha256')
    expect(workspace).toContain('snapshotSha')
    expect(workspace).toContain('source lines')
    expect(workspace).toContain('await Promise.all(keys.map(key => saveRecord(key)))')
    expect(workspace).toContain(':disabled="!readinessResult.ready"')
    expect(workspace).toContain("const endpoint = `${props.apiBase}/jobs`")
    expect(workspace).toContain('draft?.proposedScores')
    expect(workspace).toContain('strengths')
    expect(workspace).toContain('concerns')
    expect(workspace).toContain('assessmentNestedCitations')
  })
})
