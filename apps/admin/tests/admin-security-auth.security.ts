import { Buffer } from 'node:buffer'
import { createServer, request as httpRequest } from 'node:http'
import { createApp, createError, getHeader, getRequestURL, eventHandler as h3EventHandler, setResponseHeader, toNodeListener } from 'h3'
import { generateKeyPair, SignJWT } from 'jose'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  normalizeCloudflareAccessIssuer,
  verifyCloudflareAccessToken,
} from '../server/utils/cloudflare-access'

const issuer = 'https://restless-moon-2787.cloudflareaccess.com'
const audience = 'admin-audience'

describe('cloudflare Access owner authentication', () => {
  it('requires the expected issuer, audience, time claims, and RS256 signature', async () => {
    const { privateKey, publicKey } = await generateKeyPair('RS256')
    const { privateKey: spoofedKey } = await generateKeyPair('RS256')
    const getKey = async () => publicKey
    const ownerClaims = { type: 'app', email: 'iamaleep@gmail.com' }
    const makeOwner = (key: Parameters<SignJWT['sign']>[0], claims = ownerClaims) => new SignJWT(claims)
      .setProtectedHeader({ alg: 'RS256', kid: 'owner' })
      .setIssuer(issuer)
      .setAudience(audience)
      .setSubject('owner-subject')
      .setExpirationTime(Math.floor(Date.now() / 1000) + 300)
      .sign(key)

    const owner = await makeOwner(privateKey)
    const expired = await new SignJWT(ownerClaims)
      .setProtectedHeader({ alg: 'RS256', kid: 'expired' })
      .setIssuer(issuer)
      .setAudience(audience)
      .setSubject('owner-subject')
      .setExpirationTime(Math.floor(Date.now() / 1000) - 1)
      .sign(privateKey)
    const spoofed = await makeOwner(spoofedKey)
    const wrongIssuer = await new SignJWT(ownerClaims)
      .setProtectedHeader({ alg: 'RS256', kid: 'wrong-issuer' })
      .setIssuer('https://other-team.cloudflareaccess.com')
      .setAudience(audience)
      .setSubject('owner-subject')
      .setExpirationTime('5m')
      .sign(privateKey)
    const notYetValid = await new SignJWT(ownerClaims)
      .setProtectedHeader({ alg: 'RS256', kid: 'not-yet-valid' })
      .setIssuer(issuer)
      .setAudience(audience)
      .setSubject('owner-subject')
      .setNotBefore('5m')
      .setExpirationTime('10m')
      .sign(privateKey)

    await expect(verifyCloudflareAccessToken(owner, { issuer, audience }, getKey)).resolves.toEqual({
      kind: 'user',
      userID: 'owner-subject',
      userEmail: 'iamaleep@gmail.com',
    })
    await expect(verifyCloudflareAccessToken(expired, { issuer, audience }, getKey)).resolves.toBeNull()
    await expect(verifyCloudflareAccessToken(spoofed, { issuer, audience }, getKey)).resolves.toBeNull()
    await expect(verifyCloudflareAccessToken(wrongIssuer, { issuer, audience }, getKey)).resolves.toBeNull()
    await expect(verifyCloudflareAccessToken(notYetValid, { issuer, audience }, getKey)).resolves.toBeNull()
  })

  it('accepts the service-token shape separately from an owner identity', async () => {
    const { privateKey, publicKey } = await generateKeyPair('RS256')
    const service = await new SignJWT({ type: 'app', common_name: 'portfolio-service' })
      .setProtectedHeader({ alg: 'RS256', kid: 'service' })
      .setIssuer(issuer)
      .setAudience(audience)
      .setSubject('')
      .setExpirationTime('5m')
      .sign(privateKey)

    await expect(verifyCloudflareAccessToken(service, { issuer, audience }, async () => publicKey)).resolves.toEqual({
      kind: 'service',
    })
  })

  it('rejects malformed or unsafe team issuers before any token verification', () => {
    expect(normalizeCloudflareAccessIssuer('restless-moon-2787.cloudflareaccess.com')).toBe(issuer)
    expect(normalizeCloudflareAccessIssuer('https://restless-moon-2787.cloudflareaccess.com/path')).toBe('')
    expect(normalizeCloudflareAccessIssuer('https://user:pass@restless-moon-2787.cloudflareaccess.com')).toBe('')
    expect(normalizeCloudflareAccessIssuer('http://restless-moon-2787.cloudflareaccess.com')).toBe('')
    expect(normalizeCloudflareAccessIssuer('https://attacker.example')).toBe('')
  })
})

describe('admin authentication route boundaries', () => {
  let server: ReturnType<typeof createServer> | undefined
  let origin = ''

  beforeEach(() => {
    vi.stubGlobal('eventHandler', (handler: unknown) => handler)
    vi.stubGlobal('createError', createError)
    vi.stubGlobal('getHeader', getHeader)
    vi.stubGlobal('getRequestURL', getRequestURL)
    vi.stubGlobal('setResponseHeader', setResponseHeader)
    vi.stubGlobal('verifyCloudflareAccess', vi.fn().mockResolvedValue(null))
    vi.stubGlobal('useRuntimeConfig', () => ({
      adminEmail: 'iamaleep@gmail.com',
      portfolioAdminOrigin: 'https://www.akmalalif.com',
      portfolioGatewayToken: 'gateway-secret',
      shortlinkOrigin: 'https://go.akmalalif.com',
      siteToken: 'public-site-token',
      allowLocalAuth: false,
      allowLocalAdmin: false,
      cfAccessTeamDomain: 'restless-moon-2787.cloudflareaccess.com',
      cfAccessAud: audience,
    }))
  })

  afterEach(async () => {
    vi.unstubAllGlobals()
    vi.resetModules()
    if (server) {
      await new Promise<void>((resolve, reject) => server?.close(error => error ? reject(error) : resolve()))
      server = undefined
    }
  })

  async function startAuthRoute(nativeOrigin?: string) {
    const { default: auth } = await import('../server/middleware/2.auth')
    const app = createApp()
    // Mount at root so h3 keeps the original request path visible to the
    // middleware; a prefixed layer rewrites event.path to its suffix.
    if (nativeOrigin) {
      app.use('/', h3EventHandler((event) => {
        event.context.cloudflare = { request: new Request(`${nativeOrigin}${event.path}`) } as typeof event.context.cloudflare
      }))
    }
    app.use('/', h3EventHandler(auth))
    app.use('/', h3EventHandler(() => ({ ok: true })))
    server = createServer(toNodeListener(app))
    await new Promise<void>((resolve, reject) => {
      server?.once('error', reject)
      server?.listen(0, '127.0.0.1', () => resolve())
    })
    const address = server.address()
    if (!address || typeof address === 'string')
      throw new Error('auth test server did not expose a port')
    origin = `http://127.0.0.1:${address.port}`
  }

  async function requestAuth(headers: Record<string, string>, path = '/api/portfolio/traffic', method = 'GET') {
    return await new Promise<{ status: number, headers: Record<string, string | string[] | undefined>, body: string }>((resolve, reject) => {
      const request = httpRequest(`${origin}${path}`, { headers, method }, (response) => {
        const chunks: Buffer[] = []
        response.on('data', chunk => chunks.push(Buffer.from(chunk)))
        response.on('end', () => resolve({
          status: response.statusCode || 0,
          headers: response.headers,
          body: Buffer.concat(chunks).toString(),
        }))
      })
      request.on('error', reject)
      request.end()
    })
  }

  it('keeps private portfolio APIs behind owner auth on the native go host, including with a site token', async () => {
    await startAuthRoute()
    const response = await requestAuth({
      'host': 'go.akmalalif.com',
      'x-forwarded-proto': 'https',
      'authorization': 'Bearer public-site-token',
    })

    expect(response.status).toBe(401)
    expect(response.headers['www-authenticate']).toBe('Bearer')
    expect(response.body).toContain('Unauthorized')
  })

  it('keeps account billing and player journeys unavailable to shortlink site tokens', async () => {
    await startAuthRoute()
    for (const path of [
      '/api/admin/observability/summary',
      '/api/admin/observability/cloudflare',
      '/api/admin/observability/gaming',
      '/api/admin/observability/gaming/sessions/example',
      '/api/admin/observability/gaming/players/example',
    ]) {
      const response = await requestAuth({
        'host': 'go.akmalalif.com',
        'authorization': 'Bearer public-site-token',
        'x-portfolio-admin-id': 'root',
        'x-portfolio-admin-email': 'iamaleep@gmail.com',
      }, path)
      expect(response.status).toBe(401)
    }
  })

  it('rejects public-host and browser attempts to submit authoritative gaming results', async () => {
    await startAuthRoute('https://www.akmalalif.com')
    const serviceHeaders = {
      'x-portfolio-gateway': 'gateway-secret',
      'x-gaming-service': 'exepert-room',
    }
    expect((await requestAuth(serviceHeaders, '/internal/gaming/summary', 'POST')).status).toBe(403)
    expect((await requestAuth({ ...serviceHeaders, 'x-portfolio-gateway': '' }, '/internal/gaming/summary', 'POST')).status).toBe(401)
    expect((await requestAuth(serviceHeaders, '/internal/gaming/other', 'POST')).status).toBe(404)
  })

  it('accepts only private EXEPERT service POSTs without browser headers', async () => {
    await startAuthRoute('https://admin.internal')
    const serviceHeaders = {
      'x-portfolio-gateway': 'gateway-secret',
      'x-gaming-service': 'exepert-room',
    }
    expect((await requestAuth(serviceHeaders, '/internal/gaming/summary', 'POST')).status).toBe(200)
    expect((await requestAuth(serviceHeaders, '/internal/gaming/summary')).status).toBe(405)
    expect((await requestAuth({ ...serviceHeaders, 'x-gaming-service': 'browser' }, '/internal/gaming/summary', 'POST')).status).toBe(403)
    expect((await requestAuth({ ...serviceHeaders, origin: 'https://www.akmalalif.com' }, '/internal/gaming/summary', 'POST')).status).toBe(403)
    expect((await requestAuth({ ...serviceHeaders, 'sec-fetch-site': 'same-origin' }, '/internal/gaming/summary', 'POST')).status).toBe(403)
  })

  it('does not exempt BetterAuth-shaped paths on the native go host', async () => {
    await startAuthRoute()
    for (const path of ['/api/auth', '/api/auth/get-session', '/api/auth/..%2flink%2flist']) {
      const response = await requestAuth({
        'host': 'go.akmalalif.com',
        'x-forwarded-proto': 'https',
      }, path)

      expect(response.status).toBe(401)
      expect(response.headers['www-authenticate']).toBe('Bearer')
    }
  })

  it('rejects a missing owner token when local admin bypass is explicitly disabled', async () => {
    await startAuthRoute()
    const response = await requestAuth({
      'host': 'localhost',
      'x-portfolio-gateway': 'gateway-secret',
    })

    expect(response.status).toBe(401)
    expect(response.headers['www-authenticate']).toBe('Bearer')
    expect(response.body).toContain('Unauthorized')
  })

  it('accepts only the trusted owner gateway identity at the canonical origin', async () => {
    vi.stubGlobal('useRuntimeConfig', () => ({
      adminEmail: 'iamaleep@gmail.com',
      // The Node test listener is plain HTTP; the host header models the
      // configured canonical production host without enabling the localhost
      // bypass.
      portfolioAdminOrigin: 'http://www.akmalalif.com',
      portfolioGatewayToken: 'gateway-secret',
      shortlinkOrigin: 'https://go.akmalalif.com',
      siteToken: 'public-site-token',
      allowLocalAuth: false,
      allowLocalAdmin: false,
      cfAccessTeamDomain: '',
      cfAccessAud: '',
    }))
    await startAuthRoute()
    const headers = {
      'host': 'www.akmalalif.com',
      'x-portfolio-gateway': 'gateway-secret',
      'x-portfolio-admin-id': 'root',
      'x-portfolio-admin-email': 'iamaleep@gmail.com',
    }

    const owner = await requestAuth(headers)
    expect(owner.status).toBe(200)

    const gatewayOnly = await requestAuth({
      'host': 'www.akmalalif.com',
      'x-portfolio-gateway': 'gateway-secret',
    })
    expect(gatewayOnly.status).toBe(401)

    const missingOwner = await requestAuth({
      ...headers,
      'x-portfolio-admin-id': '',
    })
    expect(missingOwner.status).toBe(401)

    const wrongOwner = await requestAuth({
      ...headers,
      'x-portfolio-admin-email': 'attacker@example.com',
    })
    expect(wrongOwner.status).toBe(401)

    const crossOriginWrite = await requestAuth({
      ...headers,
      origin: 'https://evil.example',
    }, '/api/admin/overview', 'POST')
    expect(crossOriginWrite.status).toBe(403)

    const missingOriginWrite = await requestAuth(headers, '/api/admin/overview', 'POST')
    expect(missingOriginWrite.status).toBe(403)

    const forwardedSpoof = await requestAuth({
      ...headers,
      'x-forwarded-host': 'go.akmalalif.com',
      'x-forwarded-proto': 'https',
    })
    expect(forwardedSpoof.status).toBe(200)
  })

  it('allows a validated local BetterAuth gateway session only with ALLOW_LOCAL_AUTH', async () => {
    vi.stubGlobal('useRuntimeConfig', () => ({
      adminEmail: 'iamaleep@gmail.com',
      portfolioAdminOrigin: origin,
      portfolioGatewayToken: 'gateway-secret',
      shortlinkOrigin: 'https://go.akmalalif.com',
      siteToken: '',
      allowLocalAuth: true,
      allowLocalAdmin: false,
      cfAccessTeamDomain: '',
      cfAccessAud: '',
    }))
    await startAuthRoute()
    const headers = {
      'host': new URL(origin).host,
      'x-portfolio-gateway': 'gateway-secret',
      'x-portfolio-admin-id': 'root',
      'x-portfolio-admin-email': 'iamaleep@gmail.com',
    }

    const owner = await requestAuth(headers)
    expect(owner.status).toBe(200)

    const gatewayOnly = await requestAuth({
      'host': new URL(origin).host,
      'x-portfolio-gateway': 'gateway-secret',
    })
    expect(gatewayOnly.status).toBe(401)
  })

  it('allows local native Sink APIs only with the explicit bypass and same-origin writes', async () => {
    vi.stubGlobal('useRuntimeConfig', () => ({
      adminEmail: 'iamaleep@gmail.com',
      portfolioAdminOrigin: origin,
      portfolioGatewayToken: '',
      shortlinkOrigin: origin,
      siteToken: '',
      allowLocalAuth: false,
      allowLocalAdmin: true,
      cfAccessTeamDomain: '',
      cfAccessAud: '',
    }))
    await startAuthRoute()
    const localHeaders = {
      host: new URL(origin).host,
      origin,
    }

    const read = await requestAuth(localHeaders, '/api/link/list')
    expect(read.status).toBe(200)

    const write = await requestAuth(localHeaders, '/api/link/create', 'POST')
    expect(write.status).toBe(200)

    const crossSite = await requestAuth({
      ...localHeaders,
      origin: 'https://evil.example',
    }, '/api/link/create', 'POST')
    expect(crossSite.status).toBe(403)

    const missingOrigin = await requestAuth({
      host: new URL(origin).host,
    }, '/api/link/create', 'POST')
    expect(missingOrigin.status).toBe(403)
  })
})
