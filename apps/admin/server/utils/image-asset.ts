import type { H3Event } from 'h3'
import { SlugSchema } from '#shared/schemas/link'

const slugValidator = SlugSchema

export async function serveImageAsset(event: H3Event): Promise<ReadableStream | null> {
  const R2 = requireR2Bucket(event.context.cloudflare.env)
  const key = getRouterParam(event, 'key')

  if (!key)
    throw createError({ status: 400, statusText: 'Key is required' })

  if (!key.startsWith('images/'))
    throw createError({ status: 403, statusText: 'Access denied' })

  const parts = key.split('/')
  if (parts.length < 3)
    throw createError({ status: 400, statusText: 'Invalid path format' })

  const slugResult = slugValidator.safeParse(parts[1])
  if (!slugResult.success)
    throw createError({ status: 400, statusText: 'Invalid slug format' })

  const object = await R2.get(key)
  if (!object)
    throw createError({ status: 404, statusText: 'Image not found' })

  setHeader(event, 'Content-Type', object.httpMetadata?.contentType || 'application/octet-stream')
  setHeader(event, 'Cache-Control', 'public, max-age=31536000, immutable')
  setHeader(event, 'ETag', object.etag)
  return object.body
}
