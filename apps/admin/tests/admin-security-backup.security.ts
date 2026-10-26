import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const backupDeps = vi.hoisted(() => ({
  migrationMarker: vi.fn(),
  links: vi.fn(),
  backupWorker: vi.fn(),
}))

vi.mock('../server/services/link-store/migration', () => ({
  readCompletedLinkMigrationMarker: backupDeps.migrationMarker,
}))
vi.mock('../server/utils/link-store', () => ({
  iterateAllAuthoritativeLinks: backupDeps.links,
}))

describe('scheduled and manual R2 backups', () => {
  beforeEach(() => {
    vi.resetModules()
    backupDeps.migrationMarker.mockReset()
    backupDeps.links.mockReset()
    backupDeps.backupWorker.mockReset()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.doUnmock('../server/utils/backup')
  })

  it('skips backup until migration is complete and reports an unconfigured R2 binding', async () => {
    const { backupLinksToR2 } = await import('../server/utils/backup')
    const createMultipartUpload = vi.fn()
    const env = { R2: { createMultipartUpload } } as never

    backupDeps.migrationMarker.mockResolvedValueOnce(null)
    await expect(backupLinksToR2(env)).resolves.toEqual({ completed: false, reason: 'migration-incomplete' })
    expect(createMultipartUpload).not.toHaveBeenCalled()

    backupDeps.migrationMarker.mockResolvedValueOnce({ version: 1 })
    await expect(backupLinksToR2({} as never)).resolves.toEqual({ completed: false, reason: 'r2-not-configured' })
  })

  it('writes a completed automatic backup through multipart staging and cleanup', async () => {
    backupDeps.migrationMarker.mockResolvedValue({ version: 1, completedAt: new Date().toISOString() })
    backupDeps.links.mockReturnValue((async function* () {
      yield {
        id: 'link-id',
        slug: 'docs',
        url: 'https://example.com/docs',
        createdAt: 1,
        updatedAt: 2,
        tags: [],
      }
    })())
    const upload = {
      uploadPart: vi.fn(async (partNumber: number) => ({ partNumber, etag: `etag-${partNumber}` })),
      complete: vi.fn(),
      abort: vi.fn(),
    }
    const R2 = {
      createMultipartUpload: vi.fn().mockResolvedValue(upload),
      get: vi.fn().mockResolvedValue({ body: 'staged-body' }),
      put: vi.fn(),
      delete: vi.fn(),
    }
    const { backupLinksToR2 } = await import('../server/utils/backup')

    const result = await backupLinksToR2({ R2 } as never)

    expect(result.completed).toBe(true)
    if (!result.completed)
      throw new Error('expected completed backup')
    expect(result.filename).toMatch(/^backups\/links-.*\.json$/)
    expect(result.count).toBe(1)
    expect(R2.createMultipartUpload).toHaveBeenCalledWith(expect.stringMatching(/^backups\/links-.*\.json\.pending-/), {
      httpMetadata: { contentType: 'application/json' },
    })
    expect(upload.uploadPart).toHaveBeenCalledTimes(1)
    expect(upload.complete).toHaveBeenCalledWith([{ partNumber: 1, etag: 'etag-1' }])
    expect(R2.put).toHaveBeenCalledWith(result.filename, 'staged-body', {
      httpMetadata: { contentType: 'application/json' },
      customMetadata: expect.objectContaining({ count: '1' }),
    })
    expect(R2.delete).toHaveBeenCalledTimes(1)
    expect(R2.delete).toHaveBeenCalledWith(expect.stringMatching(/^backups\/links-.*\.json\.pending-/))
    expect(upload.abort).not.toHaveBeenCalled()
  })

  it('uses the manual filename prefix and wires the scheduled hook with its disable switch', async () => {
    backupDeps.migrationMarker.mockResolvedValue({ version: 1 })
    backupDeps.links.mockReturnValue((async function* () {})())
    const R2 = {
      createMultipartUpload: vi.fn().mockResolvedValue({
        uploadPart: vi.fn(async (partNumber: number) => ({ partNumber, etag: 'etag' })),
        complete: vi.fn(),
        abort: vi.fn(),
      }),
      get: vi.fn().mockResolvedValue({ body: 'staged-body' }),
      put: vi.fn(),
      delete: vi.fn(),
    }
    const { backupLinksToR2 } = await import('../server/utils/backup')
    const manual = await backupLinksToR2({ R2 } as never, true)
    expect(manual.completed).toBe(true)
    if (manual.completed)
      expect(manual.filename).toMatch(/^backups\/manual-links-.*\.json$/)

    let scheduled: ((event: { env: unknown }) => Promise<void>) | undefined
    let disabled = false
    vi.stubGlobal('defineNitroPlugin', (plugin: unknown) => plugin)
    vi.stubGlobal('useRuntimeConfig', () => ({ disableAutoBackup: disabled }))
    vi.stubGlobal('backupLinksToR2', backupDeps.backupWorker)
    const { default: plugin } = await import('../server/plugins/backup')
    plugin({
      hooks: {
        hook: vi.fn((_name: string, handler: typeof scheduled) => {
          scheduled = handler
        }),
      },
    } as never)
    expect(scheduled).toBeDefined()

    disabled = true
    await scheduled?.({ env: { R2 } })
    expect(backupDeps.backupWorker).not.toHaveBeenCalled()
    disabled = false
    await scheduled?.({ env: { R2 } })
    expect(backupDeps.backupWorker).toHaveBeenCalledWith({ R2 })
  })
})
