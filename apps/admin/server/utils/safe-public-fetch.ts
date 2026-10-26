import { isPublicHttpUrl } from './public-url'

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])
const DEFAULT_MAX_REDIRECTS = 3
const DEFAULT_TIMEOUT_MS = 5_000

export interface SafePublicFetchOptions extends RequestInit {
  maxRedirects?: number
  timeoutMs?: number
}

async function closeResponse(response: Response): Promise<void> {
  if (!response.body)
    return

  await response.body.cancel()
}

interface BodyDeadline {
  response: Response
  target: URL
  fetchController: AbortController
  callerSignal?: AbortSignal
  abortFromCaller: () => void
  bodyTimeoutMs: number
}

function wrapResponseWithDeadline({
  response,
  target,
  fetchController,
  callerSignal,
  abortFromCaller,
  bodyTimeoutMs,
}: BodyDeadline): Response {
  if (!response.body) {
    callerSignal?.removeEventListener('abort', abortFromCaller)
    return response
  }

  const reader = response.body.getReader()
  let streamController: ReadableStreamDefaultController<Uint8Array> | undefined
  let finished = false
  let timeout: ReturnType<typeof setTimeout> | undefined
  let abortBodyFromCaller: (() => void) | undefined

  const cleanup = () => {
    if (timeout !== undefined)
      clearTimeout(timeout)
    callerSignal?.removeEventListener('abort', abortFromCaller)
    if (abortBodyFromCaller)
      callerSignal?.removeEventListener('abort', abortBodyFromCaller)
  }

  const fail = (error: Error) => {
    if (finished)
      return

    finished = true
    cleanup()
    fetchController.abort()
    void reader.cancel(error).catch(() => {})
    try {
      streamController?.error(error)
    }
    catch {
      // The consumer may have cancelled or closed the wrapped stream already.
    }
  }

  const wrappedBody = new ReadableStream<Uint8Array>({
    start(controller) {
      streamController = controller
    },
    async pull(controller) {
      if (finished)
        return

      try {
        const result = await reader.read()
        if (finished)
          return

        if (result.done) {
          finished = true
          cleanup()
          controller.close()
          return
        }

        controller.enqueue(result.value)
      }
      catch (error) {
        if (finished)
          return

        finished = true
        cleanup()
        fetchController.abort()
        controller.error(error)
      }
    },
    async cancel(reason) {
      if (finished)
        return

      finished = true
      cleanup()
      fetchController.abort()
      await reader.cancel(reason)
    },
  })

  const wrappedResponse = new Response(wrappedBody, {
    headers: response.headers,
    status: response.status,
    statusText: response.statusText,
  })
  try {
    Object.defineProperty(wrappedResponse, 'url', {
      configurable: true,
      enumerable: true,
      value: response.url || target.toString(),
    })
  }
  catch {
    // Older Worker Response implementations may expose a non-configurable URL.
  }

  timeout = setTimeout(() => fail(new Error('Public fetch timed out')), Math.max(0, bodyTimeoutMs))

  callerSignal?.removeEventListener('abort', abortFromCaller)
  abortBodyFromCaller = () => fail(new DOMException('The operation was aborted', 'AbortError'))
  callerSignal?.addEventListener('abort', abortBodyFromCaller, { once: true })
  if (callerSignal?.aborted)
    abortBodyFromCaller()

  return wrappedResponse
}

export async function safePublicFetch(input: string | URL, options: SafePublicFetchOptions = {}): Promise<Response> {
  const {
    maxRedirects = DEFAULT_MAX_REDIRECTS,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    signal: callerSignal,
    ...requestInit
  } = options

  if (!Number.isInteger(maxRedirects) || maxRedirects < 0)
    throw new RangeError('maxRedirects must be a non-negative integer')
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
    throw new RangeError('timeoutMs must be positive')

  let target = new URL(input)
  let redirects = 0
  const deadline = Date.now() + timeoutMs

  while (true) {
    if (target.username || target.password || !isPublicHttpUrl(target.toString()))
      throw new Error('Unsafe public URL')

    const remaining = deadline - Date.now()
    if (remaining <= 0)
      throw new Error('Public fetch timed out')

    const controller = new AbortController()
    const abortFromCaller = () => controller.abort()
    if (callerSignal) {
      if (callerSignal.aborted)
        controller.abort()
      else
        callerSignal.addEventListener('abort', abortFromCaller, { once: true })
    }
    const timeout = setTimeout(() => controller.abort(), remaining)

    let response: Response
    try {
      response = await fetch(target, {
        ...requestInit,
        redirect: 'manual',
        signal: controller.signal,
      })
    }
    catch (error) {
      clearTimeout(timeout)
      callerSignal?.removeEventListener('abort', abortFromCaller)
      throw error
    }

    clearTimeout(timeout)

    if (!REDIRECT_STATUSES.has(response.status)) {
      return wrapResponseWithDeadline({
        response,
        target,
        fetchController: controller,
        callerSignal,
        abortFromCaller,
        bodyTimeoutMs: deadline - Date.now(),
      })
    }

    const location = response.headers.get('location')
    if (!location) {
      return wrapResponseWithDeadline({
        response,
        target,
        fetchController: controller,
        callerSignal,
        abortFromCaller,
        bodyTimeoutMs: deadline - Date.now(),
      })
    }

    callerSignal?.removeEventListener('abort', abortFromCaller)
    await closeResponse(response)
    if (redirects >= maxRedirects)
      throw new Error('Too many public fetch redirects')

    let nextTarget: URL
    try {
      nextTarget = new URL(location, target)
    }
    catch {
      throw new Error('Invalid public fetch redirect')
    }

    if (nextTarget.username || nextTarget.password || !isPublicHttpUrl(nextTarget.toString()))
      throw new Error('Unsafe public fetch redirect')

    target = nextTarget
    redirects += 1
  }
}
