import type { H3Event } from 'h3'
import type { JWTVerifyGetKey } from 'jose'
import { createRemoteJWKSet, jwtVerify } from 'jose'
import { getRuntimeString } from './runtime-config'

interface CloudflareAccessConfig {
  audience: string
  issuer: string
}

export type CloudflareAccessIdentity
  = | {
    kind: 'user'
    userID: string
    userEmail: string
  }
  | {
    kind: 'service'
  }

export type CloudflareAccessAuth
  = | {
    authMethod: 'access-user'
    userID: string
    userEmail: string
  }
  | {
    authMethod: 'access-service'
    userID: 'root'
    userEmail: string
  }

const jwksByTeamDomain = new Map<string, ReturnType<typeof createRemoteJWKSet>>()

export function normalizeCloudflareAccessIssuer(teamDomain: string): string {
  const value = teamDomain.trim()
  if (!value)
    return ''

  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`)
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash)
      return ''
    if (!/^[a-z0-9-]+\.cloudflareaccess\.com$/i.test(url.hostname))
      return ''
    return url.origin
  }
  catch {
    return ''
  }
}

function getAccessTokens(event: H3Event): string[] {
  return [...new Set([
    getHeader(event, 'Cf-Access-Jwt-Assertion'),
    getCookie(event, 'CF_Authorization'),
  ].filter((token): token is string => !!token))]
}

function getJwks(teamDomain: string) {
  const cachedJwks = jwksByTeamDomain.get(teamDomain)
  if (cachedJwks)
    return cachedJwks

  const certsUrl = new URL('/cdn-cgi/access/certs', `${teamDomain}/`)
  const jwks = createRemoteJWKSet(certsUrl)
  jwksByTeamDomain.set(teamDomain, jwks)
  return jwks
}

export async function verifyCloudflareAccessToken(
  token: string,
  config: CloudflareAccessConfig,
  getKey?: JWTVerifyGetKey,
): Promise<CloudflareAccessIdentity | null> {
  try {
    const { payload } = await jwtVerify(token, getKey || getJwks(config.issuer), {
      algorithms: ['RS256'],
      audience: config.audience,
      issuer: config.issuer,
      requiredClaims: ['exp'],
    })

    if (payload.type !== 'app')
      return null

    const userID = typeof payload.sub === 'string' ? payload.sub.trim() : ''
    const userEmail = typeof payload.email === 'string' ? payload.email.trim() : ''
    const commonName = typeof payload.common_name === 'string' ? payload.common_name.trim() : ''

    if (userID && userEmail && payload.common_name === undefined) {
      return {
        kind: 'user',
        userID,
        userEmail,
      }
    }

    if (payload.sub === '' && payload.email === undefined && commonName) {
      return {
        kind: 'service',
      }
    }

    return null
  }
  catch {
    return null
  }
}

export function mapCloudflareAccessIdentity(
  identity: CloudflareAccessIdentity,
  hostname: string,
): CloudflareAccessAuth {
  if (identity.kind === 'user') {
    return {
      authMethod: 'access-user',
      userID: identity.userID,
      userEmail: identity.userEmail,
    }
  }

  return {
    authMethod: 'access-service',
    userID: 'root',
    userEmail: `root@${hostname}`,
  }
}

export async function verifyCloudflareAccess(event: H3Event): Promise<CloudflareAccessIdentity | null> {
  const issuer = normalizeCloudflareAccessIssuer(getRuntimeString(event, 'cfAccessTeamDomain', 'CF_ACCESS_TEAM_DOMAIN'))
  const audience = getRuntimeString(event, 'cfAccessAud', 'CF_ACCESS_AUD').trim()
  if (!issuer || !audience)
    return null

  for (const token of getAccessTokens(event)) {
    const identity = await verifyCloudflareAccessToken(token, { audience, issuer })
    if (identity)
      return identity
  }

  return null
}

export function isCloudflareAccessConfigured(teamDomain: string, audience: string): boolean {
  return !!normalizeCloudflareAccessIssuer(teamDomain) && !!audience.trim()
}

export function isCloudflareAccessRequestAllowed(event: H3Event, requestOrigin = getRequestURL(event).origin): boolean {
  return isCloudflareAccessRequestSafe({
    method: event.method,
    hasAccessCookie: !!getCookie(event, 'CF_Authorization'),
    origin: getHeader(event, 'Origin'),
    requestOrigin,
    secFetchSite: getHeader(event, 'Sec-Fetch-Site'),
  })
}

interface CloudflareAccessRequest {
  method: string
  hasAccessCookie?: boolean
  origin?: string
  requestOrigin: string
  secFetchSite?: string
}

export function isCloudflareAccessRequestSafe(request: CloudflareAccessRequest): boolean {
  if (request.secFetchSite === 'cross-site')
    return false

  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method))
    return true

  if (request.origin)
    return request.origin === request.requestOrigin

  return !request.hasAccessCookie
}
