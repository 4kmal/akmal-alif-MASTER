import type { H3Event } from 'h3'
import fs from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { beforeEach, describe, expect, it } from 'vitest'
import { createPairCode, redeemPairCode } from '../server/utils/judging'

const globals = globalThis as unknown as Record<string, unknown>
globals.createError ??= (options: Record<string, unknown>) => Object.assign(new Error(String(options.statusMessage ?? 'error')), options)

interface StatementLike {
  bind: (...values: unknown[]) => StatementLike
  all: <T = Record<string, unknown>>() => Promise<{ results: T[] }>
  run: () => Promise<{ meta: { changes: number } }>
}

class SqliteStatement implements StatementLike {
  private values: unknown[] = []

  constructor(private readonly db: DatabaseSync, private readonly sql: string) {}

  bind(...values: unknown[]): StatementLike {
    this.values = values
    return this
  }

  async all<T = Record<string, unknown>>(): Promise<{ results: T[] }> {
    return { results: this.db.prepare(this.sql).all(...this.values) as T[] }
  }

  async run(): Promise<{ meta: { changes: number } }> {
    const result = this.db.prepare(this.sql).run(...this.values)
    return { meta: { changes: Number(result.changes) } }
  }
}

class SqliteD1 {
  constructor(readonly db: DatabaseSync, private readonly failBatch = false) {}

  prepare(sql: string): StatementLike {
    return new SqliteStatement(this.db, sql)
  }

  async batch(statements: StatementLike[]): Promise<unknown[]> {
    this.db.exec('BEGIN')
    try {
      const results: unknown[] = []
      for (const [index, statement] of statements.entries()) {
        results.push(await statement.run())
        if (this.failBatch && index === 0)
          throw new Error('simulated D1 batch failure')
      }
      this.db.exec('COMMIT')
      return results
    }
    catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }
}

function createDatabase(failBatch = false): SqliteD1 {
  const db = new DatabaseSync(':memory:')
  const migration = fs.readFileSync(new URL('../drizzle/0007_judging.sql', import.meta.url), 'utf8')
  for (const statement of migration.split(/--> statement-breakpoint/))
    db.exec(statement)
  return new SqliteD1(db, failBatch)
}

function event(): H3Event {
  return { context: {}, node: { req: { headers: {} } } } as unknown as H3Event
}

describe('judging device pairing', () => {
  let database: SqliteD1

  beforeEach(() => {
    database = createDatabase()
  })

  it('atomically consumes a code so only one concurrent redemption creates a device', async () => {
    const pair = await createPairCode(database as never, 'owner@example.test')
    const results = await Promise.allSettled([
      redeemPairCode(database as never, event(), pair.code, 'Judge laptop'),
      redeemPairCode(database as never, event(), pair.code, 'Judge tablet'),
    ])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1)
    const rejected = results.find(result => result.status === 'rejected')
    expect(rejected).toMatchObject({ status: 'rejected', reason: { statusCode: 410 } })
    const devices = database.db.prepare('SELECT id FROM judging_devices').all()
    expect(devices).toHaveLength(1)
    const pairRow = database.db.prepare('SELECT used_at, claimed_device_id FROM judging_pair_codes').get() as { used_at: string | null, claimed_device_id: string | null }
    expect(pairRow.used_at).toEqual(expect.any(String))
    expect(pairRow.claimed_device_id).toEqual((devices[0] as { id: string }).id)
  })

  it('rolls back the claimed code when the device/audit batch fails', async () => {
    const failing = createDatabase(true)
    const pair = await createPairCode(failing as never, 'owner@example.test')
    await expect(redeemPairCode(failing as never, event(), pair.code, 'Judge laptop')).rejects.toThrow('simulated D1 batch failure')
    const pairRow = failing.db.prepare('SELECT used_at, claimed_device_id FROM judging_pair_codes').get() as { used_at: string | null, claimed_device_id: string | null }
    expect(pairRow.used_at).toBeNull()
    expect(pairRow.claimed_device_id).toBeNull()
    expect(failing.db.prepare('SELECT id FROM judging_devices').all()).toHaveLength(0)
    expect(failing.db.prepare('SELECT id FROM judging_events').all()).toHaveLength(0)
  })
})
