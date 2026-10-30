import { timingSafeEqual } from 'node:crypto'
import { authenticateJudgingDeviceRequest } from '../utils/judging'
import {
  authoritativeRequestOrigin,
  getTrustedPortfolioGatewayIdentity,
  isLocalHostname,
  isPortfolioGatewayTokenValid,
  isSameOriginBrowserRequest,
  normalizePortfolioOrigin,
} from '../utils/portfolio-gateway'
import { getRuntimeBoolean, getRuntimeString } from '../utils/runtime-config'

export default eventHandler(async (event) => {
  const isAnalyticsIngest = event.path === '/internal/events'
  const isRuntimeRequest = event.path === '/runtime' || event.path.startsWith('/runtime/')
  const isJudgingSyncRequest = event.path === '/api/judging-sync' || event.path.startsWith('/api/judging-sync/')
  if (isJudgingSyncRequest) {
    if (event.path === '/api/judging-sync/pair' && event.method === 'POST')
      return
    if (await authenticateJudgingDeviceRequest(event))
      return
    throw createError({ statusCode: 401, statusText: 'A valid judging device token is required' })
  }
  if (!event.path.startsWith('/api/') && !isAnalyticsIngest && !isRuntimeRequest)
    return

  if (event.path === '/api/auth' || event.path.startsWith('/api/auth/'))
    return

  const adminEmail = getRuntimeString(event, 'adminEmail', 'ADMIN_EMAIL')
  const adminOrigin = getRuntimeString(event, 'portfolioAdminOrigin', 'PORTFOLIO_ADMIN_ORIGIN')
  const gatewaySecret = getRuntimeString(event, 'portfolioGatewayToken', 'PORTFOLIO_GATEWAY_TOKEN')
  const shortlinkOrigin = getRuntimeString(event, 'shortlinkOrigin', 'SHORTLINK_ORIGIN')
  const siteToken = getRuntimeString(event, 'siteToken', 'SITE_TOKEN')
  const allowLocalAuth = getRuntimeBoolean(event, 'allowLocalAuth', 'ALLOW_LOCAL_AUTH')
  const allowLocalAdmin = getRuntimeBoolean(event, 'allowLocalAdmin', 'ALLOW_LOCAL_ADMIN')
  const requestOrigin = authoritativeRequestOrigin(event)
  const requestHostname = hostnameFromOrigin(requestOrigin)
  const gatewayAuthorized = isPortfolioGatewayTokenValid(event, gatewaySecret)
  const trustedGatewayIdentity = getTrustedPortfolioGatewayIdentity(event, {
    adminEmail,
    adminOrigin,
    gatewaySecret,
  })

  const shortlinkHost = hostnameFromOrigin(shortlinkOrigin)
  const isShortlinkHost = shortlinkHost && requestHostname === shortlinkHost
  const token = getHeader(event, 'Authorization')?.replace(/^Bearer\s+/, '')
  const isLocal = isLocalHostname(requestHostname)

  if (isAnalyticsIngest) {
    if (!gatewayAuthorized) {
      throw createError({ status: 401, statusText: 'Analytics gateway authentication failed' })
    }
    if (!isLocal && requestOrigin !== normalizePortfolioOrigin(adminOrigin)) {
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

  // Local BetterAuth QA still requires the validated gateway identity and a
  // separate opt-in; ALLOW_LOCAL_ADMIN remains the native local bypass.
  if (trustedGatewayIdentity && (!isLocal || allowLocalAuth)) {
    const writeRequest = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(event.method)
    if (writeRequest && !isSameOriginBrowserRequest(event, requestOrigin)) {
      throw createError({ status: 403, statusText: 'Admin requests must use the same origin' })
    }
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
    || isRuntimeRequest
  // Local browser QA uses an explicit opt-in and never reaches a production
  // origin. Keep the local path useful without putting a bearer token in the
  // dashboard bundle or localStorage.
  if (isLocal && allowLocalAdmin && (event.path.startsWith('/api/') || isRuntimeRequest)) {
    if (!isSameOriginBrowserRequest(event, requestOrigin)) {
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
    event.context.userEmail = `root@${requestHostname}`
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
    if (isCloudflareAccessRequestAllowed(event, requestOrigin)) {
      const mappedIdentity = mapCloudflareAccessIdentity(accessIdentity, requestHostname)
      Object.assign(
        event.context,
        mappedIdentity,
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
