import { createError, setHeader as h3SetHeader } from 'h3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('private R2 image assets', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubGlobal('createError', createError)
    vi.stubGlobal('getRouterParam', (event: { params?: Record<string, string> }, name: string) => event.params?.[name])
    vi.stubGlobal('setHeader', h3SetHeader)
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

  function eventFor(key: string, R2: { get: ReturnType<typeof vi.fn> }) {
    return {
      params: { key },
      context: { cloudflare: { env: { R2 } } },
      node: { res: { setHeader: vi.fn() } },
    } as never
  }

  it('serves a validated image key with immutable metadata', async () => {
    const object = {
      body: new ReadableStream(),
      etag: '"asset-etag"',
      httpMetadata: { contentType: 'image/webp' },
    }
    const R2 = { get: vi.fn().mockResolvedValue(object) }
    const serveImageAsset = await loadAssetHandler()
    const event = eventFor('images/owner/cover.webp', R2) as { node: { res: { setHeader: ReturnType<typeof vi.fn> } } }

    await expect(serveImageAsset(event)).resolves.toBe(object.body)
    expect(R2.get).toHaveBeenCalledWith('images/owner/cover.webp')
    expect(event.node.res.setHeader).toHaveBeenCalledWith('Content-Type', 'image/webp')
    expect(event.node.res.setHeader).toHaveBeenCalledWith('Cache-Control', 'public, max-age=31536000, immutable')
    expect(event.node.res.setHeader).toHaveBeenCalledWith('ETag', '"asset-etag"')
  })

  it('rejects non-image namespaces and malformed slug segments before R2 lookup', async () => {
    const R2 = { get: vi.fn() }
    const serveImageAsset = await loadAssetHandler()

    await expect(serveImageAsset(eventFor('backups/links.json', R2))).rejects.toMatchObject({ statusCode: 403 })
    await expect(serveImageAsset(eventFor('images/../secret.webp', R2))).rejects.toMatchObject({ statusCode: 400 })
    await expect(serveImageAsset(eventFor('images/%2e%2e/secret.webp', R2))).rejects.toMatchObject({ statusCode: 400 })
    expect(R2.get).not.toHaveBeenCalled()
  })

  it('rejects traversal segments after the validated slug', async () => {
    const R2 = { get: vi.fn() }
    const serveImageAsset = await loadAssetHandler()

    await expect(serveImageAsset(eventFor('images/owner/../../backups/secret.json', R2))).rejects.toMatchObject({
      statusCode: 400,
    })
    expect(R2.get).not.toHaveBeenCalled()
  })
})
