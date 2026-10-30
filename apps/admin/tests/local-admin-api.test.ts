import { describe, expect, it } from 'vitest'
import { getAdminApiPath, isAuthApiPath, isLocalAdminHostname, isWebAdminHostname } from '../app/utils/api-path'

describe('local owner API routing', () => {
  it('keeps native Sink CRUD paths on an explicitly local origin', () => {
    expect(isLocalAdminHostname('127.0.0.1')).toBe(true)
    expect(isWebAdminHostname('127.0.0.1', 'https://www.akmalalif.com')).toBe(true)
    expect(getAdminApiPath('/api/link/create', '127.0.0.1', 'https://www.akmalalif.com')).toBe('/api/link/create')
    expect(getAdminApiPath('/api/link/list', 'localhost', 'http://localhost:7466')).toBe('/api/link/list')
  })

  it('keeps the owner gateway adapter for the production portfolio origin', () => {
    expect(getAdminApiPath('/api/link/create', 'www.akmalalif.com', 'https://www.akmalalif.com')).toBe('/api/admin/sink/link/create')
    expect(getAdminApiPath('/api/admin/overview', 'www.akmalalif.com', 'https://www.akmalalif.com')).toBe('/api/admin/overview')
  })

  it('keeps BetterAuth on the canonical same-origin auth route', () => {
    expect(isAuthApiPath('/api/auth')).toBe(true)
    expect(isAuthApiPath('/api/auth/sign-in/social')).toBe(true)
    expect(isAuthApiPath('/api/authentication')).toBe(false)
    expect(getAdminApiPath('/api/auth/get-session', 'www.akmalalif.com', 'https://www.akmalalif.com')).toBe('/api/auth/get-session')
  })
})
