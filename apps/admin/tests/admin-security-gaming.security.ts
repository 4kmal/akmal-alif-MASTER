import { createServer } from 'node:http'
import { createApp, eventHandler, toNodeListener } from 'h3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const ingest = vi.hoisted(() => vi.fn())
vi.mock('@portfolio-analytics', () => ({ ingestGamingSummary: ingest }))

describe('authoritative game result ingress', () => {
  let server: ReturnType<typeof createServer>
  let origin = ''
  let privateOrigin = 'https://admin.internal'
  let authMethod: 'gaming-service' | undefined = 'gaming-service'

  beforeEach(async () => {
    vi.stubGlobal('useRuntimeConfig', () => ({ portfolioGatewayToken: 'private-service-secret' }))
    ingest.mockReset().mockResolvedValue({ accepted: 1, deduped: 0 })
    privateOrigin = 'https://admin.internal'
    authMethod = 'gaming-service'
    const { default: summary } = await import('../server/routes/internal/gaming/summary.post')
    const app = createApp()
    app.use(eventHandler((event) => {
      event.context.authMethod = authMethod
      event.context.cloudflare = { request: new Request(`${privateOrigin}${event.path}`), env: {} } as typeof event.context.cloudflare
    }))
    app.use(summary)
    server = createServer(toNodeListener(app))
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string')
      throw new Error('Missing test listener address')
    origin = `http://127.0.0.1:${address.port}`
  })

  afterEach(async () => {
    vi.unstubAllGlobals()
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  })

  const headers = { 'Content-Type': 'application/json', 'X-Portfolio-Gateway': 'private-service-secret', 'X-Gaming-Service': 'exepert-room' }
  const body = JSON.stringify({ source: 'exepert-room', match_id: 'match-private', participants: [] })
  const request = (extraHeaders = {}, payload = body) => fetch(`${origin}/internal/gaming/summary`, { method: 'POST', headers: { ...headers, ...extraHeaders }, body: payload })

  it('stores a private verified summary while preserving service failure status', async () => {
    const response = await request()
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(ingest).toHaveBeenCalledWith(JSON.parse(body), {}, expect.any(Number))
    ingest.mockResolvedValueOnce({ accepted: 0, unavailable: true })
    expect((await request()).status).toBe(503)
  })

  it('requires the validated service principal even with a known secret and internal URL', async () => {
    authMethod = undefined
    expect((await request()).status).toBe(403)
    authMethod = 'gaming-service'
    privateOrigin = 'https://www.akmalalif.com'
    expect((await request()).status).toBe(403)
    privateOrigin = 'https://admin.internal'
    expect((await request({ Origin: 'https://www.akmalalif.com' })).status).toBe(403)
    expect((await request({ 'X-Portfolio-Gateway': 'forged' })).status).toBe(403)
    expect(ingest).not.toHaveBeenCalled()
  })

  it('rejects malformed or oversized bodies before writing any match', async () => {
    expect((await request({}, '{')).status).toBe(400)
    expect((await request({}, 'x'.repeat(65_537))).status).toBe(413)
    expect(ingest).not.toHaveBeenCalled()
  })
})
