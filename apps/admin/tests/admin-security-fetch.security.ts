import type { H3Event } from 'h3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchPageMarkdown } from '../server/utils/markdown'
import { safePublicFetch } from '../server/utils/safe-public-fetch'

function createEvent(): H3Event {
  return {
    node: {
      req: { headers: {} },
    },
  } as H3Event
}

function createAI(): Ai {
  return {
    toMarkdown: vi.fn(),
  } as unknown as Ai
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('safe public fetch', () => {
  it('blocks a redirect to a private address and closes the discarded body', async () => {
    const cancel = vi.fn()
    const body = new ReadableStream<Uint8Array>({ cancel })
    const fetchMock = vi.fn().mockResolvedValue(new Response(body, {
      status: 302,
      headers: { location: 'http://127.0.0.1/internal' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(safePublicFetch('https://example.com/start')).rejects.toThrow('Unsafe public fetch redirect')
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('validates and follows a bounded relative redirect', async () => {
    const cancel = vi.fn()
    const redirectBody = new ReadableStream<Uint8Array>({ cancel })
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(redirectBody, {
        status: 302,
        headers: { location: '/next' },
      }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const response = await safePublicFetch('https://example.com/start')

    expect(await response.text()).toBe('ok')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ redirect: 'manual' })
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe('https://example.com/next')
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('keeps AI metadata fetches behind the same redirect guard', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, {
      status: 302,
      headers: { location: 'http://169.254.169.254/latest/meta-data' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchPageMarkdown(createEvent(), 'https://example.com/page', createAI())).resolves.toBeNull()
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('stops a redirect loop at the configured hop limit', async () => {
    const fetchMock = vi.fn().mockImplementation(() => new Response(null, {
      status: 302,
      headers: { location: '/next' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(safePublicFetch('https://example.com/start', { maxRedirects: 2 })).rejects.toThrow('Too many public fetch redirects')
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })
})
