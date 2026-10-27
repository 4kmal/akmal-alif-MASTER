import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
// @vitest-environment jsdom
import { createApp, nextTick } from 'vue'
import JudgingWorkspace from '../app/components/judging/JudgingWorkspace.vue'
import { ASSIGNMENT, FEATURES } from '../shared/judging/model.mjs'

interface FetchCall { url: string, body?: Record<string, any> }

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function emptyState(records: any[] = []) {
  return { assignment: ASSIGNMENT, records, serverTime: '2026-10-28T00:00:00.000Z' }
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
    originalFetch = globalThis.fetch
    originalOnline = navigator.onLine
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
      fetchCalls.push({ url, body })
      if (url.endsWith('/state'))
        return jsonResponse(emptyState(stateRecords))
      if (url.endsWith('/sync/status'))
        return jsonResponse({ status: 'unpaired', pending: 0, conflicts: [] })
      if (url.endsWith('/jobs'))
        return jsonResponse({ jobs: jobsPayload })
      if (url.includes('/evidence/')) {
        const evidenceId = decodeURIComponent(url.slice(url.lastIndexOf('/evidence/') + '/evidence/'.length))
        const record = stateRecords.find(item => item.data?.id === evidenceId)
        return jsonResponse(record?.data ?? {}, record ? 200 : 404)
      }
      if (url.endsWith('/records')) {
        if (delayedFirstSave) {
          delayedFirstSave = false
          return new Promise<Response>(resolve => saveResolvers.push(resolve))
        }
        return jsonResponse({ key: body.key, version: 1, data: body.data, updatedAt: '2026-10-28T00:00:01.000Z' })
      }
      if (url.endsWith('/intake'))
        return jsonResponse({})
      return jsonResponse({})
    }) as typeof fetch
  })

  afterEach(() => {
    app?.unmount()
    app = null
    host.remove()
    globalThis.fetch = originalFetch
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: originalOnline })
    vi.useRealTimers()
  })

  function mountLocal() {
    app = createApp(JudgingWorkspace, { apiBase: '/api/local', local: true })
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
    expect(recordCalls[1].body?.mutationId).toBe(recordCalls[0].body?.mutationId)
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
})
