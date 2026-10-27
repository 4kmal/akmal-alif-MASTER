import type { H3Event } from 'h3'
import fs from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { beforeEach, describe, expect, it } from 'vitest'
import { buildAssessmentInput, runJudgingJob } from '../server/utils/judging-ai'

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
  readonly queries: string[] = []

  constructor(readonly db: DatabaseSync) {}

  prepare(sql: string): StatementLike {
    this.queries.push(sql)
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

function insertRecord(database: SqliteD1, key: string, data: Record<string, unknown>): void {
  database.db.prepare(`INSERT INTO judging_records
    (event_id, record_key, version, data_json, updated_at, updated_by)
    VALUES (?, ?, ?, ?, ?, ?)`)
    .run('sdc-2026', key, 1, JSON.stringify(data), '2026-10-28T00:00:00.000Z', 'test')
}

function insertJob(database: SqliteD1, id: string, teamId: string, inputHash: string): void {
  database.db.prepare(`INSERT INTO judging_jobs
    (id, event_id, team_id, status, requested_by, device_id, input_hash, progress, draft_json, error, attempts, cancel_requested, created_at, updated_at, started_at, finished_at)
    VALUES (?, ?, ?, 'queued', ?, NULL, ?, 0, NULL, NULL, 0, 0, ?, ?, NULL, NULL)`)
    .run(id, 'sdc-2026', teamId, 'owner@example.test', inputHash, '2026-10-28T00:00:00.000Z', '2026-10-28T00:00:00.000Z')
}

function responseFor(evidenceId: string): string {
  return JSON.stringify({
    strengths: [{ text: 'The supplied source describes the feature.', citations: [{ evidenceId, lineStart: 1, lineEnd: 1 }] }],
    concerns: [],
    features: ['profiles', 'trends', 'matching', 'reskilling', 'sdg', 'scenarios'].map(feature => ({
      feature,
      proposal: 'unverified',
      demo: 'unverified',
      citations: [{ evidenceId, lineStart: 1, lineEnd: 1 }],
    })),
    scores: [
      { criterion: 'innovation', score: null, citations: [] },
      { criterion: 'problemSolutionFit', score: null, citations: [] },
      { criterion: 'feasibility', score: null, citations: [] },
      { criterion: 'clarity', score: null, citations: [] },
    ],
    citations: [],
  })
}

describe('judging AI runtime contract', () => {
  let database: SqliteD1

  beforeEach(() => {
    database = createDatabase()
  })

  it('loads only the requested team evidence and marks declared cross-team evidence missing', async () => {
    const ownEvidenceId = 'a'.repeat(32)
    const foreignEvidenceId = 'b'.repeat(32)
    insertRecord(database, 'intake:01-console', {
      teamId: '01-console',
      repoUrl: 'https://github.com/example/repo',
      branch: 'main',
      sha: 'c'.repeat(40),
      retrievedAt: '2026-10-28T00:00:00.000Z',
      snapshotPath: 'snapshots/01-console',
      verified: true,
      evidenceIds: [ownEvidenceId, foreignEvidenceId],
      artifacts: [],
      links: [],
      demoParity: 'unverified',
      issues: [],
      declaredDemoCommits: [],
      previousSnapshots: [],
    })
    insertRecord(database, `evidence:${ownEvidenceId}`, {
      id: ownEvidenceId,
      teamId: '01-console',
      snapshotSha: 'c'.repeat(40),
      path: 'README.md',
      kind: 'source',
      sha256: 'd'.repeat(64),
      text: 'Own team evidence.',
      lines: 1,
      coverage: 'README',
      createdAt: '2026-10-28T00:00:00.000Z',
    })
    insertRecord(database, `evidence:${foreignEvidenceId}`, {
      id: foreignEvidenceId,
      teamId: '02-ctrl-ai',
      snapshotSha: 'e'.repeat(40),
      path: 'README.md',
      kind: 'source',
      sha256: 'f'.repeat(64),
      text: 'Foreign team evidence.',
      lines: 1,
      coverage: 'README',
      createdAt: '2026-10-28T00:00:00.000Z',
    })

    const input = await buildAssessmentInput(database as never, '01-console')

    expect(input.evidence.map(evidence => evidence.id)).toEqual([ownEvidenceId])
    expect(input.evidence.some(evidence => evidence.id === foreignEvidenceId)).toBe(false)
    expect(input.missing).toContain(`evidence:${foreignEvidenceId}`)
    const recordQueries = database.queries.filter(query => query.includes('FROM judging_records'))
    expect(recordQueries).toHaveLength(2)
    expect(recordQueries.some(query => query.includes('record_key IN (?, ?)'))).toBe(true)
    expect(recordQueries.some(query => query.includes('json_extract(data_json, \'$.teamId\') = ?'))).toBe(true)
  })

  it('uses a bounded JSON-generation request and leaves the next job queued for a fresh poll', async () => {
    const evidenceId = 'a'.repeat(32)
    insertRecord(database, 'intake:01-console', {
      teamId: '01-console',
      repoUrl: 'https://github.com/example/repo',
      branch: 'main',
      sha: 'b'.repeat(40),
      retrievedAt: '2026-10-28T00:00:00.000Z',
      snapshotPath: 'snapshots/01-console',
      verified: true,
      evidenceIds: [evidenceId],
      artifacts: [],
      links: [],
      demoParity: 'unverified',
      issues: [],
      declaredDemoCommits: [],
      previousSnapshots: [],
    })
    insertRecord(database, `evidence:${evidenceId}`, {
      id: evidenceId,
      teamId: '01-console',
      snapshotSha: 'b'.repeat(40),
      path: 'README.md',
      kind: 'source',
      sha256: 'c'.repeat(64),
      text: 'The source describes the feature.',
      lines: 1,
      coverage: 'README',
      createdAt: '2026-10-28T00:00:00.000Z',
    })
    const input = await buildAssessmentInput(database as never, '01-console')
    const firstJobId = '11111111-1111-4111-8111-111111111111'
    const nextJobId = '22222222-2222-4222-8222-222222222222'
    insertJob(database, firstJobId, '01-console', input.inputHash)
    insertJob(database, nextJobId, '02-ctrl-ai', 'next-input-hash')

    const calls: { model: string, payload: Record<string, unknown> }[] = []
    const event = {
      context: {
        cloudflare: {
          env: {
            DB: database,
            AI: {
              run: async (model: string, payload: Record<string, unknown>) => {
                calls.push({ model, payload })
                return { response: responseFor(evidenceId) }
              },
            },
          },
        },
      },
    } as unknown as H3Event

    await runJudgingJob(event, firstJobId)

    const firstStatus = database.db.prepare('SELECT status FROM judging_jobs WHERE id = ?').get(firstJobId) as { status: string }
    const nextStatus = database.db.prepare('SELECT status FROM judging_jobs WHERE id = ?').get(nextJobId) as { status: string }
    expect(firstStatus.status).toBe('completed')
    expect(nextStatus.status).toBe('queued')
    expect(calls).toHaveLength(1)
    expect(calls[0]?.model).toBe('@cf/qwen/qwen3-30b-a3b-fp8')
    expect(calls[0]?.payload.max_tokens).toBe(4096)
    expect(calls[0]?.payload.temperature).toBe(0.2)

    const messages = calls[0]?.payload.messages as { role: string, content: string }[]
    const system = messages[0]?.content ?? ''
    for (const criterion of ['innovation', 'problemSolutionFit', 'feasibility', 'clarity'])
      expect(system).toContain(`"criterion": "${criterion}"`)
    for (const feature of ['profiles', 'trends', 'matching', 'reskilling', 'sdg', 'scenarios'])
      expect(system).toContain(`"feature": "${feature}"`)
    for (const field of ['evidenceId', 'lineStart', 'lineEnd', 'page', 'evidenceKind'])
      expect(system).toContain(`"${field}"`)
  })
})
