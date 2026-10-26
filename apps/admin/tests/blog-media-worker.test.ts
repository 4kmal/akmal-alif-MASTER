import { afterEach, describe, expect, it, vi } from 'vitest'
import { createBlogMediaProcessor, createMediaProject } from '../app/utils/blog-media'

class TestWorker {
  static instances: TestWorker[] = []
  onmessage: ((event: { data: any }) => void) | null = null
  onerror: (() => void) | null = null
  messages: any[] = []
  terminated = false
  constructor() { TestWorker.instances.push(this) }
  postMessage(message: any) { this.messages.push(message) }
  terminate() { this.terminated = true }
  send(data: any) { this.onmessage?.({ data }) }
}

afterEach(() => {
  vi.unstubAllGlobals()
  TestWorker.instances = []
})

describe('browser media worker lifecycle', () => {
  it('loads sources only on request and serializes exports', async () => {
    vi.stubGlobal('Worker', TestWorker)
    const resolveAsset = vi.fn(async () => new Blob(['source'], { type: 'image/png' }))
    const processor = createBlogMediaProcessor({ resolveAsset })
    expect(TestWorker.instances).toHaveLength(0)
    const operation = processor.render(createMediaProject('image', { id: 'original', width: 64, height: 64 }))
    const worker = TestWorker.instances[0]!
    expect(resolveAsset).not.toHaveBeenCalled()
    await expect(processor.decodeGif('other')).rejects.toThrow('Another media operation')
    worker.send({ type: 'source', id: 1, assetId: 'original' })
    await vi.waitFor(() => expect(worker.messages.some(message => message.type === 'source')).toBe(true))
    expect(resolveAsset).toHaveBeenCalledWith('original', expect.any(AbortSignal))
    const result = { blob: new Blob(['derived']), mime_type: 'image/png', filename: 'derived.png', width: 64, height: 64, duration_ms: 0 }
    worker.send({ type: 'result', result })
    expect(await operation).toBe(result)
    processor.dispose()
    expect(worker.terminated).toBe(true)
  })

  it('cancels outstanding source reads, destroys processing memory and retries in a fresh worker', async () => {
    vi.stubGlobal('Worker', TestWorker)
    let sourceSignal: AbortSignal | undefined
    const resolveAsset = vi.fn((_id: string, signal: AbortSignal) => {
      sourceSignal = signal
      return new Promise<Blob>(() => {})
    })
    const processor = createBlogMediaProcessor({ resolveAsset })
    const pending = processor.poster('original')
    const cancelled = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    const first = TestWorker.instances[0]!
    first.send({ type: 'source', id: 1, assetId: 'original' })
    processor.cancel()
    await cancelled
    expect(sourceSignal?.aborted).toBe(true)
    expect(first.terminated).toBe(true)
    const retry = processor.poster('original', 500)
    const next = TestWorker.instances[1]!
    first.onerror?.()
    expect(next.terminated).toBe(false)
    next.send({ type: 'result', result: new Blob(['poster']) })
    expect((await retry).size).toBe(6)
    processor.dispose()
    await expect(processor.poster('original')).rejects.toThrow('closed')
  })

  it('retains source failures as errors and recovers after a worker crash', async () => {
    vi.stubGlobal('Worker', TestWorker)
    const processor = createBlogMediaProcessor({ resolveAsset: async () => {
      throw new Error('Offline source')
    } })
    const pending = processor.decodeGif('original')
    const failed = expect(pending).rejects.toThrow('browser media worker stopped')
    const worker = TestWorker.instances[0]!
    worker.send({ type: 'source', id: 5, assetId: 'original' })
    await vi.waitFor(() => expect(worker.messages).toContainEqual({ type: 'source', id: 5, error: 'Offline source' }))
    worker.onerror?.()
    await failed
    const retry = processor.decodeGif('original')
    TestWorker.instances[1]!.send({ type: 'result', result: { frames: [], width: 10, height: 10, duration_ms: 0 } })
    expect(await retry).toMatchObject({ frames: [] })
    processor.dispose()
  })
})
