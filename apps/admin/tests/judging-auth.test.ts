import type { H3Event } from 'h3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { requireJudgingOwner, requireJudgingPairRequest } from '../server/utils/judging'

const createError = (options: Record<string, unknown>) => Object.assign(new Error(String(options.statusText ?? options.statusMessage ?? 'error')), options)

function requestEvent(path = '/api/admin/judging/sdc-2026/state', headers: Record<string, string> = {}): H3Event {
  return {
    path,
    method: 'GET',
    context: {},
    node: { req: { headers: { 'host': 'admin.example', 'x-forwarded-proto': 'https', ...headers }, url: new URL(path, 'https://admin.example').toString() } },
  } as unknown as H3Event
}

describe('judging owner authentication boundary', () => {
  beforeEach(() => {
    vi.stubGlobal('eventHandler', (handler: unknown) => handler)
    vi.stubGlobal('createError', createError)
    vi.stubGlobal('getHeader', (event: H3Event, name: string) => {
      const headers = (event.node.req as unknown as { headers: Record<string, string> }).headers
      return headers[name.toLowerCase()] ?? headers[name]
    })
    vi.stubGlobal('getRequestURL', () => new URL('https://admin.example/api/admin/judging/sdc-2026/state'))
    vi.stubGlobal('setResponseHeader', () => undefined)
    vi.stubGlobal('useRuntimeConfig', () => ({
      adminEmail: 'iamaleep@gmail.com',
      portfolioAdminOrigin: 'https://admin.example',
      portfolioGatewayToken: 'gateway-secret',
      allowLocalAdmin: false,
    }))
    vi.stubGlobal('isCloudflareAccessRequestAllowed', () => true)
    vi.stubGlobal('mapCloudflareAccessIdentity', () => ({ authMethod: 'access-user', userID: 'owner', userEmail: 'iamaleep@gmail.com' }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('keeps a verified Access owner as access-user when the trusted gateway is present', async () => {
    vi.stubGlobal('verifyCloudflareAccess', vi.fn().mockResolvedValue({ kind: 'user', userID: 'owner', userEmail: 'iamaleep@gmail.com' }))
    const { default: auth } = await import('../server/middleware/2.auth')
    const event = requestEvent(undefined, { 'x-portfolio-gateway': 'gateway-secret' })
    await auth(event)
    expect(event.context.authMethod).toBe('access-user')
    expect(requireJudgingOwner(event).actor).toBe('iamaleep@gmail.com')
  })

  it('rejects gateway-only and Access service identities for owner routes', async () => {
    const { default: auth } = await import('../server/middleware/2.auth')
    const gatewayOnly = requestEvent(undefined, { 'x-portfolio-gateway': 'gateway-secret' })
    vi.stubGlobal('verifyCloudflareAccess', vi.fn().mockResolvedValue(null))
    await expect(auth(gatewayOnly)).rejects.toMatchObject({ status: 401 })

    const sink = requestEvent()
    vi.stubGlobal('verifyCloudflareAccess', vi.fn().mockResolvedValue({ kind: 'service' }))
    await expect(auth(sink)).rejects.toMatchObject({ status: 401 })
  })

  it('requires a trusted gateway or exact canonical origin for pair redemption', () => {
    const direct = requestEvent('/api/judging-sync/pair', {
      'origin': 'https://worker.dev',
      'x-judging-pair-ip': 'spoofed-client',
    })
    expect(() => requireJudgingPairRequest(direct)).toThrow(/trusted judging gateway|canonical admin origin/)

    const gateway = requestEvent('/api/judging-sync/pair', {
      'x-portfolio-gateway': 'gateway-secret',
      'x-judging-pair-ip': '198.51.100.8',
    })
    requireJudgingPairRequest(gateway)
    expect(gateway.context.judgingPairGateway).toBe(true)

    const canonical = requestEvent('/api/judging-sync/pair', {
      'origin': 'https://admin.example',
      'sec-fetch-site': 'same-origin',
    })
    requireJudgingPairRequest(canonical)
    expect(canonical.context.judgingPairGateway).toBe(false)
  })
})
