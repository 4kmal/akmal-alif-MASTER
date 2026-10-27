import type { H3Event } from 'h3'
import { describe, expect, it } from 'vitest'
import { putJudgingEvidence, sha256Bytes } from '../server/utils/judging'

const globals = globalThis as unknown as Record<string, unknown>
globals.createError ??= (options: Record<string, unknown>) => Object.assign(new Error(String(options.statusMessage ?? 'error')), options)

function createEvent(bucket: { put: (...args: unknown[]) => Promise<unknown> }, headers: Record<string, string>): H3Event {
  return {
    context: { cloudflare: { env: { R2: bucket } } },
    node: { req: { headers: { host: 'admin.example', ...headers } } },
  } as unknown as H3Event
}

describe('judging evidence storage validation', () => {
  it('rejects invalid metadata before writing the source bytes to R2', async () => {
    let writes = 0
    const bucket = {
      put: async () => {
        writes += 1
      },
    }
    const event = createEvent(bucket, {
      'x-judging-team-id': '01-console',
      'x-judging-snapshot-sha': 'not-a-commit',
      'x-judging-path': 'README.md',
    })

    await expect(putJudgingEvidence(event, 'a'.repeat(32), new Uint8Array([1, 2, 3]), 'owner')).rejects.toMatchObject({ statusCode: 400 })
    expect(writes).toBe(0)
  })

  it('uses the original uploaded bytes hash for the immutable R2 object key', async () => {
    let writes = 0
    const bucket = {
      put: async () => {
        writes += 1
      },
    }
    const bytes = new Uint8Array([1, 2, 3])
    const event = createEvent(bucket, {
      'x-judging-team-id': '01-console',
      'x-judging-snapshot-sha': 'b'.repeat(40),
      'x-judging-path': 'README.md',
    })

    const meta = await putJudgingEvidence(event, 'a'.repeat(32), bytes, 'owner')
    const sourceHash = await sha256Bytes(bytes)
    expect(meta.sha256).toBe(sourceHash)
    expect(meta.objectKey).toContain(`/a${'a'.repeat(31)}/${sourceHash}`)
    expect(writes).toBe(1)
  })
})
