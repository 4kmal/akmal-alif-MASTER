import type { H3Event } from 'h3'
import fs from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { beforeEach, describe, expect, it } from 'vitest'
import { buildAssessmentInput, listJudgingJobs, runJudgingJob } from '../server/utils/judging-ai'

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

function setPendingJob(database: SqliteD1, id: string, inputHash: string, requestId: string | null = 'batch-1'): void {
  database.db.prepare(`UPDATE judging_jobs
    SET status = 'running', progress = 50, attempts = 1, started_at = ?, updated_at = ?, draft_json = ?
    WHERE id = ?`)
    .run('2026-10-28T00:00:00.000Z', '2026-10-28T00:00:00.000Z', JSON.stringify({ provider: 'workers-ai-batch', requestId, inputHash, submittedAt: '2026-10-28T00:00:00.000Z' }), id)
}

function insertAssessmentFixture(database: SqliteD1, evidenceId: string, teamId = '01-console'): void {
  insertRecord(database, `intake:${teamId}`, {
    teamId,
    repoUrl: 'https://github.com/example/repo',
    branch: 'main',
    sha: 'b'.repeat(40),
    retrievedAt: '2026-10-28T00:00:00.000Z',
    snapshotPath: `snapshots/${teamId}`,
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
    teamId,
    snapshotSha: 'b'.repeat(40),
    path: 'README.md',
    kind: 'source',
    sha256: 'c'.repeat(64),
    text: 'The source describes the feature.',
    lines: 1,
    coverage: 'README',
    createdAt: '2026-10-28T00:00:00.000Z',
  })
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

  it('submits one batch, resumes it through queued/running polling, and finalizes once', async () => {
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

    const calls: { model: string, payload: Record<string, unknown>, options: unknown }[] = []
    const providerResponses: unknown[] = [
      { status: 'queued', request_id: 'batch-1' },
      { status: 'running', request_id: 'batch-1' },
      { status: 'completed', responses: [{ success: true, result: { response: responseFor(evidenceId) } }] },
    ]
    const event = {
      context: {
        cloudflare: {
          env: {
            DB: database,
            AI: {
              run: async (model: string, payload: Record<string, unknown>, options: unknown) => {
                calls.push({ model, payload, options })
                return providerResponses.shift()
              },
            },
          },
        },
      },
    } as unknown as H3Event

    await runJudgingJob(event, firstJobId)

    const firstSubmission = database.db.prepare('SELECT status, progress, draft_json FROM judging_jobs WHERE id = ?').get(firstJobId) as { status: string, progress: number, draft_json: string }
    expect(firstSubmission.status).toBe('running')
    expect(firstSubmission.progress).toBe(50)
    expect(JSON.parse(firstSubmission.draft_json).requestId).toBe('batch-1')
    expect(calls).toHaveLength(1)
    expect(calls[0]?.model).toBe('@cf/qwen/qwen3-30b-a3b-fp8')
    expect(calls[0]?.options).toEqual({ queueRequest: true })
    const request = (calls[0]?.payload.requests as Record<string, unknown>[])[0]
    expect(request?.max_tokens).toBe(4096)
    expect(request?.temperature).toBe(0.2)

    const messages = request?.messages as { role: string, content: string }[]
    const system = messages[0]?.content ?? ''
    for (const criterion of ['innovation', 'problemSolutionFit', 'feasibility', 'clarity'])
      expect(system).toContain(`"criterion": "${criterion}"`)
    for (const feature of ['profiles', 'trends', 'matching', 'reskilling', 'sdg', 'scenarios'])
      expect(system).toContain(`"feature": "${feature}"`)
    for (const field of ['evidenceId', 'lineStart', 'lineEnd', 'page', 'evidenceKind'])
      expect(system).toContain(`"${field}"`)

    await Promise.all([runJudgingJob(event, firstJobId), runJudgingJob(event, firstJobId)])
    expect(calls).toHaveLength(2)
    expect(calls[1]?.payload).toEqual({ request_id: 'batch-1' })

    await runJudgingJob(event, firstJobId)
    const firstStatus = database.db.prepare('SELECT status, draft_json FROM judging_jobs WHERE id = ?').get(firstJobId) as { status: string, draft_json: string }
    const nextStatus = database.db.prepare('SELECT status FROM judging_jobs WHERE id = ?').get(nextJobId) as { status: string }
    expect(firstStatus.status).toBe('completed')
    expect(JSON.parse(firstStatus.draft_json).scores).toHaveLength(4)
    expect(nextStatus.status).toBe('queued')
    expect(calls).toHaveLength(3)

    await runJudgingJob(event, firstJobId)
    expect(calls).toHaveLength(3)
  })

  it('polls a saved batch from a fresh jobs request and hides provider metadata', async () => {
    const evidenceId = 'a'.repeat(32)
    insertAssessmentFixture(database, evidenceId)
    const input = await buildAssessmentInput(database as never, '01-console')
    const jobId = '66666666-6666-4666-8666-666666666666'
    insertJob(database, jobId, '01-console', input.inputHash)
    setPendingJob(database, jobId, input.inputHash)
    const calls: Record<string, unknown>[] = []
    const waiters: Promise<unknown>[] = []
    const event = {
      context: {
        cloudflare: {
          env: {
            DB: database,
            AI: {
              run: async (_model: string, payload: Record<string, unknown>) => {
                calls.push(payload)
                return { status: 'running', request_id: 'batch-1' }
              },
            },
          },
          context: { waitUntil: (promise: Promise<unknown>) => { waiters.push(promise) } },
        },
      },
    } as unknown as H3Event

    const jobs = await listJudgingJobs(event, 'paired-device-1')
    expect(jobs.find(job => job.id === jobId)?.draft).toBeNull()
    expect(jobs.some(job => job.id === jobId)).toBe(true)
    await Promise.all(waiters)

    expect(calls).toEqual([{ request_id: 'batch-1' }])
    const row = database.db.prepare('SELECT status, progress FROM judging_jobs WHERE id = ?').get(jobId) as { status: string, progress: number }
    expect(row.status).toBe('running')
    expect(row.progress).toBe(50)
  })

  it('polls both active batches and fills one free provider slot without duplicating requests', async () => {
    const teams = ['01-console', '02-ctrl-ai', '03-ctrl-cv']
    const evidenceIds = ['a', 'b', 'c'].map(value => value.repeat(32))
    const inputs = []
    for (const [index, teamId] of teams.entries()) {
      insertAssessmentFixture(database, evidenceIds[index]!, teamId)
      inputs.push(await buildAssessmentInput(database as never, teamId))
    }
    const jobIds = [
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      '33333333-3333-4333-8333-333333333333',
    ]
    insertJob(database, jobIds[0]!, teams[0]!, inputs[0]!.inputHash)
    insertJob(database, jobIds[1]!, teams[1]!, inputs[1]!.inputHash)
    insertJob(database, jobIds[2]!, teams[2]!, inputs[2]!.inputHash)
    setPendingJob(database, jobIds[0]!, inputs[0]!.inputHash, 'batch-1')
    setPendingJob(database, jobIds[1]!, inputs[1]!.inputHash, 'batch-2')
    database.db.prepare('UPDATE judging_jobs SET created_at = ? WHERE id = ?').run('2026-10-28T00:00:01.000Z', jobIds[0])
    database.db.prepare('UPDATE judging_jobs SET created_at = ? WHERE id = ?').run('2026-10-28T00:00:02.000Z', jobIds[1])
    database.db.prepare('UPDATE judging_jobs SET created_at = ? WHERE id = ?').run('2026-10-28T00:00:03.000Z', jobIds[2])

    const calls: Record<string, unknown>[] = []
    const waiters: Promise<unknown>[] = []
    const event = {
      context: {
        cloudflare: {
          env: {
            DB: database,
            AI: {
              run: async (_model: string, payload: Record<string, unknown>) => {
                calls.push(payload)
                if (payload.request_id === 'batch-1')
                  return { status: 'completed', responses: [{ success: true, result: { response: responseFor(evidenceIds[0]!) } }] }
                if (payload.request_id === 'batch-2')
                  return { status: 'running', request_id: 'batch-2' }
                return { status: 'queued', request_id: 'batch-3' }
              },
            },
          },
          context: { waitUntil: (promise: Promise<unknown>) => { waiters.push(promise) } },
        },
      },
    } as unknown as H3Event

    await listJudgingJobs(event)
    await Promise.all(waiters)

    expect(calls).toHaveLength(2)
    expect(calls.map(call => call.request_id)).toEqual(['batch-1', 'batch-2'])
    expect((database.db.prepare('SELECT status FROM judging_jobs WHERE id = ?').get(jobIds[0]) as { status: string }).status).toBe('completed')
    expect((database.db.prepare('SELECT status FROM judging_jobs WHERE id = ?').get(jobIds[2]) as { status: string }).status).toBe('queued')

    const nextWaiters: Promise<unknown>[] = []
    const nextEvent = {
      context: {
        cloudflare: {
          env: {
            DB: database,
            AI: {
              run: async (_model: string, payload: Record<string, unknown>) => {
                calls.push(payload)
                if (payload.request_id === 'batch-2')
                  return { status: 'running', request_id: 'batch-2' }
                return { status: 'queued', request_id: 'batch-3' }
              },
            },
          },
          context: { waitUntil: (promise: Promise<unknown>) => { nextWaiters.push(promise) } },
        },
      },
    } as unknown as H3Event

    await listJudgingJobs(nextEvent)
    await Promise.all(nextWaiters)

    expect(calls.slice(2).map(call => call.request_id ?? 'submission')).toEqual(['batch-2', 'submission'])
    const queued = database.db.prepare('SELECT status, progress, draft_json FROM judging_jobs WHERE id = ?').get(jobIds[2]) as { status: string, progress: number, draft_json: string }
    expect(queued.status).toBe('running')
    expect(queued.progress).toBe(50)
    expect(JSON.parse(queued.draft_json).requestId).toBe('batch-3')
  })

  it('fails a completed batch response and clears private provider state', async () => {
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
    const jobId = '33333333-3333-4333-8333-333333333333'
    insertJob(database, jobId, '01-console', input.inputHash)
    setPendingJob(database, jobId, input.inputHash)
    const calls: Record<string, unknown>[] = []
    const event = {
      context: {
        cloudflare: {
          env: {
            DB: database,
            AI: {
              run: async (_model: string, payload: Record<string, unknown>) => {
                calls.push(payload)
                return { status: 'completed', responses: [{ success: false, error: { message: 'provider exploded' } }] }
              },
            },
          },
        },
      },
    } as unknown as H3Event

    await runJudgingJob(event, jobId)

    const row = database.db.prepare('SELECT status, error, draft_json FROM judging_jobs WHERE id = ?').get(jobId) as { status: string, error: string, draft_json: string | null }
    expect(row.status).toBe('failed')
    expect(row.error).toContain('provider exploded')
    expect(row.draft_json).toBeNull()
    expect(calls).toEqual([{ request_id: 'batch-1' }])
  })

  it('reports bounded batch response shape when a completed response has no responses', async () => {
    const evidenceId = 'a'.repeat(32)
    insertAssessmentFixture(database, evidenceId)
    const input = await buildAssessmentInput(database as never, '01-console')
    const jobId = '77777777-7777-4777-8777-777777777777'
    insertJob(database, jobId, '01-console', input.inputHash)
    setPendingJob(database, jobId, input.inputHash)
    const event = {
      context: {
        cloudflare: {
          env: {
            DB: database,
            AI: { run: async () => ({ status: 'completed', unexpected: true }) },
          },
        },
      },
    } as unknown as H3Event

    await runJudgingJob(event, jobId)

    const row = database.db.prepare('SELECT status, error FROM judging_jobs WHERE id = ?').get(jobId) as { status: string, error: string }
    expect(row.status).toBe('failed')
    expect(row.error).toContain('Workers AI batch returned no responses')
    expect(row.error).toContain('keys=status,unexpected')
    expect(row.error).toContain('status=completed')
    expect(row.error).toContain('responses=undefined')
  })

  it.each(['wrapped', 'direct', 'message-content', 'message-text', 'choice-text'])('accepts %s results entries and a closed think block with a JSON code fence', async (shape) => {
    const evidenceId = 'a'.repeat(32)
    insertAssessmentFixture(database, evidenceId)
    const input = await buildAssessmentInput(database as never, '01-console')
    const jobId = '88888888-8888-4888-8888-888888888888'
    insertJob(database, jobId, '01-console', input.inputHash)
    setPendingJob(database, jobId, input.inputHash)
    const event = {
      context: {
        cloudflare: {
          env: {
            DB: database,
            AI: {
              run: async () => ({
                results: [shape === 'wrapped'
                  ? {
                      id: 0,
                      success: true,
                      result: { response: `<think>private reasoning</think>\n${'```json'}\n${responseFor(evidenceId)}\n${'```'}\n` },
                    }
                  : shape === 'direct'
                    ? { response: `<think>private reasoning</think>\n${'```json'}\n${responseFor(evidenceId)}\n${'```'}\n` }
                    : shape === 'message-content'
                      ? { response: null, choices: [{ message: { content: `<think>private reasoning</think>\n${'```json'}\n${responseFor(evidenceId)}\n${'```'}\n` } }] }
                      : shape === 'message-text'
                        ? { response: null, choices: [{ message: { content: null, text: `<think>private reasoning</think>\n${'```json'}\n${responseFor(evidenceId)}\n${'```'}\n` } }] }
                        : { response: null, choices: [{ text: `<think>private reasoning</think>\n${'```json'}\n${responseFor(evidenceId)}\n${'```'}\n` }] }],
                usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
              }),
            },
          },
        },
      },
    } as unknown as H3Event

    await runJudgingJob(event, jobId)

    const row = database.db.prepare('SELECT status, error FROM judging_jobs WHERE id = ?').get(jobId) as { status: string, error: string }
    expect(row.status).toBe('completed')
    expect(row.error).toBeNull()
    const draft = database.db.prepare('SELECT draft_json FROM judging_jobs WHERE id = ?').get(jobId) as { draft_json: string }
    expect(JSON.parse(draft.draft_json).features).toHaveLength(6)
  })

  it('identifies provider token-limit truncation without exposing model text', async () => {
    const evidenceId = 'a'.repeat(32)
    insertAssessmentFixture(database, evidenceId)
    const input = await buildAssessmentInput(database as never, '01-console')
    const jobId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    insertJob(database, jobId, '01-console', input.inputHash)
    setPendingJob(database, jobId, input.inputHash)
    const event = {
      context: {
        cloudflare: {
          env: {
            DB: database,
            AI: {
              run: async () => ({
                results: [{
                  success: true,
                  result: {
                    response: null,
                    choices: [{ message: { content: '{"features": [', reasoning_content: 'private reasoning' }, finish_reason: 'length' }],
                  },
                }],
              }),
            },
          },
        },
      },
    } as unknown as H3Event

    await runJudgingJob(event, jobId)

    const row = database.db.prepare('SELECT status, error FROM judging_jobs WHERE id = ?').get(jobId) as { status: string, error: string }
    expect(row.status).toBe('failed')
    expect(row.error).toContain('provider token limit')
    expect(row.error).toContain('finishReason=length')
    expect(row.error).toContain('reasoning=string:17')
    expect(row.error).not.toContain('{"features": [')
    expect(row.error).not.toContain('private reasoning')
  })

  it('rejects an unclosed think block without exposing its content', async () => {
    const evidenceId = 'a'.repeat(32)
    insertAssessmentFixture(database, evidenceId)
    const input = await buildAssessmentInput(database as never, '01-console')
    const jobId = '99999999-9999-4999-8999-999999999999'
    insertJob(database, jobId, '01-console', input.inputHash)
    setPendingJob(database, jobId, input.inputHash)
    const event = {
      context: {
        cloudflare: {
          env: {
            DB: database,
            AI: {
              run: async () => ({
                results: [{ success: true, result: { response: '<think>private reasoning' } }],
              }),
            },
          },
        },
      },
    } as unknown as H3Event

    await runJudgingJob(event, jobId)

    const row = database.db.prepare('SELECT status, error FROM judging_jobs WHERE id = ?').get(jobId) as { status: string, error: string }
    expect(row.status).toBe('failed')
    expect(row.error).toContain('AI draft response has an unclosed think block')
    expect(row.error).not.toContain('private reasoning')
  })

  it('does not poll a batch after input evidence changes', async () => {
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
    const jobId = '44444444-4444-4444-8444-444444444444'
    insertJob(database, jobId, '01-console', input.inputHash)
    setPendingJob(database, jobId, input.inputHash)
    database.db.prepare('UPDATE judging_records SET data_json = ? WHERE record_key = ?').run(JSON.stringify({
      id: evidenceId,
      teamId: '01-console',
      snapshotSha: 'b'.repeat(40),
      path: 'README.md',
      kind: 'source',
      sha256: 'c'.repeat(64),
      text: 'The source changed after submission.',
      lines: 1,
      coverage: 'README',
      createdAt: '2026-10-28T00:00:00.000Z',
    }), `evidence:${evidenceId}`)
    const calls: unknown[] = []
    const event = {
      context: {
        cloudflare: {
          env: {
            DB: database,
            AI: {
              run: async (_model: string, payload: unknown) => {
                calls.push(payload)
                return { status: 'running', request_id: 'batch-1' }
              },
            },
          },
        },
      },
    } as unknown as H3Event

    await runJudgingJob(event, jobId)

    const row = database.db.prepare('SELECT status, error FROM judging_jobs WHERE id = ?').get(jobId) as { status: string, error: string }
    expect(row.status).toBe('failed')
    expect(row.error).toContain('input changed')
    expect(calls).toHaveLength(0)
  })

  it('honors cancellation before submitting a provider request', async () => {
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
    const jobId = '55555555-5555-4555-8555-555555555555'
    insertJob(database, jobId, '01-console', input.inputHash)
    database.db.prepare('UPDATE judging_jobs SET cancel_requested = 1 WHERE id = ?').run(jobId)
    const calls: unknown[] = []
    const event = {
      context: {
        cloudflare: {
          env: {
            DB: database,
            AI: {
              run: async (_model: string, payload: unknown) => {
                calls.push(payload)
                return { status: 'queued', request_id: 'batch-1' }
              },
            },
          },
        },
      },
    } as unknown as H3Event

    await runJudgingJob(event, jobId)

    const row = database.db.prepare('SELECT status, draft_json FROM judging_jobs WHERE id = ?').get(jobId) as { status: string, draft_json: string | null }
    expect(row.status).toBe('cancelled')
    expect(row.draft_json).toBeNull()
    expect(calls).toHaveLength(0)
  })
})
