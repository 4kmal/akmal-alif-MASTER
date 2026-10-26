import { describe, expect, it } from 'vitest'
import { getAdminBoundaryDecision } from '../server/utils/admin-boundary'

const origins = {
  adminOrigin: 'https://www.akmalalif.com',
  shortlinkOrigin: 'https://go.akmalalif.com',
}

describe('admin host boundary', () => {
  it('redirects dashboard routes from the shortlink host to the portfolio host', () => {
    expect(getAdminBoundaryDecision({ ...origins, hostname: 'go.akmalalif.com', path: '/admin/briefing' })).toEqual({
      type: 'redirect',
      location: 'https://www.akmalalif.com/admin/briefing',
    })
    expect(getAdminBoundaryDecision({ ...origins, hostname: 'go.akmalalif.com', path: '/dashboard' })).toEqual({
      type: 'redirect',
      location: 'https://www.akmalalif.com/admin',
    })
  })

  it('blocks private Nuxt assets on the shortlink host', () => {
    expect(getAdminBoundaryDecision({ ...origins, hostname: 'go.akmalalif.com', path: '/_nuxt/entry.js' })).toEqual({
      type: 'block',
      status: 404,
      statusText: 'Admin assets are private to the portfolio host.',
    })
    expect(getAdminBoundaryDecision({ ...origins, hostname: 'go.akmalalif.com', path: '/_assets/backups/test.zip' })).toEqual({
      type: 'block',
      status: 404,
      statusText: 'Admin assets are private to the portfolio host.',
    })
    expect(getAdminBoundaryDecision({ ...origins, hostname: 'go.akmalalif.com', path: '/_assets/images/test/file.png' })).toEqual({ type: 'allow' })
  })

  it('allows public shortlink paths and portfolio-host requests', () => {
    expect(getAdminBoundaryDecision({ ...origins, hostname: 'go.akmalalif.com', path: '/abc123' })).toEqual({ type: 'allow' })
    expect(getAdminBoundaryDecision({ ...origins, hostname: 'www.akmalalif.com', path: '/admin/briefing' })).toEqual({ type: 'allow' })
  })
})
