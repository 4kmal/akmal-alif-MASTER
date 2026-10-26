import { createServer } from 'node:http'
import { createError } from 'h3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { proxyLinkRequest } from '../server/services/link-proxy'

describe('link proxy credential and response boundaries', () => {
  let server: ReturnType<typeof createServer> | undefined
  let origin = ''
  let finalHeaders: Record<string, string | string[] | undefined> = {}

  beforeEach(async () => {
    finalHeaders = {}
    vi.stubGlobal('createError', createError)
    // The production URL gate is exercised elsewhere; allowing this test-only
    // loopback target lets native fetch follow a real redirect chain.
    vi.stubGlobal('isPublicHttpUrl', () => true)
    vi.stubGlobal('getHeaders', () => ({
      'accept': 'text/html',
      'authorization': 'Bearer private-token',
      'cookie': 'session=private',
      'cf-access-jwt-assertion': 'access-token',
      'x-portfolio-gateway': 'gateway-secret',
      'x-forwarded-for': 'spoofed-client',
      'forwarded': 'for=spoofed-client',
      'x-original-url': '/private',
      'user-agent': 'security-test',
    }))
    vi.stubGlobal('getHeader', (_event: unknown, name: string) => name.toLowerCase() === 'cf-connecting-ip' ? '203.0.113.9' : undefined)
    vi.stubGlobal('getRequestProtocol', () => 'https')
    vi.stubGlobal('getRequestHost', () => 'www.akmalalif.com')
    vi.stubGlobal('toWebRequest', () => new Request('https://www.akmalalif.com/proxy', { method: 'GET' }))

    server = createServer((request, response) => {
      if (request.url === '/start') {
        response.writeHead(302, { location: `${origin}/final` })
        response.end()
        return
      }
      finalHeaders = request.headers
      response.writeHead(200, {
        'content-type': 'text/plain',
        'set-cookie': ['upstream-user=secret; Path=/', 'upstream-session=secret; Path=/'],
      })
      response.end('final response')
    })
    await new Promise<void>((resolve, reject) => {
      server?.once('error', reject)
      server?.listen(0, '127.0.0.1', () => resolve())
    })
    const address = server.address()
    if (!address || typeof address === 'string')
      throw new Error('proxy test server did not expose a port')
    origin = `http://127.0.0.1:${address.port}`
  })

  afterEach(async () => {
    vi.unstubAllGlobals()
    if (server) {
      await new Promise<void>((resolve, reject) => server?.close(error => error ? reject(error) : resolve()))
      server = undefined
    }
  })

  it('follows redirects without forwarding credentials and strips upstream cookies', async () => {
    const response = await proxyLinkRequest({ method: 'GET' } as never, `${origin}/start`, { privateCache: true })

    expect(response.status).toBe(200)
    await expect(response.text()).resolves.toBe('final response')
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')

    expect(finalHeaders.authorization).toBeUndefined()
    expect(finalHeaders.cookie).toBeUndefined()
    expect(finalHeaders['cf-access-jwt-assertion']).toBeUndefined()
    expect(finalHeaders['x-portfolio-gateway']).toBeUndefined()
    expect(finalHeaders['x-forwarded-for']).toBe('203.0.113.9')
    expect(finalHeaders.forwarded).toBeUndefined()
    expect(finalHeaders['x-original-url']).toBeUndefined()
    expect(finalHeaders.accept).toBe('text/html')
    expect(finalHeaders['user-agent']).toBe('security-test')
    expect(finalHeaders['x-forwarded-proto']).toBe('https')
    expect(finalHeaders['x-forwarded-host']).toBe('www.akmalalif.com')
  })
})
