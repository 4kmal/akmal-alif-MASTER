import type { BlogMediaProject, DecodedGif, MediaProgress, ProcessedMedia } from '../../../shared/blog-media-project'
import { inspectMedia } from './image'
import { createMediaClip, createMediaProject, mediaProjectDuration, validateMediaProject } from './project'

export { createMediaClip, createMediaProject, inspectMedia, mediaProjectDuration, validateMediaProject }
export type { BlogMediaProject, DecodedGif, MediaProgress, ProcessedMedia }

interface ProcessorOptions {
  resolveAsset: (assetId: string, signal: AbortSignal) => Promise<Blob>
  onProgress?: (progress: MediaProgress) => void
  runtimeBase?: string
}

export function createBlogMediaProcessor(options: ProcessorOptions) {
  let worker: Worker | null = null
  let disposed = false
  let current: { resolve: (value: any) => void, reject: (error: Error) => void } | null = null
  let controller: AbortController | null = null

  function stop(error?: Error) {
    controller?.abort()
    controller = null
    worker?.terminate()
    worker = null
    current?.reject(error || new DOMException('Media processing was cancelled.', 'AbortError'))
    current = null
  }

  function start() {
    if (worker)
      return worker
    worker = new Worker(new URL('./processor.worker.ts', import.meta.url), { type: 'module' })
    const activeWorker = worker
    worker.onmessage = async ({ data }) => {
      if (activeWorker !== worker)
        return
      if (data.type === 'progress') {
        options.onProgress?.(data.progress)
      }
      else if (data.type === 'source') {
        const signal = controller?.signal
        if (!signal)
          return
        try {
          const blob = await options.resolveAsset(data.assetId, signal)
          if (!signal.aborted && activeWorker === worker)
            activeWorker.postMessage({ type: 'source', id: data.id, blob })
        }
        catch (error) {
          if (!signal.aborted && activeWorker === worker)
            activeWorker.postMessage({ type: 'source', id: data.id, error: error instanceof Error ? error.message : 'The source could not be loaded.' })
        }
      }
      else if (data.type === 'result') {
        const pending = current
        current = null
        controller = null
        pending?.resolve(data.result)
      }
      else if (data.type === 'error') {
        if (data.details)
          console.error('Media processor diagnostics', data.details)
        const error = new Error(data.message || 'Media processing failed.')
        error.name = data.name || 'Error'
        stop(error)
      }
    }
    worker.onerror = () => {
      if (activeWorker === worker)
        stop(new Error('The browser media worker stopped. Your sources are preserved; retry the export.'))
    }
    return worker
  }

  function run<T>(operation: string, payload: unknown): Promise<T> {
    if (disposed)
      return Promise.reject(new Error('This media editor has been closed.'))
    if (current)
      return Promise.reject(new Error('Another media operation is running. Finish or cancel it first.'))
    controller = new AbortController()
    return new Promise<T>((resolve, reject) => {
      current = { resolve, reject }
      try {
        start().postMessage({ type: 'operation', operation, payload, runtimeBase: options.runtimeBase })
      }
      catch (error) {
        stop(error instanceof Error ? error : new Error('The browser media worker could not start.'))
      }
    })
  }

  return {
    render(project: BlogMediaProject) {
      validateMediaProject(project)
      return run<ProcessedMedia>('render', JSON.parse(JSON.stringify(project)))
    },
    decodeGif(assetId: string) {
      return run<DecodedGif>('decodeGif', { assetId })
    },
    poster(assetId: string, timeMs = 0) {
      return run<Blob>('poster', { assetId, timeMs })
    },
    cancel() {
      stop()
      options.onProgress?.({ stage: 'cancelled', ratio: null, message: 'Cancelled. Your source files and draft are preserved.' })
    },
    dispose() {
      disposed = true
      stop()
    },
  }
}
