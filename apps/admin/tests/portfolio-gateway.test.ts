import type { H3Event } from 'h3'
import { describe, expect, it } from 'vitest'
import {
  authoritativeRequestOrigin,
  getTrustedPortfolioGatewayIdentity,
  isSameOriginBrowserRequest,
} from '../server/utils/portfolio-gateway'

const config = {
  adminEmail: 'iamaleep@gmail.com',
  adminOrigin: 'https://www.akmalalif.com',
  gatewaySecret: 'gateway-secret',
}

function request(
  origin: string,
  headers: Record<string, string> = {},
  method = 'GET',
): H3Event {
  const url = new URL(origin)
  return {
    method,
    path: '/api/admin/overview',
    node: {
      req: {
        method,
        url: '/api/admin/overview',
        headers: {
          host: url.host,
          ...headers,
        },
        connection: {
          encrypted: url.protocol === 'https:',
        },
      },
    },
  } as unknown as H3Event
}

function ownerHeaders(overrides: Record<string, string> = {}) {
  return {
    'x-portfolio-gateway': config.gatewaySecret,
    'x-portfolio-admin-id': 'root',
    'x-portfolio-admin-email': config.adminEmail,
    ...overrides,
  }
}

function nativeRequestEvent(origin: string, nativeRequestPath: string): H3Event {
  const event = request(origin, ownerHeaders())
  event.context = {
    cloudflare: {
      request: new Request(`${origin}${nativeRequestPath}`),
    },
  }
  return event
}

describe('portfolio gateway identity boundary', () => {
  it('accepts the canonical owner markers only at the configured origin', () => {
    const event = request('https://www.akmalalif.com', ownerHeaders())
    expect(authoritativeRequestOrigin(event)).toBe('https://www.akmalalif.com')
    expect(getTrustedPortfolioGatewayIdentity(event, config)).toEqual({
      authMethod: 'portfolio-gateway',
      userID: 'root',
      userEmail: config.adminEmail,
    })
  })

  it('rejects forged gateway, principal, email, and origin values', () => {
    const cases = [
      ownerHeaders({ 'x-portfolio-gateway': 'forged' }),
      ownerHeaders({ 'x-portfolio-admin-id': 'owner' }),
      ownerHeaders({ 'x-portfolio-admin-email': 'attacker@example.com' }),
    ]
    for (const headers of cases)
      expect(getTrustedPortfolioGatewayIdentity(request('https://www.akmalalif.com', headers), config)).toBeNull()

    expect(getTrustedPortfolioGatewayIdentity(
      request('https://go.akmalalif.com', ownerHeaders()),
      config,
    )).toBeNull()
    expect(getTrustedPortfolioGatewayIdentity(
      request('https://admin.workers.dev', ownerHeaders()),
      config,
    )).toBeNull()
  })

  it('does not use forwarded host or protocol headers as the request origin', () => {
    const event = request('https://www.akmalalif.com', {
      ...ownerHeaders(),
      'x-forwarded-host': 'go.akmalalif.com',
      'x-forwarded-proto': 'http',
    })
    expect(authoritativeRequestOrigin(event)).toBe('https://www.akmalalif.com')
    expect(getTrustedPortfolioGatewayIdentity(event, config)).not.toBeNull()
  })

  it('uses the native Cloudflare request before emulated host data', () => {
    const event = nativeRequestEvent('https://www.akmalalif.com', '/api/admin/overview')
    event.node.req.headers.host = 'go.akmalalif.com'
    event.node.req.connection.encrypted = false
    expect(authoritativeRequestOrigin(event)).toBe('https://www.akmalalif.com')
    expect(getTrustedPortfolioGatewayIdentity(event, config)).not.toBeNull()
  })

  it('supports Nitro platform Cloudflare requests', () => {
    const event = request('https://www.akmalalif.com', ownerHeaders())
    event.context = {
      _platform: {
        cloudflare: {
          request: new Request('https://www.akmalalif.com/api/admin/overview'),
        },
      },
    }
    event.node.req.headers.host = 'admin.workers.dev'
    expect(authoritativeRequestOrigin(event)).toBe('https://www.akmalalif.com')
    expect(getTrustedPortfolioGatewayIdentity(event, config)).not.toBeNull()
  })

  it('requires the original origin for browser writes', () => {
    const sameOrigin = request('https://www.akmalalif.com', { origin: 'https://www.akmalalif.com' }, 'POST')
    const crossOrigin = request('https://www.akmalalif.com', { origin: 'https://evil.example' }, 'POST')
    const missingOrigin = request('https://www.akmalalif.com', {}, 'POST')
    expect(isSameOriginBrowserRequest(sameOrigin, 'https://www.akmalalif.com')).toBe(true)
    expect(isSameOriginBrowserRequest(crossOrigin, 'https://www.akmalalif.com')).toBe(false)
    expect(isSameOriginBrowserRequest(missingOrigin, 'https://www.akmalalif.com')).toBe(false)
  })
})
