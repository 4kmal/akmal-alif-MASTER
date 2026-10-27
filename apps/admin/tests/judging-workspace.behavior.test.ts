// @vitest-environment jsdom
import { createApp, nextTick } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import JudgingWorkspace from '../app/components/judging/JudgingWorkspace.vue'
import { ASSIGNMENT } from '../shared/judging/model.mjs'

type FetchCall = { url: string, body?: Record<string, any> }

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json' },
})

function emptyState() {
  return { assignment: ASSIGNMENT, records: [], serverTime: '2026-10-28T00:00:00.000Z' }
}

async function settle() {
  await Promise.resolve()
  await nextTick()
  await Promise.resolve()
  await nextTick()
}

function setInput(input: HTMLInputElement, value: string) {
  input.value = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

function nameInput(host: HTMLElement) {
  const input = host.querySelector('input[autocomplete="name"]')
  if (!(input instanceof HTMLInputElement)) throw new Error('Judge name input is missing')
  return input
}

describe('JudgingWorkspace save behavior', () => {
  let host: HTMLDivElement
  let app: ReturnType<typeof createApp> | null = null
  let fetchCalls: FetchCall[]
  let saveResolvers: Array<(response: Response) => void>
  let delayedFirstSave: boolean
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
    originalFetch = globalThis.fetch
    originalOnline = navigator.onLine
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
      fetchCalls.push({ url, body })
      if (url.endsWith('/state')) return jsonResponse(emptyState())
      if (url.endsWith('/sync/status')) return jsonResponse({ status: 'unpaired', pending: 0, conflicts: [] })
      if (url.endsWith('/jobs')) return jsonResponse({ jobs: [] })
      if (url.endsWith('/records')) {
        if (delayedFirstSave) {
          delayedFirstSave = false
          return new Promise<Response>(resolve => saveResolvers.push(resolve))
        }
        return jsonResponse({ key: body.key, version: 1, data: body.data, updatedAt: '2026-10-28T00:00:01.000Z' })
      }
      if (url.endsWith('/intake')) return jsonResponse({})
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
})
