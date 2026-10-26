import type { H3Event } from 'h3'
// The analytics worker is owned by the portfolio root and is bundled into the
// admin worker through this stable repo-relative import.
import * as analyticsWorker from '@portfolio-analytics'
import { createError, getQuery, readBody, sendWebResponse } from 'h3'
import { getRuntimeString } from '../utils/runtime-config'

interface AnalyticsWorker {
  handleAnalyticsRequest?: (request: Request, env: unknown, ctx: ExecutionContext) => Promise<Response>
  ingestEvents?: (request: Request, env: unknown, ctx: ExecutionContext) => Promise<Response>
  recordShortlinkEvent?: (eventData: unknown, env: unknown, ctx: ExecutionContext) => Promise<unknown>
}

function executionContext(event: H3Event): ExecutionContext {
  return event.context.cloudflare?.context ?? {
    waitUntil() {},
    passThroughOnException() {},
    props: {},
  } as unknown as ExecutionContext
}

function workerEnvironment(event: H3Event): unknown {
  return event.context.cloudflare?.env ?? {}
}

function loadAnalyticsWorker(): AnalyticsWorker | null {
  return analyticsWorker as unknown as AnalyticsWorker
}

function queryString(query: Record<string, unknown>) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (Array.isArray(value)) {
      for (const item of value)
        params.append(key, String(item))
    }
    else if (value !== undefined && value !== null) {
      params.set(key, String(value))
    }
  }
  return params.toString()
}

export async function handlePortfolioReport(event: H3Event, report: string): Promise<unknown> {
  const worker = loadAnalyticsWorker()
  if (!worker?.handleAnalyticsRequest) {
    throw createError({
      status: 503,
      statusText: 'Portfolio analytics is unavailable; no demo data is used.',
    })
  }

  const adminOrigin = getRuntimeString(event, 'portfolioAdminOrigin', 'PORTFOLIO_ADMIN_ORIGIN')
  const adminEmail = getRuntimeString(event, 'adminEmail', 'ADMIN_EMAIL')
  const query = getQuery(event) as Record<string, unknown>
  const suffix = queryString(query)
  const url = `${adminOrigin}/api/portfolio/${encodeURIComponent(report)}${suffix ? `?${suffix}` : ''}`
  const request = new Request(url, {
    method: 'GET',
    headers: {
      'X-Portfolio-Source': 'admin-ui',
      'X-Portfolio-Owner': adminEmail,
    },
  })
  const response = await worker.handleAnalyticsRequest(request, workerEnvironment(event), executionContext(event))
  if (!response.ok) {
    throw createError({ status: response.status, statusText: await response.text() || 'Portfolio analytics request failed' })
  }
  return response.headers.get('content-type')?.includes('application/json')
    ? response.json()
    : { sourceState: 'unavailable', sourceNote: await response.text() }
}

export async function ingestPortfolioEvents(event: H3Event): Promise<void> {
  const worker = loadAnalyticsWorker()
  if (!worker?.ingestEvents) {
    throw createError({ status: 503, statusText: 'Portfolio event ingestion is unavailable.' })
  }

  const body = await readBody(event)
  const headers = new Headers({ 'content-type': 'application/json' })
  const gatewayToken = getHeader(event, 'x-portfolio-gateway')
  const trustedMetadata = getHeader(event, 'x-portfolio-meta')
  if (gatewayToken)
    headers.set('x-portfolio-gateway', gatewayToken)
  if (trustedMetadata)
    headers.set('x-portfolio-meta', trustedMetadata)

  const upstream = new Request(`${getRuntimeString(event, 'portfolioAdminOrigin', 'PORTFOLIO_ADMIN_ORIGIN')}/internal/events`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
  const response = await worker.ingestEvents(upstream, workerEnvironment(event), executionContext(event))
  if (!response.ok)
    throw createError({ status: response.status, statusText: await response.text() || 'Event ingestion failed' })

  // Preserve the analytics worker's response as a Web Response. In particular,
  // h3's sendWebResponse handles multiple Set-Cookie values without collapsing
  // the visitor and session cookies into one header.
  await sendWebResponse(event, response)
}
