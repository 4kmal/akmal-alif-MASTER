import type { VerifyResponse } from '@/types'

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
      return navigateTo('/admin')
  }
  catch {
    clearAuthSession()
    if (to.path !== '/admin/login')
      return abortNavigation()
  }
})
