import fs from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { beforeEach, describe, expect, it } from 'vitest'
import { getJudgingRecord, saveJudgingRecord } from '../server/utils/judging'

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
  constructor(readonly db: DatabaseSync) {}

  prepare(sql: string): StatementLike {
    return new SqliteStatement(this.db, sql)
  }

  async batch(statements: StatementLike[]): Promise<unknown[]> {
    this.db.exec('BEGIN')
    try {
      const results: unknown[] = []
      for (const statement of statements)
        results.push(await statement.run())
      this.db.exec('COMMIT')
      return results
    }
    catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }
}

function createDatabase(): SqliteD1 {
  const db = new DatabaseSync(':memory:')
  const migration = fs.readFileSync(new URL('../drizzle/0007_judging.sql', import.meta.url), 'utf8')
  for (const statement of migration.split(/--> statement-breakpoint/))
    db.exec(statement)
  return new SqliteD1(db)
}

describe('judging record CAS and idempotency', () => {
  let database: SqliteD1

  beforeEach(() => {
    database = createDatabase()
  })

  it('stores a first write, replays the same mutation, and rejects a reused mutation id', async () => {
    const data = { name: 'Judge', date: '2026-10-28', domain: 'Domain 1', generalNotes: '', warningsAcknowledged: false }
    const first = await saveJudgingRecord(database as never, 'judge', 0, data, 'mutation-one', 'owner@example.test')
    expect(first.record.version).toBe(1)
    await expect(saveJudgingRecord(database as never, 'judge', 0, { ...data, name: 'Changed' }, 'mutation-one', 'owner@example.test')).rejects.toMatchObject({ statusCode: 409 })
    const replay = await saveJudgingRecord(database as never, 'judge', 0, data, 'mutation-one', 'owner@example.test')
    expect(replay.idempotent).toBe(true)
    expect(replay.record).toEqual(first.record)
  })

  it('allows one concurrent CAS update and reports the current record to the loser', async () => {
    const initial = { name: 'Judge', date: '2026-10-28', domain: 'Domain 1', generalNotes: '', warningsAcknowledged: false }
    await saveJudgingRecord(database as never, 'judge', 0, initial, 'mutation-zero', 'owner@example.test')
    const results = await Promise.allSettled([
      saveJudgingRecord(database as never, 'judge', 1, { ...initial, name: 'A' }, 'mutation-a', 'owner@example.test'),
      saveJudgingRecord(database as never, 'judge', 1, { ...initial, name: 'B' }, 'mutation-b', 'owner@example.test'),
    ])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    const rejected = results.find(result => result.status === 'rejected')
    expect(rejected).toMatchObject({ status: 'rejected', reason: { statusCode: 409, data: { current: { version: 2 } } } })
    await expect(getJudgingRecord(database as never, 'judge')).resolves.toMatchObject({ version: 2 })
  })
})
