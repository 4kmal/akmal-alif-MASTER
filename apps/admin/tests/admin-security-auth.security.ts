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

  async function startAuthRoute() {
    const { default: auth } = await import('../server/middleware/2.auth')
    const app = createApp()
    // Mount at root so h3 keeps the original request path visible to the
    // middleware; a prefixed layer rewrites event.path to its suffix.
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

  async function requestAuth(headers: Record<string, string>) {
    return await new Promise<{ status: number, headers: Record<string, string | string[] | undefined>, body: string }>((resolve, reject) => {
      const request = httpRequest(`${origin}/api/portfolio/traffic`, { headers }, (response) => {
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
})
