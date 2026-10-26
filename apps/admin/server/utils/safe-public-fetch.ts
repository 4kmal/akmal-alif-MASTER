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
    finally {
      clearTimeout(timeout)
      callerSignal?.removeEventListener('abort', abortFromCaller)
    }

    if (!REDIRECT_STATUSES.has(response.status))
      return response

    const location = response.headers.get('location')
    if (!location)
      return response

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
