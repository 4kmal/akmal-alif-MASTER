import { describe, expect, it } from 'vitest'
import {
  createPublicShortlinkUrl,
  DEFAULT_PUBLIC_SHORTLINK_ORIGIN,
  getPublicShortlinkAssetUrl,
  getPublicShortlinkHost,
  getPublicShortlinkImageUrl,
  normalizePublicShortlinkOrigin,
  PUBLIC_PORTFOLIO_ICON_PATH,
} from '../app/utils/public-shortlink'

describe('public shortlink URL adapter', () => {
  it('normalizes configured origins without carrying paths or query strings', () => {
    expect(normalizePublicShortlinkOrigin('https://go.akmalalif.com/links?source=admin')).toBe('https://go.akmalalif.com')
    expect(normalizePublicShortlinkOrigin('http://localhost:8788/')).toBe('http://localhost:8788')
    expect(normalizePublicShortlinkOrigin('javascript:alert(1)')).toBe(DEFAULT_PUBLIC_SHORTLINK_ORIGIN)
    expect(normalizePublicShortlinkOrigin('')).toBe(DEFAULT_PUBLIC_SHORTLINK_ORIGIN)
  })

  it('encodes slugs against the configured public origin', () => {
    expect(createPublicShortlinkUrl('hello world', 'https://go.akmalalif.com/')).toBe('https://go.akmalalif.com/hello%20world')
    expect(createPublicShortlinkUrl('a/b', 'http://localhost:8788')).toBe('http://localhost:8788/a%2Fb')
    expect(getPublicShortlinkHost('https://go.akmalalif.com/')).toBe('go.akmalalif.com')
  })

  it('builds public local asset URLs instead of using the admin browser origin', () => {
    expect(getPublicShortlinkAssetUrl(PUBLIC_PORTFOLIO_ICON_PATH, 'https://go.akmalalif.com')).toBe('https://go.akmalalif.com/icon/portfolio.svg')
    expect(existsSync(new URL(`../public${PUBLIC_PORTFOLIO_ICON_PATH}`, import.meta.url))).toBe(true)
  })

  it('keeps uploaded same-origin images and rejects arbitrary target hosts', () => {
    const origin = 'https://go.akmalalif.com'
    expect(getPublicShortlinkImageUrl('/_assets/images/my-link/abc123.png?cache=1#preview', origin)).toBe('https://go.akmalalif.com/_assets/images/my-link/abc123.png')
    expect(getPublicShortlinkImageUrl('https://private.example/avatar.png', origin)).toBe('https://go.akmalalif.com/icon/portfolio.svg')
    expect(getPublicShortlinkImageUrl('data:image/png;base64,private', origin)).toBe('https://go.akmalalif.com/icon/portfolio.svg')
    expect(getPublicShortlinkImageUrl(undefined, origin)).toBe('https://go.akmalalif.com/icon/portfolio.svg')
  })
})
import { existsSync } from 'node:fs'
