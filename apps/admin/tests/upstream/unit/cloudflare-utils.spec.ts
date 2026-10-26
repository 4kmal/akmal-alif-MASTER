import type { H3Event } from 'h3'
import type { Compilable } from 'kysely'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { collectAccessLog, writeAccessLog } from '../../../server/utils/access-log'
import { useWAE } from '../../../server/utils/cloudflare'

vi.mock('#shared/utils/flag', () => ({ getFlag: vi.fn() }))
const { recordShortlinkEvent } = vi.hoisted(() => ({
  recordShortlinkEvent: vi.fn(),
}))
vi.mock('@portfolio-analytics', () => ({ recordShortlinkEvent }))

const event = {
  context: {
    cloudflare: { env: {} },
    link: { id: 'link-id' },
  },
} as unknown as H3Event

const query = {} as Compilable

afterEach(() => {
  recordShortlinkEvent.mockReset()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

type TestAccessEvent = H3Event & { __headers: Headers, __url: string, __ip: string }

function accessEvent(url: string, cf: Record<string, unknown> = {}, link: Record<string, unknown> = {}): TestAccessEvent {
  const headers = new Headers({
    'user-agent': 'Mozilla/5.0',
    'accept-language': 'en-US,en;q=0.9',
    'cf-ray': 'test-ray',
  })
  return {
    __headers: headers,
    __url: url,
    __ip: '198.51.100.8',
    context: {
      cloudflare: {
        env: { ANALYTICS_ID_SECRET: 'test-secret' },
        request: { cf },
      },
      link: {
        id: 'link-id',
        slug: 'cv',
        url: 'https://destination.example/landing?utm_source=configured&utm_medium=email&utm_content=hero&api_key=target-secret',
        ...link,
      },
    },
  } as unknown as TestAccessEvent
}

function stubH3Request(event: H3Event) {
  vi.stubGlobal('getHeader', (source: H3Event, name: string) => (source as H3Event & { __headers: Headers }).__headers.get(name) ?? undefined)
  vi.stubGlobal('getRequestIP', (source: H3Event) => (source as H3Event & { __ip: string }).__ip)
  vi.stubGlobal('getRequestURL', (source: H3Event) => new URL((source as H3Event & { __url: string }).__url))
  vi.stubGlobal('useRuntimeConfig', () => ({ disableBotAccessLog: false }))
  return event
}

describe('writeAccessLog', () => {
  it('silently skips production writes without an Analytics Engine binding', () => {
    vi.stubEnv('NODE_ENV', 'production')

    expect(() => writeAccessLog(event, {})).not.toThrow()
  })

  it('mirrors whitelisted incoming UTMs with target fallback and strips sensitive query data', async () => {
    vi.stubEnv('NODE_ENV', 'test')
    const access = stubH3Request(accessEvent(
      'https://go.example.test/cv?utm_source=incoming&utm_campaign=launch&email=private@example.test&token=secret',
    ))
    const collected = collectAccessLog(access)
    expect(collected?.logs.latitude).toBeUndefined()
    expect(collected?.logs.longitude).toBeUndefined()

    recordShortlinkEvent.mockResolvedValue({ accepted: 1 })
    await writeAccessLog(access, collected!.logs)

    expect(recordShortlinkEvent).toHaveBeenCalledTimes(1)
    const [payload] = recordShortlinkEvent.mock.calls[0] as [{ campaign?: Record<string, string>, target?: string }]
    expect(payload.campaign).toEqual({
      utm_source: 'incoming',
      utm_medium: 'email',
      utm_campaign: 'launch',
      utm_content: 'hero',
    })
    expect(payload.target).toBe('https://destination.example/landing')
    expect(JSON.stringify(payload)).not.toContain('private@example.test')
    expect(JSON.stringify(payload)).not.toContain('secret')
  })

  it('keeps valid coordinates and uses header fallbacks without inventing missing values', () => {
    const access = accessEvent(
      'https://go.example.test/cv',
      { latitude: '3.14', longitude: '101.68', country: 'MY' },
    )
    stubH3Request(access)
    const collected = collectAccessLog(access)
    expect(collected?.logs.latitude).toBe(3.14)
    expect(collected?.logs.longitude).toBe(101.68)

    const headerFallback = accessEvent('https://go.example.test/cv')
    headerFallback.__headers.set('cf-iplatitude', '3.15')
    headerFallback.__headers.set('cf-iplongitude', '101.69')
    stubH3Request(headerFallback)
    const fallbackCollected = collectAccessLog(headerFallback)
    expect(fallbackCollected?.logs.latitude).toBe(3.15)
    expect(fallbackCollected?.logs.longitude).toBe(101.69)
  })
})

describe('useWAE', () => {
  it.each([
    { cfAccountId: '', cfApiToken: 'token' },
    { cfAccountId: 'account', cfApiToken: '' },
  ])('returns empty data without requesting when credentials are incomplete', (config) => {
    const fetchMock = vi.fn()
    vi.stubGlobal('useRuntimeConfig', () => config)
    vi.stubGlobal('$fetch', fetchMock)

    expect(useWAE(event, query)).toEqual({ data: [] })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('preserves requests and propagates errors when credentials are complete', async () => {
    const error = new Error('forbidden')
    const fetchMock = vi.fn().mockRejectedValue(error)
    vi.stubGlobal('useRuntimeConfig', () => ({
      cfAccountId: 'account',
      cfApiToken: 'token',
    }))
    vi.stubGlobal('compileAnalyticsQuery', () => 'select * from sink')
    vi.stubGlobal('$fetch', fetchMock)

    await expect(useWAE(event, query)).rejects.toBe(error)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.cloudflare.com/client/v4/accounts/account/analytics_engine/sql',
      {
        method: 'POST',
        headers: { Authorization: 'Bearer token' },
        body: 'select * from sink',
        retry: 1,
        retryDelay: 100,
      },
    )
  })
})
