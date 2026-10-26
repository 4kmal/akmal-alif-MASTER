import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const drizzleMock = vi.hoisted(() => vi.fn())
vi.mock('drizzle-orm/d1', () => ({ drizzle: drizzleMock }))

describe('link listing maintenance backfill', () => {
  beforeEach(() => {
    vi.resetModules()
    drizzleMock.mockReset()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('backfills legacy expiration from effective_expires_at only when requested', async () => {
    const row = {
      id: 'link-id',
      slug: 'legacy',
      url: 'https://example.com/legacy',
      createdAt: 1,
      updatedAt: 2,
      expiration: null,
      effectiveExpiresAt: 1_900_000_000,
      comment: null,
      title: null,
      description: null,
      image: null,
      apple: null,
      google: null,
      cloaking: null,
      redirectWithQuery: null,
      proxy: null,
      password: null,
      unsafe: null,
      geo: null,
    }
    const createDatabase = () => {
      let selectNumber = 0
      const db = {
        select: vi.fn(() => {
          const values = selectNumber++ === 0 ? [{ ...row, expiration: null }] : []
          const query: Record<string, unknown> = {
            from: () => query,
            where: () => query,
            orderBy: () => query,
            limit: async () => values,
            then: (resolve: (value: unknown[]) => unknown, reject: (error: unknown) => unknown) => Promise.resolve(values).then(resolve, reject),
          }
          return query
        }),
      }
      return db
    }

    const db = createDatabase()
    drizzleMock.mockReturnValue(db)
    const { d1ListLinks } = await import('../server/services/link-store/d1')
    const event = { context: { cloudflare: { env: { DB: {} } } } } as never

    const withBackfill = await d1ListLinks(event, { limit: 10, backfillExpiration: true })
    expect(withBackfill.links[0]?.expiration).toBe(1_900_000_000)

    const secondDb = createDatabase()
    drizzleMock.mockReturnValue(secondDb)
    const withoutBackfill = await d1ListLinks(event, { limit: 10 })
    expect(withoutBackfill.links[0]?.expiration).toBeUndefined()
  })
})
