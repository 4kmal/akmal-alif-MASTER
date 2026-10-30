import type { VerifyResponse } from '@/types'
import { adminLoginURL, safeAdminReturnPath } from '@/utils/auth-redirect'

// Only a definite signed-out answer skips the owner check, so local admin
// modes without BetterAuth keep their existing redirect behavior.
async function isSignedOutOfBetterAuth(): Promise<boolean> {
  try {
    const { data, error } = await useBetterAuth().getSession()
    return !error && data === null
  }
  catch {
    return false
  }
}

export default defineNuxtRouteMiddleware(async (to) => {
  if (import.meta.server)
    return

  if (!to.path.startsWith('/admin'))
    return

  const { setAuthSession, clearAuthSession } = useAuthSession()

  // The public login page would otherwise log a 401 from the owner check.
  if (to.path === '/admin/login' && await isSignedOutOfBetterAuth()) {
    clearAuthSession()
    return
  }

  try {
    const response = await useAPI<VerifyResponse>('/api/verify')
    setAuthSession(response)

    if (to.path === '/admin/login')
      return navigateTo(safeAdminReturnPath(to.query.redirect))
  }
  catch {
    clearAuthSession()
    if (to.path !== '/admin/login')
      return navigateTo(adminLoginURL(to.fullPath))
  }
})
