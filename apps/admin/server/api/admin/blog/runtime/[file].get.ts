import { getRouterParam } from 'h3'
import { blogActor } from '../../../../services/blog-studio'

const RUNTIME_FILES = new Map([
  ['ffmpeg-core.js', 'application/javascript; charset=utf-8'],
  ['ffmpeg-core.wasm', 'application/wasm'],
])

export default eventHandler(async (event) => {
  blogActor(event)
  const file = getRouterParam(event, 'file') || ''
  const contentType = RUNTIME_FILES.get(file)
  if (!contentType)
    throw createError({ statusCode: 404, statusMessage: 'Runtime object not found' })
  const bucket = event.context.cloudflare?.env?.R2
  if (!bucket)
    throw createError({ statusCode: 503, statusMessage: 'Admin R2 binding not configured' })
  const object = await bucket.get(`editor-runtime/ffmpeg/0.12.10/${file}`)
  if (!object)
    throw createError({ statusCode: 404, statusMessage: 'Runtime object not found' })
  setHeader(event, 'Content-Type', contentType)
  setHeader(event, 'Cache-Control', 'private, max-age=3600')
  setHeader(event, 'X-Content-Type-Options', 'nosniff')
  setHeader(event, 'Content-Length', object.size)
  return object.body
})
