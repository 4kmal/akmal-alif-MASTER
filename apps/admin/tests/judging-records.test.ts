import type { H3Event } from 'h3'
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
        if (this.failBatch && index === 1)
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

  it('rolls back the record, mutation claim, and audit event as one transaction', async () => {
    const failing = createDatabase(true)
    const data = { name: 'Judge', date: '2026-10-28', domain: 'Domain 1', generalNotes: '', warningsAcknowledged: false }
    await expect(saveJudgingRecord(failing as never, 'judge', 0, data, 'mutation-rollback', 'owner@example.test')).rejects.toThrow('simulated D1 batch failure')
    expect(failing.db.prepare('SELECT record_key FROM judging_records').all()).toHaveLength(0)
    expect(failing.db.prepare('SELECT mutation_id FROM judging_mutations').all()).toHaveLength(0)
    expect(failing.db.prepare('SELECT id FROM judging_events').all()).toHaveLength(0)
    const recovered = await saveJudgingRecord(createDatabase() as never, 'judge', 0, data, 'mutation-rollback', 'owner@example.test')
    expect(recovered.record.version).toBe(1)
  })

  it('keeps the original evidence hash and private object key when extracted text is mirrored', async () => {
    const key = `evidence:${'a'.repeat(32)}`
    const sourceHash = 'b'.repeat(64)
    const first = await saveJudgingRecord(database as never, key, 0, {
      id: 'a'.repeat(32),
      sha256: sourceHash,
      objectKey: `judging/sdc-2026/evidence/${'a'.repeat(32)}/${sourceHash}`,
      text: '',
    }, 'evidence-source', 'owner@example.test')
    const mirrored = await saveJudgingRecord(database as never, key, first.record.version, {
      id: 'a'.repeat(32),
      sha256: sourceHash,
      text: 'extracted README text',
    }, 'evidence-text', 'sync-device')

    expect(mirrored.record.data.objectKey).toBe(first.record.data.objectKey)
    expect(mirrored.record.data.sha256).toBe(sourceHash)
    await expect(saveJudgingRecord(database as never, key, mirrored.record.version, {
      id: 'a'.repeat(32),
      sha256: 'c'.repeat(64),
      text: 'wrong text hash in source slot',
    }, 'evidence-wrong-hash', 'sync-device')).rejects.toMatchObject({ statusCode: 409 })
  })

  it('mirrors a valid JSON evidence snapshot without replacing its source hash', async () => {
    const id = 'd'.repeat(32)
    const sourceHash = 'e'.repeat(64)
    const data = {
      id,
      teamId: '01-console',
      snapshotSha: 'f'.repeat(40),
      path: 'README.md',
      kind: 'source',
      sha256: sourceHash,
      text: 'extracted README text',
      lines: 1,
      coverage: 'README',
      createdAt: '2026-10-28T00:00:00.000Z',
    }
    const writes: { key: string, body: Uint8Array }[] = []
    const bucket = {
      head: async () => null,
      put: async (key: string, body: Uint8Array) => { writes.push({ key, body }) },
    }
    const event = { context: { cloudflare: { env: { R2: bucket } } } } as unknown as H3Event

    const result = await saveJudgingRecord(database as never, `evidence:${id}`, 0, data, 'evidence-json-mirror', 'sync-device', undefined, event)
    expect(result.record.data.sha256).toBe(sourceHash)
    expect(result.record.data.jsonSha256).toEqual(expect.any(String))
    expect(result.record.data.jsonObjectKey).toBe(writes[0]?.key)
    expect(JSON.parse(new TextDecoder().decode(writes[0]!.body)).sha256).toBe(sourceHash)
  })

  it('rejects invalid evidence before the JSON mirror or database write', async () => {
    const id = '1'.repeat(32)
    let writes = 0
    const bucket = {
      head: async () => null,
      put: async () => {
        writes += 1
      },
    }
    const event = { context: { cloudflare: { env: { R2: bucket } } } } as unknown as H3Event
    const invalid = {
      id,
      teamId: '01-console',
      snapshotSha: 'invalid',
      path: 'README.md',
      kind: 'source',
      sha256: '2'.repeat(64),
      text: 'text',
      lines: 1,
      coverage: 'README',
      createdAt: '2026-10-28T00:00:00.000Z',
    }

    await expect(saveJudgingRecord(database as never, `evidence:${id}`, 0, invalid, 'evidence-invalid', 'sync-device', undefined, event)).rejects.toMatchObject({ statusCode: 400 })
    expect(writes).toBe(0)
    await expect(getJudgingRecord(database as never, `evidence:${id}`)).resolves.toBeNull()
  })
})
