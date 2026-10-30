export const ADMIN_LOGIN_PATH = '/admin/login'
export const DEFAULT_ADMIN_RETURN_PATH = '/admin'

const ADMIN_ORIGIN = 'https://admin.invalid'

function hasControlCharacters(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0)
    if (code <= 0x1F || code === 0x7F)
      return true
  }
  return false
}

export function safeAdminReturnPath(value: unknown): string {
  if (typeof value !== 'string')
    return DEFAULT_ADMIN_RETURN_PATH

  const candidate = value.trim()
  if (
    !candidate
    || candidate.length > 2048
    || !candidate.startsWith('/')
    || candidate.startsWith('//')
    || candidate.includes('\\')
    || candidate.includes('%')
    || hasControlCharacters(candidate)
  ) {
    return DEFAULT_ADMIN_RETURN_PATH
  }

  try {
    const parsed = new URL(candidate, ADMIN_ORIGIN)
    if (parsed.origin !== ADMIN_ORIGIN)
      return DEFAULT_ADMIN_RETURN_PATH

    const pathname = parsed.pathname
    if (
      !(pathname === '/admin' || pathname.startsWith('/admin/'))
      || pathname === ADMIN_LOGIN_PATH
      || pathname.startsWith(`${ADMIN_LOGIN_PATH}/`)
      || pathname.includes('//')
    ) {
      return DEFAULT_ADMIN_RETURN_PATH
    }

    return `${pathname}${parsed.search}${parsed.hash}`
  }
  catch {
    return DEFAULT_ADMIN_RETURN_PATH
  }
}

export function adminLoginURL(returnPath: unknown): string {
  const safePath = safeAdminReturnPath(returnPath)
  const query = new URLSearchParams({ redirect: safePath })
  return `${ADMIN_LOGIN_PATH}?${query.toString()}`
}

export function safeAuthErrorMessage(value: unknown): string {
  if (typeof value !== 'string' || !value.trim())
    return ''

  const error = value.trim().toLowerCase()
  if (error.includes('cancel') || error.includes('denied') || error.includes('closed'))
    return 'Sign-in was canceled. Choose a provider to try again.'
  if (error.includes('forbidden') || error.includes('unauthorized') || error.includes('not_allowed'))
    return 'That account is not authorized for the admin workspace.'
  return 'We could not sign you in. Check the provider account and try again.'
}
