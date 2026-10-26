import type { SQLInputValue } from 'node:sqlite'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { persistLinkHealth, readLinkHealth } from '../server/utils/link-health-state'

describe('retained destination health', () => {
  let database: DatabaseSync
  const now = Date.parse('2026-10-26T10:00:00Z')

  beforeEach(() => {
    database = new DatabaseSync(':memory:')
    database.exec(`
      CREATE TABLE links (slug TEXT PRIMARY KEY);
      CREATE TABLE portfolio_analytics_state (key TEXT PRIMARY KEY, value TEXT, updated_at INTEGER);
      INSERT INTO links VALUES ('working'), ('broken');
    `)
  })

  afterEach(() => database.close())

  function db() {
    return {
      prepare(query: string) {
        let parameters: SQLInputValue[] = []
        return {
          bind(...values: unknown[]) {
            parameters = values as SQLInputValue[]
            return this
          },
          async first<T extends Record<string, unknown>>() {
            return database.prepare(query).get(...parameters) as T | null
          },
          run() {
            return database.prepare(query).run(...parameters)
          },
        }
      },
      async batch(statements: unknown[]) {
        return statements.map(statement => (statement as { run: () => unknown }).run())
      },
    }
  }

  function result(slug: string, ok: boolean, at = now) {
    return { slug, ok, status: ok ? 200 : 503, checkedAt: new Date(at).toISOString(), duration: 12, url: 'https://example.com/?private=omitted' }
  }

  it('retains recent checks without destination URLs or errors', async () => {
    await persistLinkHealth(db(), [result('working', true), result('broken', false)])
    expect(await readLinkHealth(db(), now)).toEqual({ checked: 2, broken: 1, lastCheckedAt: new Date(now).toISOString() })
    const stored = database.prepare('SELECT value FROM portfolio_analytics_state').all()
    expect(stored.every(row => !String(row.value).includes('private'))).toBe(true)
  })

  it('ignores deleted links, old results and out-of-order check completion', async () => {
    await persistLinkHealth(db(), [result('working', true), result('broken', false)])
    await persistLinkHealth(db(), [result('working', false, now - 1000)])
    database.prepare('DELETE FROM links WHERE slug = ?').run('broken')
    expect((await readLinkHealth(db(), now)).broken).toBe(0)
    expect((await readLinkHealth(db(), now + 8 * 24 * 60 * 60 * 1000)).checked).toBe(0)
  })
})
