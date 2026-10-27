import type { H3Event } from 'h3'
import fs from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { beforeEach, describe, expect, it } from 'vitest'
import { judgingState, saveJudgingRecord } from '../server/utils/judging'

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

function cursorEvent(cursor: number): H3Event {
  return {
    path: `/api/admin/judging/sdc-2026/state?cursor=${cursor}`,
    node: { req: { url: `/api/admin/judging/sdc-2026/state?cursor=${cursor}`, headers: {} } },
    context: {},
  } as unknown as H3Event
}

describe('judging state cursor', () => {
  let database: SqliteD1

  beforeEach(() => {
    database = createDatabase()
  })

  it('returns a monotonic audit cursor and only records changed after the cursor', async () => {
    const first = await saveJudgingRecord(database as never, 'judge', 0, { name: 'A' }, 'state-one', 'owner')
    const initial = await judgingState(database as never)
    expect(initial.records).toHaveLength(1)
    expect(initial.cursor).toBeGreaterThan(0)

    const second = await saveJudgingRecord(database as never, 'judge', first.record.version, { name: 'B' }, 'state-two', 'owner')
    const delta = await judgingState(database as never, cursorEvent(initial.cursor))
    expect(delta.cursor).toBeGreaterThan(initial.cursor)
    expect(delta.records).toEqual([second.record])
  })

  it('rejects invalid or ahead cursors', async () => {
    await expect(judgingState(database as never, cursorEvent(-1))).rejects.toMatchObject({ statusCode: 400 })
    const initial = await judgingState(database as never)
    await expect(judgingState(database as never, cursorEvent(initial.cursor + 1))).rejects.toMatchObject({ statusCode: 400 })
  })

  it('chunks changed record keys below D1 variable limits', async () => {
    const count = 125
    for (let index = 0; index < count; index++) {
      const id = index.toString(16).padStart(32, '0')
      await saveJudgingRecord(database as never, `evidence:${id}`, 0, { index }, `bulk-${index}`, 'owner')
    }

    const delta = await judgingState(database as never, cursorEvent(0))
    expect(delta.records).toHaveLength(count)
    expect(delta.records[0]?.key).toBe(`evidence:${'0'.repeat(32)}`)
    expect(delta.records.at(-1)?.key).toBe(`evidence:${(count - 1).toString(16).padStart(32, '0')}`)
  })
})
