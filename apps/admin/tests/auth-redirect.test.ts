import { describe, expect, it } from 'vitest'
import { ADMIN_LOGIN_PATH, adminLoginURL, DEFAULT_ADMIN_RETURN_PATH, safeAdminReturnPath, safeAuthErrorMessage } from '../app/utils/auth-redirect'

describe('admin auth redirect guards', () => {
  it('keeps same-origin admin paths and their query state', () => {
    expect(safeAdminReturnPath('/admin')).toBe('/admin')
    expect(safeAdminReturnPath('/admin/blog?draft=42#editor')).toBe('/admin/blog?draft=42#editor')
  })

  it('falls back for login, outside-admin, external, and encoded paths', () => {
    for (const candidate of [
      '/admin/login',
      '/admin/login/provider',
      '/settings',
      '//evil.example/admin',
      'https://evil.example/admin',
      '/admin/%2f%2fevil.example',
      '/admin\\evil',
    ]) {
      expect(safeAdminReturnPath(candidate)).toBe(DEFAULT_ADMIN_RETURN_PATH)
    }
  })

  it('builds the login callback without accepting a provider controlled URL', () => {
    expect(adminLoginURL('https://evil.example')).toBe(`${ADMIN_LOGIN_PATH}?redirect=%2Fadmin`)
    expect(adminLoginURL('/admin/briefing')).toBe(`${ADMIN_LOGIN_PATH}?redirect=%2Fadmin%2Fbriefing`)
  })

  it('maps provider cancellation and authorization failures to friendly messages', () => {
    expect(safeAuthErrorMessage('access_denied')).toMatch(/canceled/i)
    expect(safeAuthErrorMessage('forbidden')).toMatch(/not authorized/i)
    expect(safeAuthErrorMessage('unknown')).toMatch(/could not sign you in/i)
    expect(safeAuthErrorMessage('')).toBe('')
  })
})
