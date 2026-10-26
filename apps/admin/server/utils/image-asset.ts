import type { H3Event } from 'h3'
import { SlugSchema } from '#shared/schemas/link'

const slugValidator = SlugSchema
const imageKeyPattern = /^images\/([^/]+)\/([\w-]{10}\.(?:jpeg|png|webp|gif))$/

function validateImageKey(event: H3Event, key: string): { slug: string, filename: string } {
  // Nitro decodes catch-all route parameters before exposing them. Inspect the
  // URL too so an encoded slash or backslash cannot become an extra R2 key
  // segment after routing.
  const rawPath = getRequestURL(event).pathname
  if (/%(?:2f|2e|5c)/i.test(rawPath) || /[\\\0]/.test(key))
    throw createError({ status: 400, statusText: 'Invalid image path' })

  const match = imageKeyPattern.exec(key)
  if (!match)
    throw createError({ status: 400, statusText: 'Invalid image path' })

  const slug = match[1]
  const filename = match[2]
  if (!slug || !filename)
    throw createError({ status: 400, statusText: 'Invalid image path' })

  const slugResult = slugValidator.safeParse(slug)
  if (!slugResult.success)
    throw createError({ status: 400, statusText: 'Invalid slug format' })

  return { slug, filename }
}

export async function serveImageAsset(event: H3Event): Promise<ReadableStream | null> {
  const R2 = requireR2Bucket(event.context.cloudflare.env)
  const key = getRouterParam(event, 'key')

  if (!key)
    throw createError({ status: 400, statusText: 'Key is required' })

  if (!key.startsWith('images/'))
    throw createError({ status: 403, statusText: 'Access denied' })

  validateImageKey(event, key)

  const object = await R2.get(key)
  if (!object)
    throw createError({ status: 404, statusText: 'Image not found' })

  setHeader(event, 'Content-Type', object.httpMetadata?.contentType || 'application/octet-stream')
  setHeader(event, 'Cache-Control', 'public, max-age=31536000, immutable')
  setHeader(event, 'ETag', object.etag)
  return object.body
}
