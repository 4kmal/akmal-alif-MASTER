import { getRuntimeString } from '../utils/runtime-config'

export default eventHandler((event) => {
  if (event.path !== '/')
    return

  const requestURL = getRequestURL(event)
  const isLocal = ['localhost', '127.0.0.1', '[::1]'].includes(requestURL.hostname)
  const adminOrigin = getRuntimeString(event, 'portfolioAdminOrigin', 'PORTFOLIO_ADMIN_ORIGIN') || 'https://www.akmalalif.com'
  return sendRedirect(event, isLocal ? '/admin' : `${adminOrigin}/admin`, 302)
})
