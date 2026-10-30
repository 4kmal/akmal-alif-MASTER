export function isLocalAdminHostname(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]'
}

export function isWebAdminHostname(hostname: string, adminOrigin: string): boolean {
  if (isLocalAdminHostname(hostname))
    return true

  try {
    return hostname === new URL(adminOrigin).hostname
  }
  catch {
    return hostname === 'www.akmalalif.com'
  }
}

export function isAuthApiPath(api: string): boolean {
  const path = api.split('?', 1)[0] ?? ''
  return path === '/api/auth' || path.startsWith('/api/auth/')
}

function isLocalGatewayOrigin(hostname: string, adminOrigin: string, browserOrigin?: string): boolean {
  if (!isLocalAdminHostname(hostname))
    return false

  try {
    const configured = new URL(adminOrigin)
    if (!isLocalAdminHostname(configured.hostname) || configured.hostname !== hostname)
      return false
    if (!browserOrigin)
      return true
    return new URL(browserOrigin).origin === configured.origin
  }
  catch {
    return false
  }
}

export function getAdminApiPath(
  api: string,
  hostname: string,
  adminOrigin: string,
  localGateway = false,
  browserOrigin?: string,
): string {
  if (isAuthApiPath(api))
    return api

  if (
    isWebAdminHostname(hostname, adminOrigin)
    && (!isLocalAdminHostname(hostname) || (localGateway && isLocalGatewayOrigin(hostname, adminOrigin, browserOrigin)))
    && api.startsWith('/api/')
    && !api.startsWith('/api/admin/')
  ) {
    return `/api/admin/sink${api.slice('/api'.length)}`
  }

  return api
}
