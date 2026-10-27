import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
// @vitest-environment jsdom
import { createApp, defineComponent, h, nextTick, ref } from 'vue'
import JudgingWorkspace from '../app/components/judging/JudgingWorkspace.vue'
import { ASSIGNMENT, FEATURES, TEAMS } from '../shared/judging/model.mjs'

interface FetchCall { url: string, body?: Record<string, any> }
interface DeferredEvidence { id: string, resolve: (response: Response) => void }

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function emptyState(records: any[] = [], cursor?: number) {
  return { assignment: ASSIGNMENT, records, serverTime: '2026-10-28T00:00:00.000Z', ...(cursor === undefined ? {} : { cursor }) }
}

async function settle() {
  for (let index = 0; index < 8; index += 1) {
    await Promise.resolve()
    await nextTick()
  }
}

function setInput(input: HTMLInputElement, value: string) {
  input.value = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

function nameInput(host: HTMLElement) {
  const input = host.querySelector('input[autocomplete="name"]')
  if (!(input instanceof HTMLInputElement))
    throw new Error('Judge name input is missing')
  return input
}

describe('judgingWorkspace save behavior', () => {
  let host: HTMLDivElement
  let app: ReturnType<typeof createApp> | null = null
  let fetchCalls: FetchCall[]
  let saveResolvers: Array<(response: Response) => void>
  let delayedFirstSave: boolean
  let stateRecords: any[]
  let jobsPayload: any[]
  let cloudEvidenceEnvelope: boolean
  let deferredEvidence: boolean
  let evidenceResolvers: DeferredEvidence[]
  let syncStatusPayload: Record<string, any>
  let pairErrorEnvelope: boolean
  let conflictEnvelope: boolean
  let cursorAheadRecovery: boolean
  let stateCursorIssued: boolean
  let stateCursorValue: number | undefined
  let deferStateResponses: boolean
  let stateResponseResolvers: Array<(response: Response) => void>
  let exportFailure: boolean
  let originalFetch: typeof fetch
  let originalOnline: boolean

  beforeEach(() => {
    vi.useFakeTimers()
    localStorage.clear()
    host = document.createElement('div')
    document.body.append(host)
    fetchCalls = []
    saveResolvers = []
    delayedFirstSave = true
    stateRecords = []
    jobsPayload = []
    cloudEvidenceEnvelope = false
    deferredEvidence = false
    evidenceResolvers = []
    syncStatusPayload = { status: 'unpaired', pending: 0, conflicts: [] }
    pairErrorEnvelope = false
    conflictEnvelope = false
    cursorAheadRecovery = false
    stateCursorIssued = false
    stateCursorValue = undefined
    deferStateResponses = false
    stateResponseResolvers = []
    exportFailure = false
    vi.stubGlobal('URL', class extends URL {
      static createObjectURL = vi.fn(() => 'blob:judging-workbook')
      static revokeObjectURL = vi.fn()
    })
    originalFetch = globalThis.fetch
    originalOnline = navigator.onLine
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
      fetchCalls.push({ url, body })
      const parsedUrl = new URL(url, 'http://localhost')
      if (parsedUrl.pathname.endsWith('/state')) {
        if (cursorAheadRecovery && parsedUrl.searchParams.has('cursor'))
          return jsonResponse({ error: 'Judging state cursor is ahead of the server' }, 400)
        if (cursorAheadRecovery && !stateCursorIssued) {
          stateCursorIssued = true
          return jsonResponse(emptyState(stateRecords, 7))
        }
        const response = jsonResponse(emptyState(stateRecords, cursorAheadRecovery ? 8 : stateCursorValue))
        if (deferStateResponses)
          return new Promise<Response>(resolve => stateResponseResolvers.push(resolve))
        return response
      }
      if (url.endsWith('/sync/status'))
        return jsonResponse(syncStatusPayload)
      if (url.endsWith('/jobs'))
        return jsonResponse({ jobs: jobsPayload })
      if (parsedUrl.pathname.endsWith('/exports')) {
        if (exportFailure)
          return jsonResponse({ statusMessage: 'A review changed; refresh before exporting.' }, 409)
        return new Response(new Uint8Array([80, 75, 3, 4]), {
          headers: { 'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
        })
      }
      if (url.endsWith('/devices'))
        return jsonResponse({ devices: [{ id: 'device-1', name: 'Review station', expiresAt: '2026-10-29T00:00:00.000Z' }] })
      if (url.includes('/devices/'))
        return jsonResponse({ id: 'device-1', revokedAt: '2026-10-28T00:00:00.000Z' })
      if (url.includes('/evidence/')) {
        const evidenceId = decodeURIComponent(url.slice(url.lastIndexOf('/evidence/') + '/evidence/'.length))
        const record = stateRecords.find(item => item.data?.id === evidenceId)
        if (deferredEvidence)
          return new Promise<Response>(resolve => evidenceResolvers.push({ id: evidenceId, resolve }))
        if (cloudEvidenceEnvelope && record) {
          const metadata = Object.fromEntries(Object.entries(record.data).filter(([key]) => key !== 'text' && key !== 'pages'))
          return jsonResponse({ evidence: metadata, text: record.data.text ?? '', pages: record.data.pages })
        }
        return jsonResponse(record?.data ?? {}, record ? 200 : 404)
      }
      if (url.endsWith('/records')) {
        if (delayedFirstSave) {
          delayedFirstSave = false
          return new Promise<Response>(resolve => saveResolvers.push(resolve))
        }
        if (conflictEnvelope) {
          conflictEnvelope = false
          return jsonResponse({
            statusCode: 409,
            statusMessage: 'Record version conflict',
            data: {
              current: {
                key: body.key,
                version: Number(body.baseVersion ?? 0) + 1,
                data: body.data,
                updatedAt: '2026-10-28T00:00:02.000Z',
              },
            },
          }, 409)
        }
        return jsonResponse({ key: body.key, version: Number(body.baseVersion ?? 0) + 1, data: body.data, updatedAt: '2026-10-28T00:00:01.000Z' })
      }
      if (url.endsWith('/pair'))
        return pairErrorEnvelope ? jsonResponse({ error: 'Pair code rejected' }, 400) : jsonResponse({})
      if (url.endsWith('/intake'))
        return jsonResponse({})
      return jsonResponse({})
    }) as typeof fetch
  })

  afterEach(() => {
    app?.unmount()
    app = null
    host.remove()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    globalThis.fetch = originalFetch
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: originalOnline })
    vi.useRealTimers()
  })

  function mountLocal() {
    app = createApp(JudgingWorkspace, { apiBase: '/api/local', local: true })
    app.mount(host)
  }

  function mountAdmin() {
    app = createApp(JudgingWorkspace, { apiBase: '/api/admin/judging/sdc-2026', local: false })
    app.mount(host)
  }

  it('keeps a newer edit visible while a delayed acknowledgement is in flight', async () => {
    mountLocal()
    await settle()

    const input = nameInput(host)
    setInput(input, 'First edit')
    await nextTick()
    await vi.advanceTimersByTimeAsync(2_000)
    await settle()
    expect(fetchCalls.filter(call => call.url.endsWith('/records'))).toHaveLength(1)

    setInput(input, 'Second edit')
    await nextTick()
    saveResolvers.shift()?.(jsonResponse({
      key: 'judge',
      version: 1,
      data: { name: 'First edit', date: '2026-10-28', domain: ASSIGNMENT.domain, generalNotes: '', warningsAcknowledged: false },
      updatedAt: '2026-10-28T00:00:01.000Z',
    }))
    await settle()
    expect(input.value).toBe('Second edit')

    await vi.advanceTimersByTimeAsync(2_000)
    await settle()
    const recordCalls = fetchCalls.filter(call => call.url.endsWith('/records'))
    expect(recordCalls).toHaveLength(2)
    expect(recordCalls[1].body?.data?.name).toBe('Second edit')
    expect(recordCalls[1].body?.mutationId).not.toBe(recordCalls[0].body?.mutationId)
  })

  it('serializes overlapping state refreshes and keeps a newer save over a delayed older response', async () => {
    delayedFirstSave = false
    stateCursorValue = 1
    stateRecords = [{
      key: 'judge',
      version: 1,
      data: { name: 'Initial judge', date: '2026-10-28', domain: ASSIGNMENT.domain, generalNotes: '', warningsAcknowledged: false },
      updatedAt: '2026-10-28T00:00:01.000Z',
    }]
    mountAdmin()
    await settle()

    deferStateResponses = true
    const refresh = host.querySelector<HTMLButtonElement>('button[aria-label="Refresh judging state"]')
    refresh?.click()
    await nextTick()
    refresh?.click()
    window.dispatchEvent(new Event('online'))
    await nextTick()
    expect(fetchCalls.filter(call => new URL(call.url, 'http://localhost').pathname.endsWith('/state'))).toHaveLength(2)
    expect(stateResponseResolvers).toHaveLength(1)

    const input = nameInput(host)
    setInput(input, 'Newer saved judge')
    await nextTick()
    await vi.advanceTimersByTimeAsync(2_000)
    await settle()
    expect(fetchCalls.filter(call => call.url.endsWith('/records'))).toHaveLength(1)

    stateResponseResolvers.shift()?.(jsonResponse(emptyState([{
      key: 'judge',
      version: 1,
      data: { name: 'Older poll response', date: '2026-10-28', domain: ASSIGNMENT.domain, generalNotes: '', warningsAcknowledged: false },
      updatedAt: '2026-10-28T00:00:01.000Z',
    }], 2)))
    await settle()

    expect(input.value).toBe('Newer saved judge')
    expect(fetchCalls.filter(call => new URL(call.url, 'http://localhost').pathname.endsWith('/state'))).toHaveLength(2)
  })

  it('ignores an old state response when the workspace api base changes', async () => {
    stateCursorValue = 1
    stateRecords = [{
      key: 'judge',
      version: 1,
      data: { name: 'Initial judge', date: '2026-10-28', domain: ASSIGNMENT.domain, generalNotes: '', warningsAcknowledged: false },
      updatedAt: '2026-10-28T00:00:01.000Z',
    }]
    const apiBase = ref('/api/admin/judging/sdc-2026')
    const Wrapper = defineComponent({
      setup: () => () => h(JudgingWorkspace, { apiBase: apiBase.value, local: false }),
    })
    app = createApp(Wrapper)
    app.mount(host)
    await settle()

    deferStateResponses = true
    host.querySelector<HTMLButtonElement>('button[aria-label="Refresh judging state"]')?.click()
    await nextTick()
    expect(stateResponseResolvers).toHaveLength(1)

    apiBase.value = '/api/admin/judging/other'
    await nextTick()
    await settle()
    expect(stateResponseResolvers).toHaveLength(2)

    stateResponseResolvers.shift()?.(jsonResponse(emptyState([{
      key: 'judge',
      version: 2,
      data: { name: 'Stale old base', date: '2026-10-28', domain: ASSIGNMENT.domain, generalNotes: '', warningsAcknowledged: false },
      updatedAt: '2026-10-28T00:00:02.000Z',
    }], 2)))
    stateResponseResolvers.shift()?.(jsonResponse(emptyState([{
      key: 'judge',
      version: 2,
      data: { name: 'Current base', date: '2026-10-28', domain: ASSIGNMENT.domain, generalNotes: '', warningsAcknowledged: false },
      updatedAt: '2026-10-28T00:00:03.000Z',
    }], 3)))
    await settle()

    expect(nameInput(host).value).toBe('Current base')
    expect(fetchCalls.filter(call => new URL(call.url, 'http://localhost').pathname.endsWith('/state')).map(call => call.url)).toEqual([
      '/api/admin/judging/sdc-2026/state',
      '/api/admin/judging/sdc-2026/state?cursor=1',
      '/api/admin/judging/other/state',
    ])
  })

  it('ignores a deferred state response after the workspace unmounts', async () => {
    mountAdmin()
    await settle()
    deferStateResponses = true
    host.querySelector<HTMLButtonElement>('button[aria-label="Refresh judging state"]')?.click()
    await nextTick()
    expect(stateResponseResolvers).toHaveLength(1)
    const requestsBeforeUnmount = fetchCalls.length
    app?.unmount()
    app = null

    stateResponseResolvers.shift()?.(jsonResponse(emptyState([{ key: 'judge', version: 1, data: { name: 'Late response' } }], 2)))
    await settle()

    expect(fetchCalls.slice(requestsBeforeUnmount).some(call => call.url.endsWith('/sync/status'))).toBe(false)
  })

  it('retries a lost acknowledgement identically before sending the newer draft with a fresh mutation', async () => {
    delayedFirstSave = false
    let unknownOutcome = true
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
      fetchCalls.push({ url, body })
      if (url.includes('/state'))
        return jsonResponse(emptyState(stateRecords))
      if (url.endsWith('/sync/status'))
        return jsonResponse(syncStatusPayload)
      if (url.endsWith('/records')) {
        if (unknownOutcome) {
          unknownOutcome = false
          throw new TypeError('network disconnected after request')
        }
        const version = fetchCalls.filter(call => call.url.endsWith('/records')).length
        return jsonResponse({ key: body.key, version, data: body.data, updatedAt: `2026-10-28T00:00:0${version}.000Z` })
      }
      return jsonResponse({})
    }) as typeof fetch

    mountLocal()
    await settle()
    const input = nameInput(host)
    setInput(input, 'First payload')
    await nextTick()
    await vi.advanceTimersByTimeAsync(2_000)
    await settle()
    const persistedAfterLostAck = JSON.parse(localStorage.getItem('sdc-judging-drafts-v1') ?? '{}').judge
    expect(persistedAfterLostAck.pendingMutationId).toBeTruthy()
    expect(persistedAfterLostAck.pendingData.name).toBe('First payload')

    setInput(input, 'Newer visible draft')
    await nextTick()
    await vi.advanceTimersByTimeAsync(2_000)
    await settle()

    const recordCalls = fetchCalls.filter(call => call.url.endsWith('/records'))
    expect(recordCalls).toHaveLength(2)
    expect(recordCalls[1].body?.data?.name).toBe('First payload')
    expect(recordCalls[1].body?.baseVersion).toBe(recordCalls[0].body?.baseVersion)
    expect(recordCalls[1].body?.data).toEqual(recordCalls[0].body?.data)
    expect(recordCalls[1].body?.mutationId).toBe(recordCalls[0].body?.mutationId)

    await vi.advanceTimersByTimeAsync(2_000)
    await settle()
    const finalRecordCalls = fetchCalls.filter(call => call.url.endsWith('/records'))
    expect(finalRecordCalls).toHaveLength(3)
    expect(finalRecordCalls[2].body?.data?.name).toBe('Newer visible draft')
    expect(finalRecordCalls[2].body?.mutationId).not.toBe(finalRecordCalls[1].body?.mutationId)
    expect(input.value).toBe('Newer visible draft')
    expect(JSON.parse(localStorage.getItem('sdc-judging-drafts-v1') ?? '{}').judge).toBeUndefined()
  })

  it('posts local autosaves while the browser reports offline', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
    mountLocal()
    await settle()

    const input = nameInput(host)
    setInput(input, 'Offline edit')
    await nextTick()
    await vi.advanceTimersByTimeAsync(2_000)
    await settle()
    expect(fetchCalls.filter(call => call.url.endsWith('/records'))).toHaveLength(1)
    expect(fetchCalls.find(call => call.url.endsWith('/records'))?.body?.data?.name).toBe('Offline edit')
  })

  it('recovers an offline owner edit after remount without attempting an unauthenticated save', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
    mountAdmin()
    await settle()
    setInput(nameInput(host), 'Offline owner edit')
    await nextTick()
    await vi.advanceTimersByTimeAsync(2_000)
    await settle()
    expect(JSON.parse(localStorage.getItem('sdc-judging-drafts-v1') ?? '{}').judge.data.name).toBe('Offline owner edit')
    app?.unmount()
    app = null
    host.innerHTML = ''
    mountAdmin()
    await settle()
    expect(nameInput(host).value).toBe('Offline owner edit')
    expect(fetchCalls.some(call => call.url.endsWith('/records'))).toBe(false)
  })

  it('keeps raw decimal scores for persistence while displaying the weighted total to one decimal', async () => {
    delayedFirstSave = false
    mountLocal()
    await settle()

    const scores = [80.25, 70, 60, 50]
    const labels = ['Innovation & Creativity', 'Problem-Solution Fit', 'Feasibility of Build', 'Clarity of Proposal']
    labels.forEach((label, index) => {
      const input = host.querySelector<HTMLInputElement>(`input[aria-label="${label} score out of 100"]`)
      expect(input).toBeTruthy()
      setInput(input!, String(scores[index]))
    })
    await nextTick()

    const firstInput = host.querySelector<HTMLInputElement>('input[aria-label="Innovation & Creativity score out of 100"]')
    expect(firstInput?.value).toBe('80.25')
    expect(host.textContent).toContain('66.6/100')

    await vi.advanceTimersByTimeAsync(2_000)
    await settle()
    const reviewCall = fetchCalls.find(call => call.url.endsWith('/records') && call.body?.key === 'review:01-console')
    expect(reviewCall?.body?.data?.scores).toEqual(scores)
  })

  it('renders the canonical four-criterion rubric and separate six-feature checks', async () => {
    mountLocal()
    await settle()

    const text = host.textContent ?? ''
    expect(text).toContain('Innovation & Creativity')
    expect(text).toContain('Problem-Solution Fit')
    expect(text).toContain('Feasibility of Build')
    expect(text).toContain('Clarity of Proposal')
    expect(text).toContain('Rubric heatmap')
    expect(text).toContain('Six feature checks')
    expect(text).toContain('Profiles')
    expect(text).toContain('Scenarios')
    expect(text).not.toContain('Digital fluency')
  })

  it('keeps stale AI jobs visible but blocks draft use and offers regeneration', async () => {
    jobsPayload = [{
      id: 'stale-job-1',
      teamId: '01-console',
      status: 'completed',
      stale: true,
      progress: 100,
      updatedAt: '2026-10-28T00:00:05.000Z',
      draft: {
        proposedScores: [80, 70, 60, 50].map((score, index) => ({ criterion: ['innovation', 'problemSolutionFit', 'feasibility', 'clarity'][index], score })),
        strengths: [{ text: 'Evidence-linked strength', citations: [] }],
        features: FEATURES.map((feature, index) => index === 0
          ? ({ feature: feature.id, status: 'present', note: 'Legacy status shape', citations: [] })
          : ({ feature: feature.id, proposal: 'present', demo: 'unverified', note: 'Text evidence only', citations: [] })),
      },
    }]
    mountLocal()
    await settle()

    expect(host.textContent).toContain('Stale draft · regenerate before use')
    expect(host.textContent).toContain('This result is stale. Regenerate the assessment before using it as a draft.')
    expect(host.textContent).toContain('Regenerate')
    const useDraft = [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.includes('Stale · regenerate'))
    expect(useDraft?.disabled).toBe(true)
    expect(host.textContent).toContain('Finding present · proposal present')
    expect(host.textContent).toContain('Profiles')
    expect(host.textContent).toContain('SDG alignment')
  })

  it('orders evidence with README first and keeps the read item visible while searching', async () => {
    stateRecords = [
      { key: 'evidence:source', version: 1, data: { id: 'source', teamId: '01-console', title: 'src/app.ts', path: 'src/app.ts', kind: 'source', text: 'source line' } },
      { key: 'evidence:readme', version: 1, data: { id: 'readme', teamId: '01-console', title: 'README.md', path: 'README.md', kind: 'document', text: 'readme line' } },
      { key: 'evidence:proposal', version: 1, data: { id: 'proposal', teamId: '01-console', title: 'Pitch deck.pdf', path: 'docs/pitch-deck.pdf', kind: 'document', text: 'proposal line' } },
    ]
    mountLocal()
    await settle()

    const evidenceButtons = () => [...host.querySelectorAll<HTMLButtonElement>('.evidence-item')]
    expect(evidenceButtons().map(button => button.querySelector('strong')?.textContent)).toEqual(['README.md', 'Pitch deck.pdf', 'src/app.ts'])

    const readme = evidenceButtons()[0]
    readme.click()
    await settle()
    const search = host.querySelector<HTMLInputElement>('input[aria-label="Search current team evidence"]')
    expect(search).toBeTruthy()
    setInput(search!, 'src/app')
    await nextTick()
    expect(host.textContent).toContain('1 of 3 evidence records')
    expect(evidenceButtons().map(button => button.querySelector('strong')?.textContent)).toEqual(['src/app.ts', 'README.md'])
    expect(host.textContent).toContain('selected')

    const clear = host.querySelector<HTMLButtonElement>('button[aria-label="Clear evidence search"]')
    expect(clear).toBeTruthy()
    clear?.click()
    await nextTick()
    expect(evidenceButtons().map(button => button.querySelector('strong')?.textContent)).toEqual(['README.md', 'Pitch deck.pdf', 'src/app.ts'])
  })

  it('unwraps cloud evidence envelopes while preserving metadata, text, and pages', async () => {
    cloudEvidenceEnvelope = true
    stateRecords = [{
      key: 'evidence:cloud-readme',
      version: 1,
      data: {
        id: 'cloud-readme',
        teamId: '01-console',
        title: 'README.md',
        kind: 'document',
        path: 'README.md',
        text: 'cloud README text',
        pages: [{ page: 3, text: 'Cloud page three' }],
      },
    }]
    mountAdmin()
    await settle()

    host.querySelector<HTMLButtonElement>('.evidence-item')?.click()
    await settle()
    expect(host.querySelector('.reader-header h3')?.textContent).toContain('README.md')
    expect(host.querySelector('.reader-header p')?.textContent).toContain('README.md')
    expect(host.querySelector('.source-reader')?.textContent).toContain('cloud README text')
    expect(host.querySelector('.pdf-pages')?.textContent).toContain('Page 3')
  })

  it('ignores a late evidence response after selecting a newer record', async () => {
    deferredEvidence = true
    stateRecords = [
      { key: 'evidence:first', version: 1, data: { id: 'first', teamId: '01-console', title: 'first.ts', path: 'first.ts', kind: 'source', text: '' } },
      { key: 'evidence:second', version: 1, data: { id: 'second', teamId: '01-console', title: 'second.ts', path: 'second.ts', kind: 'source', text: '' } },
    ]
    mountLocal()
    await settle()

    const buttons = [...host.querySelectorAll<HTMLButtonElement>('.evidence-item')]
    const first = buttons.find(button => button.textContent?.includes('first.ts'))
    const second = buttons.find(button => button.textContent?.includes('second.ts'))
    expect(first).toBeTruthy()
    expect(second).toBeTruthy()
    first?.click()
    second?.click()

    const secondRequest = evidenceResolvers.find(request => request.id === 'second')
    const firstRequest = evidenceResolvers.find(request => request.id === 'first')
    expect(secondRequest).toBeTruthy()
    expect(firstRequest).toBeTruthy()
    secondRequest?.resolve(jsonResponse({ evidence: { id: 'second', teamId: '01-console', title: 'second.ts', kind: 'source', path: 'second.ts' }, text: 'second remote text' }))
    await settle()
    firstRequest?.resolve(jsonResponse({ evidence: { id: 'first', teamId: '01-console', title: 'first.ts', kind: 'source', path: 'first.ts' }, text: 'first remote text' }))
    await settle()

    expect(host.querySelector('.reader-header h3')?.textContent).toContain('second.ts')
    expect(host.querySelector('.source-reader')?.textContent).toContain('second remote text')
    expect(host.querySelector('.source-reader')?.textContent).not.toContain('first remote text')
  })

  it('keeps intake accessibility, HTTP, and demo parity metadata visible', async () => {
    stateRecords = [{
      key: 'intake:01-console',
      version: 1,
      data: {
        teamId: '01-console',
        repoSHA: 'abc123',
        branch: 'main',
        retrievedAt: '2026-10-28T00:00:00.000Z',
        snapshotPath: 'snapshots/01-console',
        verified: true,
        demoParity: 'mismatch',
        links: [{
          url: 'https://demo.example.test',
          kind: 'deployment',
          status: 403,
          accessible: false,
          parity: 'mismatch',
          error: 'Access denied',
          finalUrl: 'https://demo.example.test/login',
          checkedAt: '2026-10-28T00:00:01.000Z',
        }],
      },
    }]
    mountLocal()
    await settle()

    expect(host.textContent).toContain('Demo parity · mismatch')
    expect(host.textContent).toContain('Blocked · HTTP 403 · demo mismatch · Access denied')
    expect(host.textContent).toContain('resolved https://demo.example.test/login')
  })

  it('requires an explicit choice for nested server conflicts', async () => {
    delayedFirstSave = false
    conflictEnvelope = true
    stateRecords = [{
      key: 'review:01-console',
      version: 1,
      data: {
        teamId: '01-console',
        scores: [null, null, null, null],
        repoCheck: '',
        notes: '',
        reviewedAt: null,
        features: FEATURES.map(() => ({ proposal: 'unverified', demo: 'unverified', note: '' })),
        warningsAcknowledged: false,
      },
    }]
    mountLocal()
    await settle()
    const score = host.querySelector<HTMLInputElement>('input[aria-label="Innovation & Creativity score out of 100"]')
    expect(score).toBeTruthy()
    score?.focus()
    setInput(score!, '80')
    await nextTick()
    await vi.advanceTimersByTimeAsync(2_000)
    await settle()

    const dialog = host.querySelector<HTMLElement>('[role="dialog"]')
    expect(dialog).toBeTruthy()
    expect(host.querySelector('button[aria-label="Close conflict dialog"]')).toBeNull()
    await nextTick()
    expect(document.activeElement).toBe(dialog)
    const choices = [...dialog!.querySelectorAll<HTMLButtonElement>('button')]
    expect(choices).toHaveLength(2)
    choices[0]?.focus()
    choices[0]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
    expect(document.activeElement).toBe(choices[1])
    choices[1]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
    expect(document.activeElement).toBe(choices[0])
    choices[0]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }))
    expect(document.activeElement).toBe(choices[1])
    dialog?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await nextTick()
    expect(host.querySelector('[role="dialog"]')).toBeTruthy()
    choices[1]?.click()
    await settle()
    expect(document.activeElement).toBe(score)
  })

  it('persists a captured evidence link in timestamped notes without approving marks', async () => {
    delayedFirstSave = false
    mountLocal()
    await settle()
    const input = host.querySelector<HTMLInputElement>('.submission-form input')!
    setInput(input, 'https://example.org/demo')
    await nextTick()
    host.querySelector('form.submission-form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await vi.advanceTimersByTimeAsync(2_000)
    await settle()
    const reviewSave = fetchCalls.find(call => call.body?.key === 'review:01-console')
    expect(reviewSave?.body?.data.notes).toMatch(/\[.+\] Evidence: https:\/\/example\.org\/demo/)
    expect(reviewSave?.body?.data.reviewedAt).toBeNull()
    expect(reviewSave?.body?.data.scores).toEqual([null, null, null, null])
    expect(input.value).toBe('')
  })

  it('refreshes AI jobs every ten seconds and immediately after visible online recovery', async () => {
    mountAdmin()
    await settle()
    const jobReads = () => fetchCalls.filter(call => call.url.endsWith('/jobs')).length
    expect(jobReads()).toBe(1)
    await vi.advanceTimersByTimeAsync(10_000)
    await settle()
    expect(jobReads()).toBe(2)
    window.dispatchEvent(new Event('offline'))
    await vi.advanceTimersByTimeAsync(10_000)
    await settle()
    expect(jobReads()).toBe(2)
    window.dispatchEvent(new Event('online'))
    await settle()
    expect(jobReads()).toBe(3)
    document.dispatchEvent(new Event('visibilitychange'))
    await settle()
    expect(jobReads()).toBe(4)
  })

  it('resets an ahead cursor and performs one full state fetch', async () => {
    cursorAheadRecovery = true
    mountAdmin()
    await settle()
    const stateReads = () => fetchCalls.filter(call => new URL(call.url, 'http://localhost').pathname.endsWith('/state'))
    expect(stateReads()).toHaveLength(1)

    host.querySelector<HTMLButtonElement>('button[aria-label="Refresh judging state"]')?.click()
    await settle()

    const stateUrls = stateReads().map(call => call.url)
    expect(stateUrls).toHaveLength(3)
    expect(stateUrls[1]).toContain('?cursor=7')
    expect(stateUrls[2]).not.toContain('?cursor=')
  })

  it('shows local credential failures and uses the error envelope for pairing', async () => {
    syncStatusPayload = { status: 'failed', pending: 1, error: 'Device credential could not be read', conflicts: [] }
    pairErrorEnvelope = true
    mountLocal()
    await settle()
    await nextTick()
    await settle()

    expect(host.textContent).toContain('Sync error · Device credential could not be read')
    const pairInput = host.querySelector<HTMLInputElement>('input[autocomplete="one-time-code"]')
    expect(pairInput).toBeTruthy()
    setInput(pairInput!, '123456')
    await nextTick()
    host.querySelector<HTMLFormElement>('form.pair-form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await settle()
    expect(host.textContent).toContain('Pair code rejected')
  })

  it('does not request the owner-only sync status route', async () => {
    mountAdmin()
    await settle()
    expect(fetchCalls.some(call => call.url.endsWith('/sync/status'))).toBe(false)
  })

  it('downloads a successful workbook response and releases its object URL', async () => {
    delayedFirstSave = false
    mountLocal()
    await settle()
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const append = vi.spyOn(document.body, 'appendChild')
    const draft = [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.includes('Draft XLSX'))
    expect(draft).toBeTruthy()
    draft?.click()
    await settle()

    const anchor = append.mock.calls.map(call => call[0]).find(element => element instanceof HTMLAnchorElement) as HTMLAnchorElement | undefined
    expect(click).toHaveBeenCalled()
    expect(fetchCalls.some(call => call.url === '/api/local/exports?final=0')).toBe(true)
    expect(anchor?.getAttribute('href')).toBe('blob:judging-workbook')
    expect(anchor?.download).toBe('SDC-D1-J04-draft.xlsx')
    await vi.advanceTimersByTimeAsync(1_000)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:judging-workbook')
  })

  it('claims the export lock while dirty records flush and starts only one workbook request', async () => {
    mountLocal()
    await settle()
    setInput(nameInput(host), 'Export lock edit')
    await nextTick()
    await vi.advanceTimersByTimeAsync(2_000)
    await settle()
    expect(saveResolvers).toHaveLength(1)

    const draft = [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.includes('Draft XLSX'))
    expect(draft).toBeTruthy()
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    draft?.click()
    draft?.click()
    await nextTick()
    expect(draft?.disabled).toBe(true)

    saveResolvers.shift()?.(jsonResponse({
      key: 'judge',
      version: 1,
      data: { name: 'Export lock edit', date: '2026-10-28', domain: ASSIGNMENT.domain, generalNotes: '', warningsAcknowledged: false },
      updatedAt: '2026-10-28T00:00:01.000Z',
    }))
    await settle()
    await settle()

    expect(fetchCalls.filter(call => call.url === '/api/local/exports?final=0')).toHaveLength(1)
    expect(click).toHaveBeenCalledTimes(1)
  })

  it('keeps the dashboard open and displays an export rejection', async () => {
    exportFailure = true
    mountAdmin()
    await settle()
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const draft = [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.includes('Draft XLSX'))
    draft?.click()
    await settle()
    expect(click).not.toHaveBeenCalled()
    expect(host.textContent).toContain('A review changed; refresh before exporting.')
  })

  it('keeps final export locked when all reviews are complete but no snapshots exist', async () => {
    stateRecords = [
      { key: 'judge', version: 1, data: { name: ASSIGNMENT.judgeName, date: '2026-10-28', domain: ASSIGNMENT.domain, generalNotes: '', warningsAcknowledged: true } },
      ...TEAMS.map(team => ({ key: `review:${team.id}`, version: 1, data: { teamId: team.id, scores: [80, 80, 80, 80], repoCheck: 'Yes', notes: '', reviewedAt: '2026-10-28T00:00:00.000Z', warningsAcknowledged: true } })),
    ]
    mountAdmin()
    await settle()
    const final = [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.includes('Final XLSX'))
    expect(final?.disabled).toBe(true)
    expect(host.textContent).toContain('no intake record')
  })

  it('uses the owner DELETE device route when revoking a station', async () => {
    mountAdmin()
    await settle()
    const device = [...host.querySelectorAll<HTMLButtonElement>('.device-list button')].find(button => button.textContent?.includes('Revoke'))
    expect(device).toBeTruthy()
    device?.click()
    await settle()
    const revoke = fetchCalls.find(call => call.url.includes('/devices/') && !call.url.endsWith('/devices'))
    expect(revoke?.url).toMatch(/\/devices\/[^/]+$/)
  })

  it('shows provider failures and retries through the supported local assessment route', async () => {
    jobsPayload = [{ id: 'failed-job-1', teamId: '01-console', status: 'failed', progress: 100, error: 'Provider request timed out' }]
    mountLocal()
    await settle()
    expect(host.querySelector('.job-list')?.textContent).toContain('Provider request timed out')
    const retry = [...host.querySelectorAll<HTMLButtonElement>('.job-list button')].find(button => button.textContent?.trim() === 'Retry')
    expect(retry).toBeTruthy()
    retry?.click()
    await settle()
    expect(fetchCalls.find(call => call.url === '/api/local/assessments')?.body).toEqual({ teamId: '01-console', retryJobId: 'failed-job-1' })
    expect(fetchCalls.some(call => call.url.endsWith('/assessments/jobs'))).toBe(false)
  })

  it('keeps the latest attempt in the queue and preserves earlier attempts in a collapsed history', async () => {
    jobsPayload = [
      { id: 'current-job', teamId: '01-console', status: 'running', progress: 50 },
      { id: 'earlier-job', teamId: '01-console', status: 'failed', progress: 100, error: 'Earlier provider failure' },
    ]
    mountAdmin()
    await settle()
    expect(host.querySelectorAll('.job-list .job-row')).toHaveLength(1)
    expect(host.querySelector('.job-list')?.textContent).toContain('running')
    const history = host.querySelector<HTMLDetailsElement>('details.assessment-history')
    expect(history?.open).toBe(false)
    expect(history?.textContent).toContain('Earlier provider failure')
    expect(history?.querySelector('summary')?.textContent).toContain('Earlier attempts (1)')
  })

  it('exposes workbench tabs with roving focus and Home/End keyboard navigation', async () => {
    mountLocal()
    await settle()

    const tabList = host.querySelector('[role="tablist"]')
    const tabs = [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
    expect(tabList).toBeTruthy()
    expect(tabs).toHaveLength(3)
    expect(tabs[0]?.getAttribute('aria-selected')).toBe('true')
    expect(tabs[0]?.tabIndex).toBe(0)
    expect(tabs[1]?.tabIndex).toBe(-1)
    expect(host.querySelector('#workbench-panel-queue[role="tabpanel"]')).toBeTruthy()
    expect(tabs[0]?.getAttribute('aria-controls')).toBe('workbench-panel-queue')

    tabs[0]?.focus()
    tabs[0]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    await nextTick()
    expect(tabs[1]?.getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(tabs[1])

    tabs[1]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }))
    await nextTick()
    expect(tabs[2]?.getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(tabs[2])

    tabs[2]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }))
    await nextTick()
    expect(tabs[0]?.getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(tabs[0])
  })
})
