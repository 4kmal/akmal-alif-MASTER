import type { H3Event } from 'h3'
import { timingSafeEqual } from 'node:crypto'
import { getHeader } from 'h3'

interface PortfolioGatewayConfig {
  adminEmail: string
  adminOrigin: string
  gatewaySecret: string
}

export interface PortfolioGatewayIdentity {
  authMethod: 'portfolio-gateway'
  userID: 'root'
  userEmail: string
}

function normalizeOrigin(value: string): string {
  try {
    const parsed = new URL(value.trim())
    if ((parsed.protocol !== 'https:' && parsed.protocol !== 'http:') || parsed.username || parsed.password)
      return ''
    return parsed.origin
  }
  catch {
    return ''
  }
}

export function authoritativeRequestOrigin(event: H3Event): string {
  const nativeContext = event.context as (typeof event.context & {
    cloudflare?: { request?: Request }
    _platform?: { cloudflare?: { request?: Request } }
  }) | undefined
  const nativeRequest = nativeContext?.cloudflare?.request ?? nativeContext?._platform?.cloudflare?.request
  if (nativeRequest?.url)
    return normalizeOrigin(nativeRequest.url)

  const webRequest = (event as H3Event & { web?: { request?: Request } }).web?.request
  if (webRequest?.url)
    return normalizeOrigin(webRequest.url)

  const nodeRequest = event.node.req as typeof event.node.req & {
    url?: string
    connection?: { encrypted?: boolean }
  }
  if (typeof nodeRequest.url === 'string' && /^https?:\/\//i.test(nodeRequest.url))
    return normalizeOrigin(nodeRequest.url)

  const host = getHeader(event, 'host')?.trim()
  if (!host || /[\s,]/.test(host))
    return ''

  const protocol = nodeRequest.connection?.encrypted ? 'https' : 'http'
  return normalizeOrigin(`${protocol}://${host}`)
}

export function isPortfolioGatewayTokenValid(event: H3Event, secret: string): boolean {
  const provided = getHeader(event, 'x-portfolio-gateway') || ''
  if (!provided || !secret)
    return false

  const encoder = new TextEncoder()
  const left = encoder.encode(provided)
  const right = encoder.encode(secret)
  return left.length === right.length && timingSafeEqual(left, right)
}

export function getTrustedPortfolioGatewayIdentity(
  event: H3Event,
  config: PortfolioGatewayConfig,
): PortfolioGatewayIdentity | null {
  const expectedOrigin = normalizeOrigin(config.adminOrigin)
  const adminEmail = config.adminEmail.trim()
  if (!expectedOrigin || !adminEmail || !isPortfolioGatewayTokenValid(event, config.gatewaySecret))
    return null
  if (authoritativeRequestOrigin(event) !== expectedOrigin)
    return null
  if ((getHeader(event, 'x-portfolio-admin-id') || '') !== 'root')
    return null

  const forwardedEmail = (getHeader(event, 'x-portfolio-admin-email') || '').toLowerCase()
  if (!forwardedEmail || forwardedEmail !== adminEmail.toLowerCase())
    return null

  return {
    authMethod: 'portfolio-gateway',
    userID: 'root',
    userEmail: adminEmail,
  }
}

export function isSameOriginBrowserRequest(event: H3Event, requestOrigin: string): boolean {
  if (getHeader(event, 'Sec-Fetch-Site') === 'cross-site')
    return false

  const origin = getHeader(event, 'Origin')
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(event.method))
    return origin === requestOrigin

  return !origin || origin === requestOrigin
}

export function isLocalHostname(hostname: string): boolean {
  return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(hostname)
}

export function normalizePortfolioOrigin(value: string): string {
  return normalizeOrigin(value)
}
