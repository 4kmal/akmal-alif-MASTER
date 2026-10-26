import type { H3Event } from 'h3'
import * as analyticsWorker from '@portfolio-analytics'
import { parseAcceptLanguage } from 'intl-parse-accept-language'
import { UAParser } from 'ua-parser-js'
import {
  CLIs,
  Crawlers,
  Emails,
  ExtraDevices,
  Fetchers,
  InApps,
  MediaPlayers,
  Vehicles,
} from 'ua-parser-js/extensions'
import { parseURL } from 'ufo'
import { getFlag } from '#shared/utils/flag'

function toBlobNumber(blob: string) {
  return +blob.replace(/\D/g, '')
}

export const blobsMap = {
  blob1: 'slug',
  blob2: 'url',
  blob3: 'ua',
  blob4: 'ip',
  blob5: 'referer',
  blob6: 'country',
  blob7: 'region',
  blob8: 'city',
  blob9: 'timezone',
  blob10: 'language',
  blob11: 'os',
  blob12: 'browser',
  blob13: 'browserType',
  blob14: 'device',
  blob15: 'deviceType',
  blob16: 'COLO',
} as const

export const doublesMap = {
  double1: 'latitude',
  double2: 'longitude',
} as const

export type BlobsMap = typeof blobsMap
export type BlobsKey = keyof BlobsMap

export type DoublesMap = typeof doublesMap
export type DoublesKey = keyof DoublesMap

export type LogsKey = BlobsMap[BlobsKey] | DoublesMap[DoublesKey]
export type LogsMap = {
  [key in BlobsMap[BlobsKey]]: string | undefined
} & {
  [key in DoublesMap[DoublesKey]]?: number | undefined
}

export interface WebhookClickContext {
  country: string
  region: string
  city: string
  device: string
  browser: string
  os: string
  referer: string
}

export interface AccessLogResult {
  logs: LogsMap
  click: WebhookClickContext
}

export const logsMap = Object.fromEntries([
  ...Object.entries(blobsMap).map(([k, v]) => [v, k]),
  ...Object.entries(doublesMap).map(([k, v]) => [v, k]),
]) as LogsMap

export function logs2blobs(logs: LogsMap) {
  return (Object.keys(blobsMap) as BlobsKey[])
    .sort((a, b) => toBlobNumber(a) - toBlobNumber(b))
    .map(key => String(logs[blobsMap[key] as LogsKey] || ''))
}

export function blobs2logs(blobs: string[]) {
  const logsList = Object.keys(blobsMap)

  return blobs.reduce((logs, blob, i) => {
    const key = blobsMap[logsList[i] as BlobsKey]
    logs[key] = blob
    return logs
  }, {} as Partial<LogsMap>)
}

export function logs2doubles(logs: LogsMap) {
  return (Object.keys(doublesMap) as DoublesKey[])
    .sort((a, b) => toBlobNumber(a) - toBlobNumber(b))
    .map(key => Number(logs[doublesMap[key] as LogsKey] || 0))
}

export function doubles2logs(doubles: number[]) {
  const logsList = Object.keys(doublesMap)

  return doubles.reduce((logs, double, i) => {
    const key = doublesMap[logsList[i] as DoublesKey]
    logs[key] = double
    return logs
  }, {} as Partial<LogsMap>)
}

function getCountryName(country?: string): string {
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(country || 'WD') || 'Worldwide'
  }
  catch {
    return 'Worldwide'
  }
}

export function collectAccessLog(event: H3Event): AccessLogResult | undefined {
  const ip = getHeader(event, 'cf-connecting-ip') || getHeader(event, 'x-real-ip') || getRequestIP(event, { xForwardedFor: true })

  const { host: referer } = parseURL(getHeader(event, 'referer'))

  const acceptLanguage = getHeader(event, 'accept-language') || ''
  const language = (parseAcceptLanguage(acceptLanguage) || [])[0]

  const userAgent = getHeader(event, 'user-agent') || ''
  const uaInfo = (new UAParser(userAgent, {

    // @ts-expect-error
    browser: [Crawlers.browser || [], CLIs.browser || [], Emails.browser || [], Fetchers.browser || [], InApps.browser || [], MediaPlayers.browser || [], Vehicles.browser || []].flat(),

    // @ts-expect-error
    device: [ExtraDevices.device || []].flat(),
  })).getResult()

  const { cloudflare } = event.context
  const { request: { cf } } = cloudflare
  const link = event.context.link || {}

  const isBot = cf?.botManagement?.verifiedBot
    || ['crawler', 'fetcher'].includes(uaInfo?.browser?.type || '')
    || ['spider', 'bot'].includes(uaInfo?.browser?.name?.toLowerCase() || '')

  const { disableBotAccessLog } = useRuntimeConfig(event)
  if (isBot && disableBotAccessLog) {
    console.log('bot access log disabled:', userAgent)
    return
  }

  const countryName = getCountryName(cf?.country)
  const logs = {
    url: link.url,
    slug: link.slug,
    ua: userAgent,
    ip,
    referer,
    country: cf?.country,
    region: `${getFlag(cf?.country)} ${[cf?.region, countryName].filter(Boolean).join(',')}`,
    city: `${getFlag(cf?.country)} ${[cf?.city, countryName].filter(Boolean).join(',')}`,
    timezone: cf?.timezone,
    language,
    os: uaInfo?.os?.name,
    browser: uaInfo?.browser?.name,
    browserType: uaInfo?.browser?.type,
    device: uaInfo?.device?.model,
    deviceType: uaInfo?.device?.type,
    COLO: cf?.colo,

    // For RealTime Globe
    latitude: Number(cf?.latitude || getHeader(event, 'cf-iplatitude') || 0),
    longitude: Number(cf?.longitude || getHeader(event, 'cf-iplongitude') || 0),
  }

  return {
    logs,
    click: {
      country: cf?.country || '',
      region: cf?.region || '',
      city: cf?.city || '',
      device: uaInfo?.device?.type || uaInfo?.device?.model || '',
      browser: uaInfo?.browser?.name || '',
      os: uaInfo?.os?.name || '',
      referer: referer || '',
    },
  }
}

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('')
}

async function pseudonymousIp(ip: string | undefined, secret: string | undefined) {
  if (!ip || !secret || !globalThis.crypto?.subtle)
    return ''

  const key = await globalThis.crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await globalThis.crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`sink-ip-v1:${ip}`),
  )
  return `sink-ip-v1:${bytesToHex(new Uint8Array(signature))}`
}

function withoutQuery(value: string | undefined) {
  if (!value)
    return ''

  try {
    const parsed = new URL(value)
    return `${parsed.origin}${parsed.pathname || '/'}`
  }
  catch {
    return value.split(/[?#]/, 1)[0]
  }
}

async function nativeAnalyticsLogs(event: H3Event, accessLogs: LogsMap): Promise<LogsMap> {
  const { cloudflare } = event.context
  const env = cloudflare?.env as Record<string, string | undefined> | undefined
  const country = accessLogs.country || ''
  return {
    ...accessLogs,
    url: withoutQuery(accessLogs.url),
    // The native Sink dataset is retained longer than raw D1 detail. Store a
    // stable pseudonym and coarse browser facts, never the raw credentials.
    ua: [accessLogs.browser, accessLogs.os, accessLogs.deviceType].filter(Boolean).join(' / '),
    ip: await pseudonymousIp(accessLogs.ip, env?.ANALYTICS_ID_SECRET),
    region: country,
    city: '',
    timezone: '',
    language: '',
    device: '',
    latitude: 0,
    longitude: 0,
  }
}

function executionContext(event: H3Event): ExecutionContext | null {
  return event.context.cloudflare?.context ?? null
}

function analyticsEnvironment(event: H3Event): unknown {
  return event.context.cloudflare?.env ?? {}
}

function shortlinkEventData(event: H3Event, accessLogs: LogsMap) {
  const link = event.context.link || {}
  const slug = String(link.slug || accessLogs.slug || '')
  const requestId = getHeader(event, 'cf-ray') || crypto.randomUUID()
  return {
    event_id: `sink:${String(link.id || slug)}:${requestId}`,
    event_type: 'shortlink_click',
    slug,
    path: slug ? `/s/${slug}` : '/s/unknown',
    target: accessLogs.url,
    referrer: accessLogs.referer,
    ip: accessLogs.ip,
    user_agent: accessLogs.ua,
    country: accessLogs.country,
    region: accessLogs.region,
    city: accessLogs.city,
    timezone: accessLogs.timezone,
    latitude: accessLogs.latitude,
    longitude: accessLogs.longitude,
    colo: accessLogs.COLO,
  }
}

async function mirrorShortlinkEvent(event: H3Event, accessLogs: LogsMap) {
  const recordShortlinkEvent = (analyticsWorker as {
    recordShortlinkEvent?: (data: unknown, env: unknown, ctx: ExecutionContext | null) => Promise<unknown>
  }).recordShortlinkEvent
  if (!recordShortlinkEvent || !accessLogs.slug)
    return

  const task = recordShortlinkEvent(shortlinkEventData(event, accessLogs), analyticsEnvironment(event), executionContext(event))
  const context = executionContext(event)
  if (context?.waitUntil)
    context.waitUntil(task)
  else
    await task
}

export async function writeAccessLog(event: H3Event, accessLogs: LogsMap): Promise<void> {
  const { cloudflare } = event.context
  const link = event.context.link || {}

  if (process.env.NODE_ENV === 'production') {
    const analytics = cloudflare.env.ANALYTICS
    if (analytics) {
      const sanitizedLogs = await nativeAnalyticsLogs(event, accessLogs)
      analytics.writeDataPoint({
        indexes: [String(link.id || accessLogs.slug || '')], // only one index
        blobs: logs2blobs(sanitizedLogs),
        doubles: logs2doubles(sanitizedLogs),
      })
    }
  }
  else {
    console.log('access logs:', accessLogs)
  }

  await mirrorShortlinkEvent(event, accessLogs)
}
