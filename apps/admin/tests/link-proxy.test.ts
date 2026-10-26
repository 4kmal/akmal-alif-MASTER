import { describe, expect, it } from 'vitest'
import { sanitizeProxyRequestHeaders } from '../server/services/link-proxy'

describe('link proxy request headers', () => {
  it('drops credentials and forwarding headers before an upstream fetch', () => {
    const headers = sanitizeProxyRequestHeaders({
      'Accept': 'text/html',
      'Authorization': 'Bearer sink-token',
      'Cookie': 'session=private',
      'Cf-Access-Jwt-Assertion': 'access-token',
      'X-Portfolio-Gateway': 'gateway-token',
      'X-Forwarded-For': '198.51.100.4',
      'Forwarded': 'for=198.51.100.4',
      'X-Original-URL': '/private',
    })

    expect(headers.get('accept')).toBe('text/html')
    expect(headers.get('authorization')).toBeNull()
    expect(headers.get('cookie')).toBeNull()
    expect(headers.get('cf-access-jwt-assertion')).toBeNull()
    expect(headers.get('x-portfolio-gateway')).toBeNull()
    expect(headers.get('x-forwarded-for')).toBeNull()
    expect(headers.get('forwarded')).toBeNull()
    expect(headers.get('x-original-url')).toBeNull()
  })
})
