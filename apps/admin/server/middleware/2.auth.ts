import type { H3Event } from 'h3'
import { timingSafeEqual } from 'node:crypto'
import { getRuntimeBoolean, getRuntimeString } from '../utils/runtime-config'

export default eventHandler(async (event) => {
  const isAnalyticsIngest = event.path === '/internal/events'
  if (!event.path.startsWith('/api/') && !isAnalyticsIngest)
    return

  const adminEmail = getRuntimeString(event, 'adminEmail', 'ADMIN_EMAIL')
  const adminOrigin = getRuntimeString(event, 'portfolioAdminOrigin', 'PORTFOLIO_ADMIN_ORIGIN')
  const gatewaySecret = getRuntimeString(event, 'portfolioGatewayToken', 'PORTFOLIO_GATEWAY_TOKEN')
  const shortlinkOrigin = getRuntimeString(event, 'shortlinkOrigin', 'SHORTLINK_ORIGIN')
  const siteToken = getRuntimeString(event, 'siteToken', 'SITE_TOKEN')
  const allowLocalAdmin = getRuntimeBoolean(event, 'allowLocalAdmin', 'ALLOW_LOCAL_ADMIN')
  const requestUrl = getRequestURL(event)
  const gatewayToken = getHeader(event, 'x-portfolio-gateway')
  const gatewayAuthorized = !!gatewaySecret
    && !!gatewayToken
    && gatewayToken === gatewaySecret

  const shortlinkHost = hostnameFromOrigin(shortlinkOrigin)
  const isShortlinkHost = shortlinkHost && requestUrl.hostname === shortlinkHost
  const token = getHeader(event, 'Authorization')?.replace(/^Bearer\s+/, '')
  const isLocal = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(requestUrl.hostname)

  if (isAnalyticsIngest) {
    if (!gatewayAuthorized) {
      throw createError({ status: 401, statusText: 'Analytics gateway authentication failed' })
    }
    if (!isLocal && requestUrl.origin !== adminOrigin) {
      throw createError({ status: 403, statusText: 'Analytics ingestion is restricted to the portfolio origin' })
    }
    if (!getHeader(event, 'x-portfolio-meta')) {
      throw createError({ status: 400, statusText: 'Trusted analytics metadata is required' })
    }
    event.context.authMethod = 'portfolio-gateway'
    event.context.userID = 'root'
    event.context.userEmail = adminEmail
    return
  }

  if (gatewayAuthorized && isLocal && allowLocalAdmin) {
    event.context.authMethod = 'portfolio-gateway'
    event.context.userID = 'root'
    event.context.userEmail = adminEmail
    return
  }

  const isOwnerOnlyRoute = event.path === '/api/admin'
    || event.path.startsWith('/api/admin/')
    || event.path === '/api/portfolio'
    || event.path.startsWith('/api/portfolio/')
    || event.path === '/api/internal'
    || event.path.startsWith('/api/internal/')

  // Local browser QA uses an explicit opt-in and never reaches a production
  // origin. Keep the local path useful without putting a bearer token in the
  // dashboard bundle or localStorage.
  if (isLocal && allowLocalAdmin && event.path.startsWith('/api/')) {
    if (!isLocalRequestAllowed(event, requestUrl)) {
      throw createError({ status: 403, statusText: 'Local admin requests must use the same origin' })
    }

    event.context.authMethod = 'local-admin'
    event.context.userID = 'root'
    event.context.userEmail = adminEmail || 'local-admin@localhost'
    return
  }

  if (isShortlinkHost && !isOwnerOnlyRoute && await verifySiteToken(token, siteToken)) {
    event.context.authMethod = 'site-token'
    event.context.userID = 'root'
    event.context.userEmail = `root@${requestUrl.hostname}`
    return
  }

  if (isLocal && await verifySiteToken(token, siteToken)) {
    event.context.authMethod = 'site-token'
    event.context.userID = 'root'
    event.context.userEmail = adminEmail
    return
  }

  if (isShortlinkHost) {
    setResponseHeader(event, 'WWW-Authenticate', 'Bearer')
    throw createError({ status: 401, statusText: token ? 'Unauthorized' : 'Bearer token required' })
  }

  const accessIdentity = await verifyCloudflareAccess(event)
  if (accessIdentity?.kind === 'user' && adminEmail && accessIdentity.userEmail.toLowerCase() === adminEmail.toLowerCase()) {
    if (isCloudflareAccessRequestAllowed(event)) {
      const mappedIdentity = mapCloudflareAccessIdentity(accessIdentity, requestUrl.hostname)
      Object.assign(
        event.context,
        gatewayAuthorized ? { ...mappedIdentity, authMethod: 'portfolio-gateway' } : mappedIdentity,
      )
      return
    }

    throw createError({
      status: 403,
      statusText: 'Forbidden',
    })
  }

  setResponseHeader(event, 'WWW-Authenticate', 'Bearer')

  if (token && token.length < 8) {
    throw createError({
      status: 401,
      statusText: 'Token is too short',
    })
  }

  throw createError({
    status: 401,
    statusText: 'Unauthorized',
  })
})

function isLocalRequestAllowed(event: H3Event, requestUrl: URL): boolean {
  if (getHeader(event, 'Sec-Fetch-Site') === 'cross-site')
    return false

  const origin = getHeader(event, 'Origin')
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(event.method))
    return origin === requestUrl.origin

  return !origin || origin === requestUrl.origin
}

function hostnameFromOrigin(origin: string): string {
  try {
    return new URL(origin).hostname
  }
  catch {
    return ''
  }
}

async function verifySiteToken(provided: string | undefined, expected: string): Promise<boolean> {
  if (!provided || !expected)
    return false

  const encoder = new TextEncoder()
  const [providedHash, expectedHash] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(provided || '')),
    crypto.subtle.digest('SHA-256', encoder.encode(expected)),
  ])
  return timingSafeEqual(new Uint8Array(providedHash), new Uint8Array(expectedHash))
}
