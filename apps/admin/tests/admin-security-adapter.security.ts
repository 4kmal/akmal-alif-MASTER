import { createServer } from 'node:http'
import { createApp, eventHandler, getHeader as h3GetHeader, toNodeListener } from 'h3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { handlePortfolioReport, ingestPortfolioEvents } from '../server/services/portfolio-analytics'

const analytics = vi.hoisted(() => ({
  ingestEvents: vi.fn(),
  handleAnalyticsRequest: vi.fn(),
}))

vi.mock('@portfolio-analytics', () => analytics)

describe('portfolio analytics H3 adapter', () => {
  let server: ReturnType<typeof createServer> | undefined
  let origin = ''

  beforeEach(() => {
    analytics.ingestEvents.mockReset()
    analytics.handleAnalyticsRequest.mockReset()
    vi.stubGlobal('useRuntimeConfig', () => ({
      portfolioAdminOrigin: 'https://admin.test',
    }))
    vi.stubGlobal('getHeader', h3GetHeader)
  })

  afterEach(async () => {
    vi.unstubAllGlobals()
    if (server) {
      await new Promise<void>((resolve, reject) => server?.close(error => error ? reject(error) : resolve()))
      server = undefined
    }
  })

  async function startAdapter() {
    const app = createApp()
    app.use('/internal/events', eventHandler(event => ingestPortfolioEvents(event)))
    server = createServer(toNodeListener(app))
    await new Promise<void>((resolve, reject) => {
      server?.once('error', reject)
      server?.listen(0, '127.0.0.1', () => resolve())
    })
    const address = server.address()
    if (!address || typeof address === 'string')
      throw new Error('adapter test server did not expose a port')
    origin = `http://127.0.0.1:${address.port}`
  }

  it('forwards the request and preserves status, metadata, and both Set-Cookie values', async () => {
    analytics.ingestEvents.mockImplementation(async (request: Request) => {
      expect(request.url).toBe('https://admin.test/internal/events')
      expect(request.method).toBe('POST')
      expect(request.headers.get('content-type')).toBe('application/json')
      expect(request.headers.get('x-portfolio-gateway')).toBe('gateway-secret')
      expect(request.headers.get('x-portfolio-meta')).toBe('source=portfolio;version=1')
      expect(request.headers.get('cookie')).toBe('__Host-portfolio-visitor=visitor; __Host-portfolio-session=session')
      await expect(request.json()).resolves.toEqual({ events: [{ type: 'page_view' }] })

      return new Response('accepted', {
        status: 202,
        headers: [
          ['content-type', 'text/plain'],
          ['x-analytics-request', 'request-42'],
          ['set-cookie', '__Host-portfolio-visitor=visitor; Path=/; Secure'],
          ['set-cookie', '__Host-portfolio-session=session; Path=/; Secure'],
        ],
      })
    })
    await startAdapter()

    const response = await fetch(`${origin}/internal/events`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-portfolio-gateway': 'gateway-secret',
        'x-portfolio-meta': 'source=portfolio;version=1',
        'cookie': '__Host-portfolio-visitor=visitor; __Host-portfolio-session=session',
      },
      body: JSON.stringify({ events: [{ type: 'page_view' }] }),
    })

    expect(response.status).toBe(202)
    expect(response.headers.get('x-analytics-request')).toBe('request-42')
    expect(response.headers.getSetCookie()).toEqual([
      '__Host-portfolio-visitor=visitor; Path=/; Secure',
      '__Host-portfolio-session=session; Path=/; Secure',
    ])
    await expect(response.text()).resolves.toBe('accepted')
  })

  it('turns a failed analytics worker response into the same upstream status and message', async () => {
    analytics.ingestEvents.mockResolvedValue(new Response('bad event batch', {
      status: 422,
      headers: { 'x-analytics-request': 'request-43' },
    }))
    await startAdapter()

    const response = await fetch(`${origin}/internal/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ events: [] }),
    })

    expect(response.status).toBe(422)
    await expect(response.text()).resolves.toContain('bad event batch')
    expect(response.headers.get('x-analytics-request')).toBeNull()
  })

  it('streams non-JSON reports with their status, download headers, cursor, and body intact', async () => {
    analytics.handleAnalyticsRequest.mockImplementation(async (request: Request) => {
      expect(request.url).toBe('https://admin.test/api/portfolio/traffic?range=30d')
      return new Response('path,views\n/,42\n', {
        status: 206,
        headers: [
          ['content-type', 'text/csv; charset=utf-8'],
          ['content-disposition', 'attachment; filename="traffic.csv"'],
          ['x-next-cursor', 'cursor-2'],
        ],
      })
    })

    const app = createApp()
    app.use('/report', eventHandler(event => handlePortfolioReport(event, 'traffic')))
    server = createServer(toNodeListener(app))
    await new Promise<void>((resolve, reject) => {
      server?.once('error', reject)
      server?.listen(0, '127.0.0.1', () => resolve())
    })
    const address = server.address()
    if (!address || typeof address === 'string')
      throw new Error('report adapter test server did not expose a port')
    origin = `http://127.0.0.1:${address.port}`

    const response = await fetch(`${origin}/report?range=30d`)

    expect(response.status).toBe(206)
    expect(response.headers.get('content-type')).toBe('text/csv; charset=utf-8')
    expect(response.headers.get('content-disposition')).toBe('attachment; filename="traffic.csv"')
    expect(response.headers.get('x-next-cursor')).toBe('cursor-2')
    await expect(response.text()).resolves.toBe('path,views\n/,42\n')
  })
})
