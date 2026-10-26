import { getAdminBoundaryDecision } from '../utils/admin-boundary'

export default eventHandler((event) => {
  const { hostname } = getRequestURL(event)
  const config = useRuntimeConfig(event)
  const decision = getAdminBoundaryDecision({
    hostname,
    path: event.path,
    adminOrigin: config.portfolioAdminOrigin,
    shortlinkOrigin: config.shortlinkOrigin,
  })

  if (decision.type === 'redirect')
    return sendRedirect(event, decision.location, 302)
  if (decision.type === 'block')
    throw createError({ status: decision.status, statusText: decision.statusText })
})
