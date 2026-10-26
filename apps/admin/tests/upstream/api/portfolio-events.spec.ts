import { env, exports } from 'cloudflare:workers'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const LOCAL_ADMIN_ORIGIN = 'http://localhost'
const GATEWAY_TOKEN = 'test-gateway-token'
const TRUSTED_METADATA = JSON.stringify({
  ip: '198.51.100.20',
  userAgent: 'upstream-worker-contract-test',
  country: 'MY',
  region: 'KUL',
  city: 'Kuala Lumpur',
  timezone: 'Asia/Kuala_Lumpur',
  colo: 'KUL',
})

const workerEnv = env as unknown as Record<string, string | undefined>
let previousAdminOrigin: string | undefined

function eventRequest(id: string, cookie?: string) {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-portfolio-gateway': GATEWAY_TOKEN,
    'x-portfolio-meta': TRUSTED_METADATA,
  }
  if (cookie)
    headers.cookie = cookie

  return new Request(`${LOCAL_ADMIN_ORIGIN}/internal/events`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      events: [{
        id,
        type: 'page_view',
        path: '/contract-test',
      }],
    }),
  })
}

function cookiePair(response: Response) {
  const cookies = response.headers.getSetCookie()
  expect(cookies).toHaveLength(2)
  expect(cookies[0]).toMatch(/^__Host-portfolio-visitor=/)
  expect(cookies[1]).toMatch(/^__Host-portfolio-session=/)
  return cookies.map(cookie => cookie.split(';', 1)[0]).join('; ')
}

function cookieValue(cookies: string[], name: string) {
  const cookie = cookies.find(item => item.startsWith(`${name}=`))
  return cookie?.slice(name.length + 1).split(';', 1)[0] ?? null
}

async function postEvent(id: string, cookie?: string) {
  return exports.default.fetch(eventRequest(id, cookie))
}

describe('/internal/events against the built Nuxt Worker', () => {
  beforeEach(() => {
    previousAdminOrigin = workerEnv.PORTFOLIO_ADMIN_ORIGIN
    // Keep the local-only analytics opt-in bounded to this local test
    // origin; the analytics worker rejects arbitrary non-production hosts.
    workerEnv.PORTFOLIO_ADMIN_ORIGIN = LOCAL_ADMIN_ORIGIN
  })

  afterEach(() => {
    workerEnv.PORTFOLIO_ADMIN_ORIGIN = previousAdminOrigin
  })

  it('accepts the gateway and trusted metadata, then issues visitor and session cookies', async () => {
    const eventId = `worker-contract-${crypto.randomUUID()}`
    const response = await postEvent(eventId)

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/json')
    await expect(response.json()).resolves.toMatchObject({ accepted: 1, deduped: 0 })

    const cookies = response.headers.getSetCookie()
    cookiePair(response)
    const row = await env.DB.prepare([
      'SELECT event_id, visitor_key, session_key, ip, user_agent, country, region, city, timezone, colo',
      'FROM portfolio_analytics_events WHERE event_id = ?',
    ].join(' ')).bind(eventId).first<{
      event_id: string
      visitor_key: string
      session_key: string
      ip: string
      user_agent: string
      country: string
      region: string
      city: string
      timezone: string
      colo: string
    }>()

    expect(row).toMatchObject({
      event_id: eventId,
      ip: '198.51.100.20',
      user_agent: 'upstream-worker-contract-test',
      country: 'MY',
      region: 'KUL',
      city: 'Kuala Lumpur',
      timezone: 'Asia/Kuala_Lumpur',
      colo: 'KUL',
    })
    expect(row?.visitor_key).toBeTruthy()
    expect(row?.session_key).toBeTruthy()
    expect(cookieValue(cookies, '__Host-portfolio-visitor')).toBeTruthy()
    expect(cookieValue(cookies, '__Host-portfolio-session')).toBeTruthy()
  })

  it('keeps the signed identity across a retry and deduplicates the repeated event', async () => {
    const eventId = `worker-dedupe-${crypto.randomUUID()}`
    const first = await postEvent(eventId)
    expect(first.status).toBe(200)
    const firstCookies = first.headers.getSetCookie()
    const cookie = cookiePair(first)
    const firstVisitor = cookieValue(firstCookies, '__Host-portfolio-visitor')
    const firstSession = cookieValue(firstCookies, '__Host-portfolio-session')
    expect(firstVisitor).toBeTruthy()
    expect(firstSession).toBeTruthy()
    await first.json()

    const retry = await postEvent(eventId, cookie)
    expect(retry.status).toBe(200)
    await expect(retry.json()).resolves.toMatchObject({ accepted: 0, deduped: 1 })

    const retryCookies = retry.headers.getSetCookie()
    expect(retryCookies).toHaveLength(1)
    expect(retryCookies[0]).toMatch(/^__Host-portfolio-session=/)
    expect(cookieValue(retryCookies, '__Host-portfolio-session')?.split('.')[2])
      .toBe(firstSession?.split('.')[2])
    expect(cookieValue(retryCookies, '__Host-portfolio-visitor')).toBeNull()

    const rows = await env.DB.prepare(
      'SELECT event_id, visitor_key, session_key FROM portfolio_analytics_events WHERE event_id = ?',
    ).bind(eventId).all<{ event_id: string, visitor_key: string, session_key: string }>()
    expect(rows.results).toHaveLength(1)
    expect(rows.results[0]).toMatchObject({
      event_id: eventId,
      visitor_key: firstVisitor?.split('.')[2],
      session_key: firstSession?.split('.')[2],
    })
  })
})
