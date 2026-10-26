import { createApp, eventHandler, getHeader as h3GetHeader, toWebHandler } from 'h3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ingestPortfolioEvents } from '../../../server/services/portfolio-analytics'

const analytics = vi.hoisted(() => ({
  ingestEvents: vi.fn(),
}))

vi.mock('@portfolio-analytics', () => analytics)

describe('portfolio analytics H3 adapter', () => {
  beforeEach(() => {
    analytics.ingestEvents.mockReset()
    vi.stubGlobal('useRuntimeConfig', () => ({
      portfolioAdminOrigin: 'https://admin.test',
    }))
    vi.stubGlobal('getHeader', h3GetHeader)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('forwards visitor and session cookies to the analytics worker', async () => {
    const cookie = '__Host-portfolio-visitor=visitor; __Host-portfolio-session=session'
    analytics.ingestEvents.mockImplementation(async (request: Request) => {
      expect(request.url).toBe('https://admin.test/internal/events')
      expect(request.method).toBe('POST')
      expect(request.headers.get('content-type')).toBe('application/json')
      expect(request.headers.get('cookie')).toBe(cookie)
      expect(request.headers.get('x-portfolio-gateway')).toBe('gateway-secret')
      expect(request.headers.get('x-portfolio-meta')).toBe('source=portfolio;version=1')
      await expect(request.json()).resolves.toEqual({ events: [{ type: 'page_view' }] })

      return new Response('accepted', {
        status: 202,
        headers: { 'x-analytics-request': 'request-42' },
      })
    })

    const app = createApp()
    app.use('/internal/events', eventHandler(event => ingestPortfolioEvents(event)))
    const response = await toWebHandler(app)(new Request('http://adapter.test/internal/events', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie,
        'x-portfolio-gateway': 'gateway-secret',
        'x-portfolio-meta': 'source=portfolio;version=1',
      },
      body: JSON.stringify({ events: [{ type: 'page_view' }] }),
    }))

    expect(response.status).toBe(202)
    expect(response.headers.get('x-analytics-request')).toBe('request-42')
    await expect(response.text()).resolves.toBe('accepted')
    expect(analytics.ingestEvents).toHaveBeenCalledOnce()
  })
})
