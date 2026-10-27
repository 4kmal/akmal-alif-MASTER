import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
// @vitest-environment jsdom
import { createApp, nextTick } from 'vue'
import JudgingWorkspace from '../app/components/judging/JudgingWorkspace.vue'
import { ASSIGNMENT, FEATURES } from '../shared/judging/model.mjs'

interface FetchCall { url: string, body?: Record<string, any> }
interface DeferredEvidence { id: string, resolve: (response: Response) => void }

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
  let cloudEvidenceEnvelope: boolean
  let deferredEvidence: boolean
  let evidenceResolvers: DeferredEvidence[]
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
