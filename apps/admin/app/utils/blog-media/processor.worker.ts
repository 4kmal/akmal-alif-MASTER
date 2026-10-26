import type { BlogMediaProject } from '../../../shared/blog-media-project'
import { createBlogMediaProcessor } from './processor'

const scope = globalThis as unknown as {
  onmessage: (event: MessageEvent) => void
  postMessage: (message: unknown) => void
}
const requests = new Map<number, { resolve: (blob: Blob) => void, reject: (error: Error) => void }>()
let requestId = 0
let runtimeBase: string | undefined
const processor = createBlogMediaProcessor({
  resolveAsset: assetId => new Promise<Blob>((resolve, reject) => {
    const id = ++requestId
    requests.set(id, { resolve, reject })
    scope.postMessage({ type: 'source', id, assetId })
  }),
  onProgress: progress => scope.postMessage({ type: 'progress', progress }),
  get runtimeBase() { return runtimeBase },
})

scope.onmessage = async ({ data }) => {
  if (data.type === 'source') {
    const pending = requests.get(data.id)
    requests.delete(data.id)
    if (data.error)
      pending?.reject(new Error(data.error))
    else
      pending?.resolve(data.blob)
    return
  }
  if (data.type !== 'operation')
    return
  runtimeBase = data.runtimeBase
  try {
    const result = data.operation === 'render'
      ? await processor.render(data.payload as BlogMediaProject)
      : data.operation === 'decodeGif'
        ? await processor.decodeGif(data.payload.assetId)
        : await processor.poster(data.payload.assetId, data.payload.timeMs)
    scope.postMessage({ type: 'result', result })
  }
  catch (error) {
    scope.postMessage({ type: 'error', name: error instanceof Error ? error.name : 'Error', message: error instanceof Error ? error.message : String(error), details: error instanceof Error && 'details' in error ? error.details : undefined })
  }
}
