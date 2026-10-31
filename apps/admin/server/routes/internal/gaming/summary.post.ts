import { ingestGamingSummary } from '@portfolio-analytics'
import { createError, eventHandler, getHeader, readRawBody, setHeader } from 'h3'
import { authoritativeRequestOrigin, isPortfolioGatewayTokenValid } from '../../../utils/portfolio-gateway'
import { getRuntimeString } from '../../../utils/runtime-config'

export default eventHandler(async (event) => {
  if (event.method !== 'POST')
    throw createError({ statusCode: 405, statusMessage: 'Method Not Allowed' })
  const secret = getRuntimeString(event, 'portfolioGatewayToken', 'PORTFOLIO_GATEWAY_TOKEN')
  if (event.context.authMethod !== 'gaming-service'
    || !isPortfolioGatewayTokenValid(event, secret)
    || authoritativeRequestOrigin(event) !== 'https://admin.internal'
    || getHeader(event, 'x-gaming-service') !== 'exepert-room'
    || getHeader(event, 'Origin') || getHeader(event, 'Sec-Fetch-Site')) {
    throw createError({ statusCode: 403, statusMessage: 'Private gaming service required' })
  }
  const body = await readRawBody(event, 'utf8')
  if (!body || new TextEncoder().encode(body).byteLength > 64 * 1024)
    throw createError({ statusCode: 413, statusMessage: 'Gaming summary exceeds its size limit' })
  let summary: unknown
  try {
    summary = JSON.parse(body)
  }
  catch {
    throw createError({ statusCode: 400, statusMessage: 'Invalid gaming summary JSON' })
  }
  const result = await ingestGamingSummary(summary, event.context.cloudflare.env, Date.now())
  if (result.unavailable)
    throw createError({ statusCode: 503, statusMessage: 'Gaming storage is unavailable' })
  if (result.error)
    throw createError({ statusCode: 400, statusMessage: result.error })
  setHeader(event, 'Cache-Control', 'no-store')
  return result
})
