export const DEFAULT_PUBLIC_SHORTLINK_ORIGIN = 'https://go.akmalalif.com'
export const PUBLIC_PORTFOLIO_ICON_PATH = '/icon/ig.ico'

const SAFE_UPLOADED_IMAGE_PATH = '/_assets/images/'

function isHttpOrigin(url: URL): boolean {
  return (url.protocol === 'http:' || url.protocol === 'https:')
    && !url.username
    && !url.password
}

export function normalizePublicShortlinkOrigin(value: unknown): string {
  const candidate = typeof value === 'string' ? value.trim() : ''

  try {
    const url = new URL(candidate || DEFAULT_PUBLIC_SHORTLINK_ORIGIN)
    return isHttpOrigin(url) ? url.origin : DEFAULT_PUBLIC_SHORTLINK_ORIGIN
  }
  catch {
    return DEFAULT_PUBLIC_SHORTLINK_ORIGIN
  }
}

export function createPublicShortlinkUrl(slug: string, origin?: unknown): string {
  const normalizedOrigin = normalizePublicShortlinkOrigin(origin)
  return `${normalizedOrigin}/${encodeURIComponent(String(slug ?? '').trim())}`
}

export function getPublicShortlinkHost(origin?: unknown): string {
  return new URL(normalizePublicShortlinkOrigin(origin)).host
}

export function getPublicShortlinkAssetUrl(path: string, origin?: unknown): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  return `${normalizePublicShortlinkOrigin(origin)}${normalizedPath}`
}

export function getPublicShortlinkImageUrl(image: unknown, origin?: unknown): string {
  const normalizedOrigin = normalizePublicShortlinkOrigin(origin)
  const fallback = getPublicShortlinkAssetUrl(PUBLIC_PORTFOLIO_ICON_PATH, normalizedOrigin)

  if (typeof image !== 'string' || !image.trim())
    return fallback

  try {
    const url = new URL(image.trim(), normalizedOrigin)
    if (
      url.origin !== normalizedOrigin
      || !isHttpOrigin(url)
      || !url.pathname.startsWith(SAFE_UPLOADED_IMAGE_PATH)
      || url.pathname.length <= SAFE_UPLOADED_IMAGE_PATH.length
    ) {
      return fallback
    }

    url.search = ''
    url.hash = ''
    return url.toString()
  }
  catch {
    return fallback
  }
}
