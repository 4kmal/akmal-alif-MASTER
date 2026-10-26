import { exports } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'

describe('portfolio API host boundary', () => {
  it('does not accept the Sink site token for private reports on the exact go host', async () => {
    const response = await exports.default.fetch(new Request('https://go.example.test/api/portfolio/traffic', {
      headers: { Authorization: 'Bearer test-site-token' },
    }))

    expect(response.status).toBe(401)
  })
})
