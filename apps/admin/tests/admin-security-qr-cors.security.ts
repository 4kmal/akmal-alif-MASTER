import { createError, getRequestURL as h3GetRequestURL, setHeader as h3SetHeader } from 'h3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('public QR image CORS', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubGlobal('createError', createError)
    vi.stubGlobal('getRouterParam', (event: { params?: Record<string, string> }, name: string) => event.params?.[name])
    vi.stubGlobal('setHeader', h3SetHeader)
    vi.stubGlobal('getRequestURL', h3GetRequestURL)
    vi.stubGlobal('requireR2Bucket', (env: { R2: unknown }) => env.R2)
    vi.stubGlobal('useAppConfig', () => ({
      slugRegex: '^[a-z0-9]+(?:-[a-z0-9]+)*$',
      reserveSlug: [],
    }))
    vi.stubGlobal('useRuntimeConfig', () => ({
      public: {
        slugDefaultLength: 10,
        maxUrlLength: 2_000,
      },
    }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  async function loadAssetHandler() {
    return (await import('../server/utils/image-asset')).serveImageAsset
  }

  function eventFor(path: string, origin: string) {
    const R2 = {
      get: vi.fn().mockResolvedValue({
        body: new ReadableStream(),
        etag: '"qr-etag"',
        httpMetadata: { contentType: 'image/svg+xml' },
      }),
    }
    const event = {
      params: { key: 'images/owner/abcdefghij.webp' },
      context: {
        cloudflare: {
          env: {
            R2,
            PORTFOLIO_ADMIN_ORIGIN: 'https://www.akmalalif.com',
          },
        },
      },
      path,
      node: {
        req: { url: path, headers: { host: 'go.akmalalif.com', origin } },
        res: { setHeader: vi.fn() },
      },
    }
    return { event, R2 }
  }

  it('allows only the canonical admin origin on public image assets', async () => {
    const serveImageAsset = await loadAssetHandler()
    const { event } = eventFor('/_assets/images/owner/abcdefghij.webp', 'https://www.akmalalif.com/')

    await serveImageAsset(event as never)

    expect(event.node.res.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Origin', 'https://www.akmalalif.com')
    expect(event.node.res.setHeader).toHaveBeenCalledWith('Vary', 'Origin')
  })

  it('does not grant CORS to another origin or the private asset route', async () => {
    const serveImageAsset = await loadAssetHandler()
    const disallowed = eventFor('/_assets/images/owner/abcdefghij.webp', 'https://evil.example')
    const privateRoute = eventFor('/admin/_assets/images/owner/abcdefghij.webp', 'https://www.akmalalif.com')

    await serveImageAsset(disallowed.event as never)
    await serveImageAsset(privateRoute.event as never)

    expect(disallowed.event.node.res.setHeader).not.toHaveBeenCalledWith('Access-Control-Allow-Origin', expect.anything())
    expect(privateRoute.event.node.res.setHeader).not.toHaveBeenCalledWith('Access-Control-Allow-Origin', expect.anything())
  })
})
