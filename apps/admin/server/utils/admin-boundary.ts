export type AdminBoundaryDecision
  = { type: 'allow' }
    | { type: 'redirect', location: string }
    | { type: 'block', status: 404, statusText: string }

interface AdminBoundaryInput {
  hostname: string
  path: string
  adminOrigin: string
  shortlinkOrigin: string
}

function originHostname(origin: string): string {
  try {
    return new URL(origin).hostname
  }
  catch {
    return ''
  }
}

export function getAdminBoundaryDecision({ hostname, path, adminOrigin, shortlinkOrigin }: AdminBoundaryInput): AdminBoundaryDecision {
  const adminHost = originHostname(adminOrigin)
  const shortlinkHost = originHostname(shortlinkOrigin)

  if (!shortlinkHost || hostname !== shortlinkHost || hostname === adminHost)
    return { type: 'allow' }

  if (path === '/dashboard' || path.startsWith('/dashboard/')) {
    return { type: 'redirect', location: `${adminOrigin}/admin${path.slice('/dashboard'.length)}` }
  }

  if (path === '/admin' || path.startsWith('/admin/')) {
    return { type: 'redirect', location: `${adminOrigin}${path}` }
  }

  // Public shortlink previews may reference image objects, but the go host
  // must never expose backup or arbitrary R2 keys.
  if (path.startsWith('/_assets/images/'))
    return { type: 'allow' }

  if (path.startsWith('/_nuxt/') || path.startsWith('/_i18n/') || path.startsWith('/_assets/')) {
    return { type: 'block', status: 404, statusText: 'Admin assets are private to the portfolio host.' }
  }

  return { type: 'allow' }
}
