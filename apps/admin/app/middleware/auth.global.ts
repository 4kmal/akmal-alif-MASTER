import type { VerifyResponse } from '@/types'
import { adminLoginURL, safeAdminReturnPath } from '@/utils/auth-redirect'

export default defineNuxtRouteMiddleware(async (to) => {
  if (import.meta.server)
    return

  if (!to.path.startsWith('/admin'))
    return

  const { setAuthSession, clearAuthSession } = useAuthSession()

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
