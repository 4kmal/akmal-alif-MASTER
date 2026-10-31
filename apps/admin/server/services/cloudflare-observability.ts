import type { H3Event } from 'h3'
import type {
  BillingUsage,
  CloudflareBilling,
  CloudflareReport,
  CloudflareResource,
  ObservabilityMetric,
  ReportMeta,
  SourceCoverage,
  SourceStatus,
} from '../../shared/types/observability'
import { createError, getQuery } from 'h3'
import { getRuntimeString } from '../utils/runtime-config'

export const CLOUDFLARE_ACCOUNT_ID = '73138007ecb740aea99f9c99bb2a2705'
export const CLOUDFLARE_API_URL = 'https://api.cloudflare.com/client/v4'
export const CLOUDFLARE_GRAPHQL_URL = `${CLOUDFLARE_API_URL}/graphql`
export const CLOUDFLARE_BILLING_URL = `https://dash.cloudflare.com/${CLOUDFLARE_ACCOUNT_ID}/billing`
export const OBSERVABILITY_TIMEZONE = 'UTC'
export const OBSERVABILITY_CACHE_MS = 5 * 60 * 1000
export const INVENTORY_CACHE_MS = 60 * 60 * 1000
export const MAX_REPORT_CACHE_ENTRIES = 32
export const LIVE_GRAPHQL_RETENTION_MS = 31 * 24 * 60 * 60 * 1000
export const MAX_QUERY_RANGE_MS = 13 * 31 * 24 * 60 * 60 * 1000
export const SNAPSHOT_RETENTION_MS = 90 * 24 * 60 * 60 * 1000
export const DAILY_RETENTION_MONTHS = 13
export const PRICING_VERSION = 'docs-2026-10-31'
export const PRICING_AS_OF = 'docs-2026-10-31'
const MAX_BILLING_METRIC_CACHE_ENTRIES = 32
const ACCOUNT_BILLING_SCOPE_REASON = 'Billing consumption and allowances are account-wide; project views reuse shared account metrics and may include unattributed costs.'

const WORKER_NAMES = new Set(['akmalalif-admin', 'akmalalif-portfolio'])
const D1_NAMES = new Set(['akmalalif-admin', 'akmalalif-portfolio'])
const D1_IDS = new Set([
  '23b07f54-d1d0-491d-9ec3-b6a67315e018',
  '675ccbd5-f4aa-4ad6-b292-0d8fac7c54d5',
])
const R2_NAMES = new Set(['akmalalif-admin-data', 'akmalalif-portfolio-media'])
const KV_IDS = new Set(['b810de9ed6d0491c905b088d3f5b4cb7'])
const ZONE_NAMES = new Set(['akmalalif.com', 'www.akmalalif.com'])

type QueryValue = string | string[] | number | boolean | null | undefined

export interface CloudflareEnvironment {
  DB?: D1Like
  __observabilityBindings?: VerifiedBindings
  [key: string]: unknown
}

interface D1StatementLike {
  bind: (...values: unknown[]) => D1StatementLike
  run?: () => Promise<unknown>
  first?: <T extends Record<string, unknown>>() => Promise<T | null>
  all?: <T extends Record<string, unknown>>() => Promise<{ results?: T[] }>
}

interface D1Like {
  prepare: (query: string) => D1StatementLike
}

export interface CloudflareQuery {
  from: Date
  to: Date
  scope: 'account' | 'akmalalif'
  range: string
  historical: boolean
  preset?: boolean
}

interface ProviderErrorInit {
  status?: number
  source?: string
  code?: string
}

export class CloudflareProviderError extends Error {
  readonly status?: number
  readonly source?: string
  readonly code?: string

  constructor(message: string, init: ProviderErrorInit = {}) {
    super(message)
    this.name = 'CloudflareProviderError'
    this.status = init.status
    this.source = init.source
    this.code = init.code
  }
}

interface JsonRecord {
  [key: string]: unknown
}

interface CloudflareApiResponse extends JsonRecord {
  success?: boolean
  result?: unknown
  errors?: unknown
  result_info?: JsonRecord
}

interface InventoryResult {
  resources: CloudflareResource[]
  deployments: CloudflareReport['deployments']
  serviceResources: CloudflareResource[]
  coverage: SourceCoverage[]
  verifiedBindings: VerifiedBindings
}

interface VerifiedBindings {
  workerNames: Set<string>
  d1Ids: Set<string>
  d1Names: Set<string>
  kvIds: Set<string>
  r2Names: Set<string>
  durableObjectIds: Set<string>
  durableObjectNames: Set<string>
  serviceNames: Set<string>
  datasets: Set<string>
}

interface SourceData {
  coverage: SourceCoverage
  metrics: ObservabilityMetric[]
  series: CloudflareReport['series']
}

interface GraphqlResponse {
  data?: JsonRecord
  errors?: unknown
}

interface MetricRow extends JsonRecord {
  dimensions?: JsonRecord
  sum?: JsonRecord
  avg?: JsonRecord
  max?: JsonRecord
  quantiles?: JsonRecord
  ratio?: JsonRecord
  count?: number | string | null
}

interface CachedReport {
  expiresAt: number
  report: CloudflareReport
}

interface CachedInventory {
  expiresAt: number
  result: InventoryResult
}

interface CachedBillingMetrics {
  expiresAt: number
  metrics: ObservabilityMetric[]
  complete: boolean
  reason?: string
}

interface BillingMetricsResult {
  metrics: ObservabilityMetric[]
  complete: boolean
  reason?: string
}

interface ActualBillingResult {
  charges: number | null
  fixedFees: number | null
  cycle: { from: string, to: string, source: string } | null
  currency?: string
  reason?: string
}

interface ProviderRatedUsage {
  amount: number | null
  currency?: string
  reason: string
}

interface CachedActualBilling {
  expiresAt: number
  result: ActualBillingResult
}

const reportCache = new Map<string, CachedReport>()
const inventoryCache = new Map<string, CachedInventory>()
const billingMetricCache = new Map<string, CachedBillingMetrics>()
const actualBillingCache = new Map<string, CachedActualBilling>()

const GRAPHQL_QUERIES = {
  durableObjectsInvocations: `
    query DurableObjectsInvocations($accountTag: String!, $from: DateTime!, $to: DateTime!) {
      viewer {
        accounts(filter: { accountTag: $accountTag }) {
          durableObjectsInvocationsAdaptiveGroups(
            limit: 1000
            filter: { datetime_geq: $from, datetime_leq: $to }
          ) {
            sum { errors requests responseBodySize wallTime }
            quantiles {
              cpuTimeP50 cpuTimeP90 cpuTimeP99 cpuTimeP999
              responseBodySizeP50 responseBodySizeP99
              wallTimeP50 wallTimeP99
            }
            dimensions { datetimeFifteenMinutes datetime namespaceId name objectId scriptName status type }
          }
        }
      }
    }
  `,
  durableObjectsPeriodic: `
    query DurableObjectsPeriodic($accountTag: String!, $from: DateTime!, $to: DateTime!) {
      viewer {
        accounts(filter: { accountTag: $accountTag }) {
          durableObjectsPeriodicGroups(
            limit: 1000
            filter: { datetime_geq: $from, datetime_leq: $to }
          ) {
            sum {
              activeTime cpuTime duration inboundWebsocketMsgCount outboundWebsocketMsgCount
              rowsRead rowsWritten storageDeletes storageReadUnits storageWriteUnits subrequests
            }
            quantiles {
              memoryUsageBytesP50 memoryUsageBytesP90 memoryUsageBytesP99 memoryUsageBytesP999
            }
            dimensions { datetimeFifteenMinutes datetime namespaceId name objectId }
          }
        }
      }
    }
  `,
  durableObjectsStorage: `
    query DurableObjectsStorage($accountTag: String!, $from: DateTime!, $to: DateTime!) {
      viewer {
        accounts(filter: { accountTag: $accountTag }) {
          durableObjectsStorageGroups(
            limit: 1000
            filter: { datetime_geq: $from, datetime_leq: $to }
          ) {
            max { storedBytes }
            dimensions { datetimeFifteenMinutes datetime namespaceIds }
          }
        }
      }
    }
  `,
  d1Analytics: `
    query D1Analytics($accountTag: String!, $from: DateTime!, $to: DateTime!) {
      viewer {
        accounts(filter: { accountTag: $accountTag }) {
          d1AnalyticsAdaptiveGroups(
            limit: 1000
            filter: { datetime_geq: $from, datetime_leq: $to }
          ) {
            sum { queryBatchResponseBytes readQueries rowsRead rowsWritten writeQueries }
            dimensions { datetimeFifteenMinutes datetime databaseId }
          }
        }
      }
    }
  `,
  d1Storage: `
    query D1Storage($accountTag: String!, $from: DateTime!, $to: DateTime!) {
      viewer {
        accounts(filter: { accountTag: $accountTag }) {
          d1StorageAdaptiveGroups(
            limit: 1000
            filter: { datetime_geq: $from, datetime_leq: $to }
          ) {
            max { databaseSizeBytes }
            dimensions { datetimeFifteenMinutes datetime databaseId }
          }
        }
      }
    }
  `,
  kvOperations: `
    query KvOperations($accountTag: String!, $from: DateTime!, $to: DateTime!) {
      viewer {
        accounts(filter: { accountTag: $accountTag }) {
          kvOperationsAdaptiveGroups(
            limit: 1000
            filter: { datetime_geq: $from, datetime_leq: $to }
          ) {
            sum { objectBytes requests }
            dimensions { datetimeFifteenMinutes datetime namespaceId actionType }
          }
        }
      }
    }
  `,
  kvStorage: `
    query KvStorage($accountTag: String!, $from: DateTime!, $to: DateTime!) {
      viewer {
        accounts(filter: { accountTag: $accountTag }) {
          kvStorageAdaptiveGroups(
            limit: 1000
            filter: { datetime_geq: $from, datetime_leq: $to }
          ) {
            max { byteCount keyCount }
            dimensions { datetimeFifteenMinutes datetime namespaceId }
          }
        }
      }
    }
  `,
  r2Operations: `
    query R2Operations($accountTag: String!, $from: DateTime!, $to: DateTime!) {
      viewer {
        accounts(filter: { accountTag: $accountTag }) {
          r2OperationsAdaptiveGroups(
            limit: 1000
            filter: { datetime_geq: $from, datetime_leq: $to }
          ) {
            sum { requests responseBytes responseObjectSize }
            dimensions { datetimeFifteenMinutes datetime bucketName actionType }
          }
        }
      }
    }
  `,
  r2Storage: `
    query R2Storage($accountTag: String!, $from: DateTime!, $to: DateTime!) {
      viewer {
        accounts(filter: { accountTag: $accountTag }) {
          r2StorageAdaptiveGroups(
            limit: 1000
            filter: { datetime_geq: $from, datetime_leq: $to }
          ) {
            max { metadataSize objectCount payloadSize uploadCount }
            dimensions { datetimeFifteenMinutes datetime bucketName storageClass }
          }
        }
      }
    }
  `,
  zones: `
    query Zones($accountTag: String!, $from: DateTime!, $to: DateTime!) {
      viewer {
        accounts(filter: { accountTag: $accountTag }) {
          zonesAggregate: httpRequestsAdaptiveGroups(
            limit: 1
            filter: { datetime_geq: $from, datetime_leq: $to }
          ) {
            count
            sum { edgeRequestBytes edgeResponseBytes originResponseDurationMs }
            ratio { status4xx status5xx }
          }
          zonesByZone: httpRequestsAdaptiveGroups(
            limit: 1000
            filter: { datetime_geq: $from, datetime_leq: $to }
          ) {
            count
            sum { edgeRequestBytes edgeResponseBytes originResponseDurationMs }
            ratio { status4xx status5xx }
            dimensions { zoneTag clientRequestHTTPHost }
          }
          zonesSeries: httpRequestsAdaptiveGroups(
            limit: 1000
            filter: { datetime_geq: $from, datetime_leq: $to }
          ) {
            count
            sum { edgeRequestBytes edgeResponseBytes originResponseDurationMs }
            dimensions {
              datetimeFifteenMinutes datetime zoneTag
            }
          }
          zonesCache: httpRequestsAdaptiveGroups(
            limit: 1000
            filter: { datetime_geq: $from, datetime_leq: $to }
          ) {
            count
            dimensions { cacheStatus zoneTag clientRequestHTTPHost }
          }
          zonesStatus: httpRequestsAdaptiveGroups(
            limit: 1000
            filter: { datetime_geq: $from, datetime_leq: $to }
          ) {
            count
            dimensions { edgeResponseStatus zoneTag clientRequestHTTPHost }
          }
        }
      }
    }
  `,
  analyticsEngine: `
    query AnalyticsEngine($accountTag: String!, $from: DateTime!, $to: DateTime!) {
      viewer {
        accounts(filter: { accountTag: $accountTag }) {
          workersAnalyticsEngineAdaptiveGroups(
            limit: 1000
            filter: { datetime_geq: $from, datetime_leq: $to }
          ) {
            count
            dimensions { datetimeFifteenMinutes datetime dataset }
          }
        }
      }
    }
  `,
  ai: `
    query Ai($accountTag: String!, $from: DateTime!, $to: DateTime!) {
      viewer {
        accounts(filter: { accountTag: $accountTag }) {
          aiInferenceAdaptiveGroups(
            limit: 1000
            filter: { datetime_geq: $from, datetime_leq: $to }
          ) {
            count
          }
        }
      }
    }
  `,
  queues: `
    query Queues($accountTag: String!, $from: DateTime!, $to: DateTime!) {
      viewer {
        accounts(filter: { accountTag: $accountTag }) {
          queueMessageOperationsAdaptiveGroups(
            limit: 1000
            filter: { datetime_geq: $from, datetime_leq: $to }
          ) {
            count
            sum { bytes }
            dimensions { datetimeFifteenMinutes datetime queueId actionType consumerType outcome }
          }
          queueBacklogAdaptiveGroups(
            limit: 1000
            filter: { datetime_geq: $from, datetime_leq: $to }
          ) {
            avg { messages bytes }
            dimensions { datetimeFifteenMinutes datetime queueId }
          }
          queueConsumerMetricsAdaptiveGroups(
            limit: 1000
            filter: { datetime_geq: $from, datetime_leq: $to }
          ) {
            avg { concurrency }
            dimensions { datetimeFifteenMinutes datetime queueId }
          }
        }
      }
    }
  `,
  workflows: `
    query Workflows($accountTag: String!, $from: DateTime!, $to: DateTime!) {
      viewer {
        accounts(filter: { accountTag: $accountTag }) {
          workflowsAdaptiveGroups(
            limit: 1000
            filter: { datetime_geq: $from, datetime_leq: $to }
          ) {
            count
            sum { wallTime }
            dimensions { datetimeFifteenMinutes datetime workflowName eventType }
          }
        }
      }
    }
  `,
  builds: `
    query Builds($accountTag: String!, $from: DateTime!, $to: DateTime!) {
      viewer {
        accounts(filter: { accountTag: $accountTag }) {
          workersBuildsBuildMinutesAdaptiveGroups(
            limit: 1000
            filter: { datetime_geq: $from, datetime_leq: $to }
          ) {
            sum { buildMinutes }
          }
        }
      }
    }
  `,
} as const

const GRAPHQL_GROUP_LIMIT = 1000

function workersGraphqlQuery(rangeMs: number): string {
  const seriesDimension = rangeMs > 48 * 60 * 60 * 1000 ? 'date' : 'datetimeHour'
  return `
    query Workers($accountTag: String!, $from: DateTime!, $to: DateTime!) {
      viewer {
        accounts(filter: { accountTag: $accountTag }) {
          workersAggregate: workersInvocationsAdaptive(
            limit: 1
            filter: { datetime_geq: $from, datetime_leq: $to }
          ) {
            sum { requests errors subrequests cpuTimeUs duration wallTime }
            quantiles {
              cpuTimeP50 cpuTimeP90 cpuTimeP99 cpuTimeP999
              memoryUsageBytesP50 memoryUsageBytesP90 memoryUsageBytesP99 memoryUsageBytesP999
              wallTimeP50 wallTimeP90 wallTimeP99 wallTimeP999
              durationP50 durationP99
            }
          }
          workersByScript: workersInvocationsAdaptive(
            limit: 1000
            filter: { datetime_geq: $from, datetime_leq: $to }
          ) {
            sum { requests errors subrequests cpuTimeUs duration wallTime }
            quantiles {
              cpuTimeP50 cpuTimeP90 cpuTimeP99 cpuTimeP999
              memoryUsageBytesP50 memoryUsageBytesP90 memoryUsageBytesP99 memoryUsageBytesP999
              wallTimeP50 wallTimeP90 wallTimeP99 wallTimeP999
              durationP50 durationP99
            }
            dimensions { scriptName }
          }
          workersSeries: workersInvocationsAdaptive(
            limit: 1000
            filter: { datetime_geq: $from, datetime_leq: $to }
          ) {
            sum { requests errors subrequests cpuTimeUs duration wallTime }
            quantiles {
              cpuTimeP50 cpuTimeP90 cpuTimeP99 cpuTimeP999
              memoryUsageBytesP50 memoryUsageBytesP90 memoryUsageBytesP99 memoryUsageBytesP999
              wallTimeP50 wallTimeP90 wallTimeP99 wallTimeP999
              durationP50 durationP99
            }
            dimensions { ${seriesDimension} scriptName }
          }
        }
      }
    }
  `
}

const emptyCoverageSources = [
  'inventory.workers',
  'inventory.pages',
  'inventory.d1',
  'inventory.r2',
  'inventory.kv',
  'inventory.durable_objects',
  'inventory.services',
  'inventory.zones',
  'inventory.worker_bindings',
  'workers',
  'durable_objects',
  'd1',
  'kv',
  'r2',
  'zones',
  'analytics_engine',
  'ai',
  'queues',
  'workflows',
  'builds',
  'billing',
]

const rangeDurations: Record<string, number> = {
  '15m': 15 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
  '90d': 90 * 24 * 60 * 60 * 1000,
  '13m': 13 * 31 * 24 * 60 * 60 * 1000,
}

function queryString(value: QueryValue): string | undefined {
  if (Array.isArray(value))
    return typeof value[0] === 'string' ? value[0] : undefined
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
    return String(value)
  return undefined
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number')
    return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : null
}

function asArray(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.filter(item => asRecord(item) !== null) as JsonRecord[] : []
}

function resultRows(value: unknown, resultKey?: string): JsonRecord[] {
  const direct = asArray(value)
  if (direct.length || Array.isArray(value))
    return direct
  const record = asRecord(value)
  return resultKey ? asArray(record?.[resultKey]) : []
}

function iso(value: Date | number): string {
  return new Date(value).toISOString()
}

function floorQuarter(value: number): number {
  return Math.floor(value / (15 * 60 * 1000)) * 15 * 60 * 1000
}

export function parseCloudflareQuery(query: Record<string, QueryValue> = {}, now = Date.now()): CloudflareQuery {
  const scopeValue = queryString(query.scope)?.trim().toLowerCase() || 'account'
  if (scopeValue !== 'account' && scopeValue !== 'akmalalif')
    throw createError({ statusCode: 400, statusMessage: 'scope must be account or akmalalif' })

  const fromValue = queryString(query.from)
  const toValue = queryString(query.to)
  const rangeValue = queryString(query.range)?.trim().toLowerCase() || '24h'
  let from: Date
  let to: Date
  if (fromValue || toValue) {
    if (!fromValue || !toValue)
      throw createError({ statusCode: 400, statusMessage: 'from and to must be provided together' })
    from = new Date(fromValue)
    to = new Date(toValue)
    if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()))
      throw createError({ statusCode: 400, statusMessage: 'from and to must be valid ISO timestamps' })
  }
  else {
    const duration = rangeDurations[rangeValue]
    if (!duration)
      throw createError({ statusCode: 400, statusMessage: 'range must be 15m, 1h, 24h, 7d, 30d, 90d, or 13m' })
    to = new Date(now)
    from = new Date(now - duration)
  }

  if (from.getTime() >= to.getTime())
    throw createError({ statusCode: 400, statusMessage: 'from must be before to' })
  if (to.getTime() > now + 5 * 60 * 1000)
    throw createError({ statusCode: 400, statusMessage: 'to cannot be in the future' })
  if (to.getTime() - from.getTime() > MAX_QUERY_RANGE_MS)
    throw createError({ statusCode: 400, statusMessage: 'The requested range is too large' })

  return {
    from,
    to,
    scope: scopeValue,
    range: rangeValue,
    historical: to.getTime() < now - LIVE_GRAPHQL_RETENTION_MS,
    preset: !fromValue && !toValue,
  }
}

export function normalizeProviderError(error: unknown, source?: string): CloudflareProviderError {
  if (error instanceof CloudflareProviderError)
    return error
  const record = asRecord(error)
  const status = asFiniteNumber(record?.status ?? record?.statusCode)
  const message = error instanceof Error
    ? error.message
    : typeof record?.message === 'string' ? record.message : 'Cloudflare provider request failed'
  return new CloudflareProviderError(message, {
    status: status ?? undefined,
    source,
    code: typeof record?.code === 'string' ? record.code : undefined,
  })
}

export function applyAllowance(consumed: number, included: number, ratePerUnit: number): { billable: number, estimatedCost: number } {
  const safeConsumed = Number.isFinite(consumed) ? Math.max(0, consumed) : 0
  const safeIncluded = Number.isFinite(included) ? Math.max(0, included) : 0
  const billable = Math.max(0, safeConsumed - safeIncluded)
  return { billable, estimatedCost: billable * ratePerUnit }
}

export function cpuMicrosecondsToMilliseconds(value: number | null): number | null {
  return value === null ? null : value / 1000
}

export function durableObjectBillableRequests(rawIncomingWebsocketMessages: number | null): number | null {
  return rawIncomingWebsocketMessages === null ? null : rawIncomingWebsocketMessages / 20
}

export function sumMetricValues(values: Array<number | null>): number | null {
  const present = values.filter((value): value is number => value !== null && Number.isFinite(value))
  return present.length ? present.reduce((sum, value) => sum + value, 0) : null
}

export function getBillingCycle(value: Date | number): { from: string, to: string, source: string } {
  const date = new Date(value)
  const anchorDay = 8
  const currentAnchor = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), anchorDay))
  const fromDate = date.getTime() >= currentAnchor.getTime()
    ? currentAnchor
    : new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - 1, anchorDay))
  const toDate = new Date(Date.UTC(fromDate.getUTCFullYear(), fromDate.getUTCMonth() + 1, anchorDay))
  return { from: fromDate.toISOString(), to: toDate.toISOString(), source: 'estimated:anchor-day-8' }
}

function emptyVerifiedBindings(): VerifiedBindings {
  return {
    workerNames: new Set(),
    d1Ids: new Set(),
    d1Names: new Set(),
    kvIds: new Set(),
    r2Names: new Set(),
    durableObjectIds: new Set(),
    durableObjectNames: new Set(),
    serviceNames: new Set(),
    datasets: new Set(),
  }
}

function addBindingValue(target: Set<string>, value: unknown): void {
  if (typeof value === 'string' && value.trim())
    target.add(value.trim().toLowerCase())
}

/**
 * Extract only non-secret binding metadata from a Worker settings response.
 * Secret and text bindings are intentionally ignored, including their values.
 */
export function bindingIdentifiersFromSettings(value: unknown): VerifiedBindings {
  const bindings = emptyVerifiedBindings()
  const response = asRecord(value)
  const result = asRecord(response?.result)
  for (const binding of asArray(result?.bindings)) {
    const type = typeof binding.type === 'string' ? binding.type.toLowerCase() : ''
    switch (type) {
      case 'd1':
        addBindingValue(bindings.d1Ids, binding.database_id ?? binding.id)
        addBindingValue(bindings.d1Names, binding.name)
        break
      case 'kv_namespace':
        addBindingValue(bindings.kvIds, binding.namespace_id)
        break
      case 'r2_bucket':
        addBindingValue(bindings.r2Names, binding.bucket_name)
        break
      case 'analytics_engine':
        addBindingValue(bindings.datasets, binding.dataset)
        break
      case 'service':
        addBindingValue(bindings.serviceNames, binding.service)
        break
      case 'durable_object_namespace':
        addBindingValue(bindings.durableObjectIds, binding.namespace_id)
        addBindingValue(bindings.durableObjectNames, binding.name)
        break
      default:
        break
    }
  }
  return bindings
}

function mergeVerifiedBindings(target: VerifiedBindings, source: VerifiedBindings): void {
  for (const [key, values] of Object.entries(source) as Array<[keyof VerifiedBindings, Set<string>]>) {
    const destination = target[key]
    for (const value of values)
      destination.add(value)
  }
}

function withVerifiedBindings(env: CloudflareEnvironment, bindings: VerifiedBindings): CloudflareEnvironment {
  return { ...env, __observabilityBindings: bindings }
}

function projectForResource(kind: string, id: string, name: string, env: CloudflareEnvironment): CloudflareResource['project'] {
  const normalizedKind = kind.toLowerCase()
  const normalizedId = id.trim().toLowerCase()
  const normalizedName = name.trim().toLowerCase()
  const bindings = env.__observabilityBindings
  if (normalizedKind === 'zone' && ZONE_NAMES.has(normalizedName))
    return 'akmalalif'
  if ((normalizedKind === 'worker' || normalizedKind === 'worker_service') && (WORKER_NAMES.has(normalizedName) || bindings?.workerNames.has(normalizedName) || bindings?.serviceNames.has(normalizedName)))
    return 'akmalalif'
  if (normalizedKind === 'd1' && (D1_NAMES.has(normalizedName) || D1_IDS.has(normalizedId) || bindings?.d1Names.has(normalizedName) || bindings?.d1Ids.has(normalizedId)))
    return 'akmalalif'
  if (normalizedKind === 'r2' && (R2_NAMES.has(normalizedName) || bindings?.r2Names.has(normalizedName)))
    return 'akmalalif'
  const configuredKvIds = [env.DEPLOY_KV_NAMESPACE_ID, env.DEPLOY_KV_PREVIEW_NAMESPACE_ID]
    .filter(value => typeof value === 'string')
    .map(value => value.toLowerCase())
  if (normalizedKind === 'kv' && (KV_IDS.has(normalizedId) || configuredKvIds.includes(normalizedId) || bindings?.kvIds.has(normalizedId)))
    return 'akmalalif'
  if (normalizedKind === 'durable_object' && (WORKER_NAMES.has(normalizedName) || WORKER_NAMES.has(normalizedId) || bindings?.durableObjectNames.has(normalizedName) || bindings?.durableObjectIds.has(normalizedId)))
    return 'akmalalif'
  if (normalizedKind === 'worker' || normalizedKind === 'worker_service' || normalizedKind === 'pages')
    return 'other'
  return 'unassigned'
}

function resourceAllowed(resource: { id?: unknown, name?: unknown, kind?: unknown }, scope: CloudflareQuery['scope'], env: CloudflareEnvironment): boolean {
  if (scope === 'account')
    return true
  const id = typeof resource.id === 'string' ? resource.id : ''
  const name = typeof resource.name === 'string' ? resource.name : ''
  const kind = typeof resource.kind === 'string' ? resource.kind : ''
  return projectForResource(kind, id, name, env) === 'akmalalif'
}

function metric(key: string, label: string, value: number | null, unit: string, options: Partial<ObservabilityMetric> = {}): ObservabilityMetric {
  return { key, label, value, unit, ...options }
}

function coverage(source: string, status: SourceStatus, checkedAt: string, reason?: string, sampled = false): SourceCoverage {
  return { source, status, checkedAt, ...(reason ? { reason } : {}), ...(sampled ? { sampled: true } : {}) }
}

function providerStatus(error: unknown): SourceStatus {
  const normalized = normalizeProviderError(error)
  if (normalized.status === 403 || normalized.status === 401)
    return 'unavailable'
  return 'unavailable'
}

function providerReason(error: unknown): string {
  const normalized = normalizeProviderError(error)
  if (normalized.status === 403)
    return 'Cloudflare denied this dataset (HTTP 403).'
  if (normalized.status === 401)
    return 'Cloudflare credentials are unauthorized (HTTP 401).'
  return normalized.message
}

function rejectedReason(result: PromiseSettledResult<unknown> | undefined): unknown {
  return result?.status === 'rejected' ? result.reason : undefined
}

function timestampFromRow(row: MetricRow): string | null {
  const dimensions = asRecord(row.dimensions)
  const value = dimensions?.datetimeFifteenMinutes ?? dimensions?.datetimeHour ?? dimensions?.datetime ?? dimensions?.date
  return typeof value === 'string' ? value : null
}

function fieldValue(row: MetricRow, group: 'sum' | 'avg' | 'max' | 'quantiles' | 'ratio', field: string): number | null {
  const values = asRecord(row[group])
  return asFiniteNumber(values?.[field])
}

function rowCount(row: MetricRow): number | null {
  return asFiniteNumber(row.count)
}

function rowResourceId(row: MetricRow, fields: string[]): string | undefined {
  const dimensions = asRecord(row.dimensions)
  for (const field of fields) {
    const value = dimensions?.[field]
    if (typeof value === 'string' && value.trim())
      return value
    if (Array.isArray(value)) {
      const first = value.find(item => typeof item === 'string' && item.trim())
      if (typeof first === 'string')
        return first
    }
  }
  return undefined
}

function rowResourceIds(row: MetricRow, fields: string[]): string[] {
  const dimensions = asRecord(row.dimensions)
  const values: string[] = []
  for (const field of fields) {
    const value = dimensions?.[field]
    if (typeof value === 'string' && value.trim())
      values.push(value)
    else if (Array.isArray(value))
      values.push(...value.filter(item => typeof item === 'string' && item.trim()) as string[])
  }
  return values
}

function rowDimension(row: MetricRow, field: string): string | undefined {
  const value = asRecord(row.dimensions)?.[field]
  return typeof value === 'string' ? value : undefined
}

function sumRows(rows: MetricRow[], group: 'sum' | 'avg' | 'max' | 'quantiles' | 'ratio', field: string): number | null {
  const values = rows.map(row => fieldValue(row, group, field)).filter((value): value is number => value !== null)
  return values.length ? values.reduce((sum, value) => sum + value, 0) : null
}

function maxRows(rows: MetricRow[], group: 'sum' | 'avg' | 'max' | 'quantiles' | 'ratio', field: string): number | null {
  const values = rows.map(row => fieldValue(row, group, field)).filter((value): value is number => value !== null)
  return values.length ? Math.max(...values) : null
}

function sumLatestRows(rows: MetricRow[], group: 'sum' | 'avg' | 'max' | 'quantiles' | 'ratio', field: string, resourceFields: string[]): number | null {
  const latest = new Map<string, { timestamp: string, value: number }>()
  for (const [index, row] of rows.entries()) {
    const value = fieldValue(row, group, field)
    if (value === null)
      continue
    const resource = rowResourceId(row, resourceFields) ?? `row-${index}`
    const timestamp = timestampFromRow(row) ?? ''
    const previous = latest.get(resource)
    if (!previous || timestamp >= previous.timestamp)
      latest.set(resource, { timestamp, value })
  }
  return latest.size ? [...latest.values()].reduce((sum, entry) => sum + entry.value, 0) : null
}

function groupLimitReason(source: string, groups: Array<{ label: string, rows: MetricRow[] }>): string | undefined {
  const capped = groups.filter(group => group.rows.length >= GRAPHQL_GROUP_LIMIT).map(group => group.label)
  return capped.length
    ? `Cloudflare returned the ${GRAPHQL_GROUP_LIMIT}-group limit for ${source} (${capped.join(', ')}); those groups may be truncated.`
    : undefined
}

function pushMetric(target: ObservabilityMetric[], key: string, label: string, value: number | null, unit: string, options: Partial<ObservabilityMetric> = {}): void {
  if (value === null)
    return
  target.push(metric(key, label, value, unit, options))
}

function addSeries(target: CloudflareReport['series'], rows: MetricRow[], fieldGroup: 'sum' | 'avg' | 'max' | 'quantiles' | 'ratio', field: string, key: string, unit: string, resourceFields: string[]): void {
  for (const row of rows) {
    const value = fieldValue(row, fieldGroup, field)
    const timestamp = timestampFromRow(row)
    if (value === null || !timestamp)
      continue
    target.push({ timestamp, metric: `${key}.${field}`, value, ...(rowResourceId(row, resourceFields) ? { resourceId: rowResourceId(row, resourceFields) } : {}) })
  }
}

function filterRows(rows: MetricRow[], scope: CloudflareQuery['scope'], env: CloudflareEnvironment, resourceFields: string[], kind: string): MetricRow[] {
  if (scope === 'account')
    return rows
  return rows.filter((row) => {
    const ids = rowResourceIds(row, resourceFields)
    return ids.some(id => resourceAllowed({ id, name: id, kind }, scope, env))
  })
}

function accountResult(data: GraphqlResponse, field: string): MetricRow[] {
  const viewer = asRecord(data.data?.viewer)
  const accounts = asArray(viewer?.accounts)
  const account = accounts[0]
  return asArray(account?.[field]) as MetricRow[]
}

function graphQlRequestError(body: GraphqlResponse, source: string): CloudflareProviderError | null {
  if (!body.errors)
    return null
  const errors = asArray(body.errors).map((error) => {
    const record = asRecord(error)
    return typeof record?.message === 'string' ? record.message : 'GraphQL query failed'
  })
  return new CloudflareProviderError(errors.join('; ') || 'GraphQL query failed', { source })
}

function getEnvString(env: CloudflareEnvironment, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = env[key]
    if (typeof value === 'string' && value.trim())
      return value.trim()
  }
  return undefined
}

function apiBase(env: CloudflareEnvironment): string {
  return getEnvString(env, 'CF_OBSERVABILITY_API_URL', 'CF_API_URL')?.replace(/\/$/, '') || CLOUDFLARE_API_URL
}

function cloudflareUrl(env: CloudflareEnvironment, path: string): URL {
  const base = apiBase(env)
  const baseUrl = new URL(`${base}/`)
  if (path.startsWith(baseUrl.pathname))
    return new URL(`${baseUrl.origin}${path}`)
  return new URL(path.startsWith('/') ? `${base}${path}` : `${base}/${path}`, `${base}/`)
}

async function responseJson(response: Response): Promise<CloudflareApiResponse> {
  let body: unknown
  try {
    body = await response.json()
  }
  catch {
    throw new CloudflareProviderError('Cloudflare returned invalid JSON', { status: response.status })
  }
  const record = asRecord(body)
  if (!record)
    throw new CloudflareProviderError('Cloudflare returned an invalid response', { status: response.status })
  return record as CloudflareApiResponse
}

async function cloudflareRest(env: CloudflareEnvironment, token: string, path: string, source: string): Promise<CloudflareApiResponse> {
  const url = cloudflareUrl(env, path)
  const response = await fetch(url, {
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/json',
    },
  })
  const body = await responseJson(response)
  if (!response.ok || body.success === false) {
    const firstError = asArray(body.errors)[0]
    const message = asRecord(firstError)?.message
    throw new CloudflareProviderError(typeof message === 'string' ? message : `Cloudflare ${source} request failed`, {
      status: response.status,
      source,
    })
  }
  return body
}

export async function paginateCloudflareRest<T extends JsonRecord>(
  env: CloudflareEnvironment,
  token: string,
  path: string,
  source: string,
  limit = 1000,
  resultKey?: string,
): Promise<T[]> {
  const result: T[] = []
  const firstUrl = cloudflareUrl(env, path)
  firstUrl.searchParams.set('page', '1')
  firstUrl.searchParams.set('per_page', String(Math.min(1000, Math.max(1, limit))))
  let page = 1
  let totalPages = 1
  do {
    const pageUrl = page === 1 ? firstUrl : new URL(firstUrl.toString())
    pageUrl.searchParams.set('page', String(page))
    const body = await cloudflareRest(env, token, `${pageUrl.pathname}${pageUrl.search}`, source)
    result.push(...resultRows(body.result, resultKey) as T[])
    const info = asRecord(body.result_info)
    totalPages = Math.min(50, Math.max(page, asFiniteNumber(info?.total_pages) ?? page))
    page += 1
  } while (page <= totalPages)
  return result
}

function adaptiveGraphqlQuery(query: string, rangeMs?: number): string {
  if (rangeMs === undefined)
    return query
  const dimension = rangeMs > 48 * 60 * 60 * 1000 ? 'date' : 'datetimeHour'
  return query.replaceAll('datetimeFifteenMinutes datetime', dimension)
}

async function graphqlRequest(env: CloudflareEnvironment, token: string, query: string, variables: Record<string, unknown>, source: string, rangeMs?: number): Promise<GraphqlResponse> {
  const response = await fetch(getEnvString(env, 'CF_OBSERVABILITY_GRAPHQL_URL') || CLOUDFLARE_GRAPHQL_URL, {
    method: 'POST',
    headers: {
      'authorization': `Bearer ${token}`,
      'content-type': 'application/json',
      'accept': 'application/json',
    },
    body: JSON.stringify({ query: adaptiveGraphqlQuery(query, rangeMs), variables }),
  })
  let body: GraphqlResponse
  try {
    body = await response.json() as GraphqlResponse
  }
  catch {
    throw new CloudflareProviderError('Cloudflare GraphQL returned invalid JSON', { status: response.status, source })
  }
  if (!response.ok)
    throw new CloudflareProviderError(`Cloudflare GraphQL request failed (HTTP ${response.status}).`, { status: response.status, source })
  const graphQlError = graphQlRequestError(body, source)
  if (graphQlError)
    throw graphQlError
  return body
}

function resourceDashboardUrl(kind: string, id: string, name: string): string | undefined {
  const account = CLOUDFLARE_ACCOUNT_ID
  const encodedId = encodeURIComponent(id)
  const encodedName = encodeURIComponent(name)
  switch (kind) {
    case 'worker':
    case 'worker_service':
      return `https://dash.cloudflare.com/${account}/workers/services/view/${encodedName}/production`
    case 'pages':
      return `https://dash.cloudflare.com/${account}/pages/view/${encodedName}`
    case 'd1':
      return `https://dash.cloudflare.com/${account}/workers/d1/databases/${encodedId}`
    case 'r2':
      return `https://dash.cloudflare.com/${account}/r2/default/buckets/${encodedName}`
    case 'kv':
      return `https://dash.cloudflare.com/${account}/workers/kv/namespaces/${encodedId}`
    case 'durable_object':
      return `https://dash.cloudflare.com/${account}/workers/durable-objects`
    case 'zone':
      return `https://dash.cloudflare.com/${account}/${encodedName}`
    default:
      return undefined
  }
}

async function inventoryEndpoint(env: CloudflareEnvironment, token: string, path: string, source: string, kind: string, paginate = true, resultKey?: string): Promise<{ resources: CloudflareResource[], deployments: CloudflareReport['deployments'] }> {
  const rows = paginate
    ? await paginateCloudflareRest<JsonRecord>(env, token, path, source, 1000, resultKey)
    : resultRows((await cloudflareRest(env, token, path, source)).result, resultKey)
  const resources: CloudflareResource[] = []
  const deployments: CloudflareReport['deployments'] = []
  for (const row of rows) {
    const id = String(row.id ?? row.name ?? row.key ?? '')
    const name = String(row.name ?? row.title ?? row.id ?? '')
    if (!id && !name)
      continue
    const project = projectForResource(kind, id, name, env)
    resources.push({ id, name, kind, project, url: resourceDashboardUrl(kind, id, name) })
    const createdAt = typeof row.created_on === 'string'
      ? row.created_on
      : typeof row.created_at === 'string' ? row.created_at : undefined
    if (createdAt)
      deployments.push({ id, resourceName: name, createdAt, source })
  }
  return { resources, deployments }
}

async function workerBindingEndpoint(env: CloudflareEnvironment, token: string, scriptName: string): Promise<VerifiedBindings> {
  const body = await cloudflareRest(
    env,
    token,
    `/accounts/${CLOUDFLARE_ACCOUNT_ID}/workers/scripts/${encodeURIComponent(scriptName)}/settings`,
    `inventory.worker_bindings.${scriptName}`,
  )
  const bindings = bindingIdentifiersFromSettings(body)
  bindings.workerNames.add(scriptName.toLowerCase())
  return bindings
}

function dedupeInventoryResources(resources: CloudflareResource[]): CloudflareResource[] {
  const byKey = new Map<string, CloudflareResource>()
  for (const resource of resources) {
    const normalizedName = resource.name.trim().toLowerCase()
    const normalizedId = resource.id.trim().toLowerCase()
    const key = resource.kind === 'worker' || resource.kind === 'worker_service'
      ? `worker:${normalizedName || normalizedId}`
      : `${resource.kind}:${normalizedId || normalizedName}`
    const previous = byKey.get(key)
    if (!previous || (previous.kind === 'worker_service' && resource.kind === 'worker'))
      byKey.set(key, resource)
  }
  return [...byKey.values()]
}

async function readInventory(env: CloudflareEnvironment, token: string, now: number): Promise<InventoryResult> {
  const cached = inventoryCache.get(CLOUDFLARE_ACCOUNT_ID)
  if (cached && cached.expiresAt > now)
    return cached.result

  const checkedAt = iso(now)
  const endpoints = [
    ['inventory.workers', `/accounts/${CLOUDFLARE_ACCOUNT_ID}/workers/scripts`, 'worker', undefined],
    ['inventory.pages', `/accounts/${CLOUDFLARE_ACCOUNT_ID}/pages/projects`, 'pages', undefined],
    ['inventory.d1', `/accounts/${CLOUDFLARE_ACCOUNT_ID}/d1/database`, 'd1', undefined],
    ['inventory.r2', `/accounts/${CLOUDFLARE_ACCOUNT_ID}/r2/buckets`, 'r2', 'buckets'],
    ['inventory.kv', `/accounts/${CLOUDFLARE_ACCOUNT_ID}/storage/kv/namespaces`, 'kv', undefined],
    ['inventory.durable_objects', `/accounts/${CLOUDFLARE_ACCOUNT_ID}/workers/durable_objects/namespaces`, 'durable_object', undefined],
    ['inventory.services', `/accounts/${CLOUDFLARE_ACCOUNT_ID}/workers/services`, 'worker_service', undefined],
    ['inventory.zones', `/zones?account.id=${CLOUDFLARE_ACCOUNT_ID}`, 'zone', undefined],
  ] as const
  const settled = await Promise.allSettled(endpoints.map(([source, path, kind, resultKey]) => inventoryEndpoint(env, token, path, source, kind, source !== 'inventory.pages', resultKey)))
  const bindingWorkers = [...WORKER_NAMES]
  const bindingSettled = await Promise.allSettled(bindingWorkers.map(scriptName => workerBindingEndpoint(env, token, scriptName)))
  const resources: CloudflareResource[] = []
  const deployments: CloudflareReport['deployments'] = []
  const sourceCoverage = settled.map((result, index) => {
    const [source] = endpoints[index]!
    if (result.status === 'fulfilled') {
      resources.push(...result.value.resources)
      deployments.push(...result.value.deployments)
      return coverage(source, 'live', checkedAt)
    }
    return coverage(source, providerStatus(result.reason), checkedAt, providerReason(result.reason))
  })
  const serviceResources = resources.filter(resource => resource.kind === 'worker_service')
  const verifiedBindings = emptyVerifiedBindings()
  let bindingSuccesses = 0
  let bindingFailure: unknown
  for (const [index, result] of bindingSettled.entries()) {
    if (result.status === 'fulfilled') {
      bindingSuccesses += 1
      mergeVerifiedBindings(verifiedBindings, result.value)
    }
    else if (!bindingFailure) {
      bindingFailure = result.reason
    }
    if (index === bindingSettled.length - 1) {
      sourceCoverage.push(bindingSuccesses === bindingSettled.length
        ? coverage('inventory.worker_bindings', 'live', checkedAt)
        : coverage('inventory.worker_bindings', bindingSuccesses ? 'partial' : providerStatus(bindingFailure), checkedAt, bindingSuccesses ? 'Some Worker binding settings were unavailable.' : providerReason(bindingFailure)))
    }
  }
  const scopedEnv = withVerifiedBindings(env, verifiedBindings)
  for (const resource of resources)
    resource.project = projectForResource(resource.kind, resource.id, resource.name, scopedEnv)
  for (const resource of serviceResources)
    resource.project = projectForResource(resource.kind, resource.id, resource.name, scopedEnv)
  const result = { resources: dedupeInventoryResources(resources), deployments, serviceResources, coverage: sourceCoverage, verifiedBindings }
  inventoryCache.set(CLOUDFLARE_ACCOUNT_ID, { expiresAt: now + INVENTORY_CACHE_MS, result })
  return result
}

async function readWorkers(env: CloudflareEnvironment, token: string, query: CloudflareQuery, checkedAt: string): Promise<SourceData> {
  const body = await graphqlRequest(env, token, workersGraphqlQuery(query.to.getTime() - query.from.getTime()), {
    accountTag: CLOUDFLARE_ACCOUNT_ID,
    from: query.from.toISOString(),
    to: query.to.toISOString(),
  }, 'workers')
  const legacyRows = accountResult(body, 'workersInvocationsAdaptive') as MetricRow[]
  const aggregateRows = accountResult(body, 'workersAggregate') as MetricRow[]
  const byScriptRows = accountResult(body, 'workersByScript') as MetricRow[]
  const seriesRows = accountResult(body, 'workersSeries') as MetricRow[]
  const effectiveAggregateRows = aggregateRows.length ? aggregateRows : legacyRows
  const effectiveByScriptRows = byScriptRows.length ? byScriptRows : legacyRows
  const effectiveSeriesRows = seriesRows.length ? seriesRows : legacyRows
  const metricRows = query.scope === 'account'
    ? effectiveAggregateRows
    : filterRows(effectiveByScriptRows, query.scope, env, ['scriptName'], 'worker')
  const selectedSeriesRows = filterRows(effectiveSeriesRows, query.scope, env, ['scriptName'], 'worker')
  const metrics: ObservabilityMetric[] = []
  const series: CloudflareReport['series'] = []
  const sums: Array<[string, string, string]> = [
    ['requests', 'Worker requests', 'count'],
    ['errors', 'Worker errors', 'count'],
    ['subrequests', 'Worker subrequests', 'count'],
    ['cpuTimeUs', 'Worker CPU time', 'us'],
    ['duration', 'Worker duration', 'GB*s'],
    ['wallTime', 'Worker wall time', 'us'],
  ]
  for (const [field, label, unit] of sums) {
    pushMetric(metrics, `workers.${field}`, label, sumRows(metricRows, 'sum', field), unit, { detail: 'Aggregate across the selected window; series are separately capped and bucketed.' })
    addSeries(series, selectedSeriesRows, 'sum', field, 'workers', unit, ['scriptName'])
  }
  const percentiles: Array<[string, string, string]> = [
    ['cpuTimeP50', 'Worker CPU p50', 'us'],
    ['cpuTimeP90', 'Worker CPU p90', 'us'],
    ['cpuTimeP99', 'Worker CPU p99', 'us'],
    ['cpuTimeP999', 'Worker CPU p999', 'us'],
    ['memoryUsageBytesP50', 'Worker memory p50', 'bytes'],
    ['memoryUsageBytesP90', 'Worker memory p90', 'bytes'],
    ['memoryUsageBytesP99', 'Worker memory p99', 'bytes'],
    ['memoryUsageBytesP999', 'Worker memory p999', 'bytes'],
    ['wallTimeP50', 'Worker wall time p50', 'us'],
    ['wallTimeP99', 'Worker wall time p99', 'us'],
    ['wallTimeP999', 'Worker wall time p999', 'us'],
    ['durationP50', 'Worker duration p50', 'GB*s'],
    ['durationP99', 'Worker duration p99', 'GB*s'],
  ]
  for (const [field, label, unit] of percentiles) {
    const value = maxRows(metricRows, 'quantiles', field)
    pushMetric(metrics, `workers.${field}`, label, value, unit, {
      detail: query.scope === 'account'
        ? 'Provider aggregate percentile across the selected window.'
        : 'Worst-resource percentile across the selected Worker bindings; per-resource values are also emitted below.',
    })
    const resourceRows = filterRows(effectiveByScriptRows, query.scope, env, ['scriptName'], 'worker')
    for (const row of resourceRows) {
      const resourceId = rowResourceId(row, ['scriptName'])
      const resourceValue = fieldValue(row, 'quantiles', field)
      if (resourceId && resourceValue !== null)
        metrics.push(metric(`workers.${field}`, label, resourceValue, unit, { resourceId, resourceName: resourceId, detail: 'Per-resource Worker percentile from the provider group.' }))
    }
    addSeries(series, selectedSeriesRows, 'quantiles', field, 'workers', unit, ['scriptName'])
  }
  const capped = effectiveSeriesRows.length >= 1000 || effectiveByScriptRows.length >= 1000
  return {
    coverage: coverage('workers', capped ? 'partial' : 'live', checkedAt, capped ? 'Cloudflare returned the 1000-group limit; aggregate totals are complete, but the bucketed series may be truncated.' : undefined, true),
    metrics,
    series,
  }
}

async function readDurableObjects(env: CloudflareEnvironment, token: string, query: CloudflareQuery, checkedAt: string): Promise<SourceData> {
  const variables = {
    accountTag: CLOUDFLARE_ACCOUNT_ID,
    from: query.from.toISOString(),
    to: query.to.toISOString(),
  }
  const settled = await Promise.allSettled([
    graphqlRequest(env, token, GRAPHQL_QUERIES.durableObjectsInvocations, variables, 'durable_objects.invocations', query.to.getTime() - query.from.getTime()),
    graphqlRequest(env, token, GRAPHQL_QUERIES.durableObjectsPeriodic, variables, 'durable_objects.periodic', query.to.getTime() - query.from.getTime()),
    graphqlRequest(env, token, GRAPHQL_QUERIES.durableObjectsStorage, variables, 'durable_objects.storage', query.to.getTime() - query.from.getTime()),
  ])
  const successful = settled.filter((result): result is PromiseFulfilledResult<GraphqlResponse> => result.status === 'fulfilled')
  if (!successful.length)
    throw normalizeProviderError(rejectedReason(settled[0]), 'durable_objects')

  const metrics: ObservabilityMetric[] = []
  const series: CloudflareReport['series'] = []
  const sourceRows: MetricRow[][] = []
  let invocationsRows: MetricRow[] = []
  let periodicRows: MetricRow[] = []
  let storageRows: MetricRow[] = []
  if (settled[0].status === 'fulfilled') {
    invocationsRows = filterRows(accountResult(settled[0].value, 'durableObjectsInvocationsAdaptiveGroups'), query.scope, env, ['namespaceId', 'name', 'scriptName'], 'durable_object')
    sourceRows.push(invocationsRows)
    const sums: Array<[string, string, string]> = [
      ['requests', 'Durable Object requests', 'count'],
      ['errors', 'Durable Object errors', 'count'],
      ['responseBodySize', 'Durable Object response bytes', 'bytes'],
      ['wallTime', 'Durable Object wall time', 'us'],
    ]
    for (const [field, label, unit] of sums) {
      pushMetric(metrics, `durable_objects.${field}`, label, sumRows(invocationsRows, 'sum', field), unit)
      addSeries(series, invocationsRows, 'sum', field, 'durable_objects', unit, ['namespaceId', 'name', 'scriptName'])
    }
    for (const [field, label, unit] of [
      ['cpuTimeP50', 'Durable Object CPU p50', 'us'],
      ['cpuTimeP99', 'Durable Object CPU p99', 'us'],
      ['wallTimeP50', 'Durable Object wall time p50', 'us'],
      ['wallTimeP99', 'Durable Object wall time p99', 'us'],
      ['responseBodySizeP50', 'Durable Object response bytes p50', 'bytes'],
      ['responseBodySizeP99', 'Durable Object response bytes p99', 'bytes'],
    ] as Array<[string, string, string]>) {
      pushMetric(metrics, `durable_objects.${field}`, label, maxRows(invocationsRows, 'quantiles', field), unit)
      addSeries(series, invocationsRows, 'quantiles', field, 'durable_objects', unit, ['namespaceId', 'name', 'scriptName'])
    }
  }
  if (settled[1].status === 'fulfilled') {
    periodicRows = filterRows(accountResult(settled[1].value, 'durableObjectsPeriodicGroups'), query.scope, env, ['namespaceId', 'name'], 'durable_object')
    sourceRows.push(periodicRows)
    const sums: Array<[string, string, string]> = [
      ['activeTime', 'Durable Object active time', 'us'],
      ['cpuTime', 'Durable Object periodic CPU', 'us'],
      ['duration', 'Durable Object duration', 'GB*s'],
      ['inboundWebsocketMsgCount', 'Durable Object inbound WebSocket messages', 'messages'],
      ['outboundWebsocketMsgCount', 'Durable Object outbound WebSocket messages', 'messages'],
      ['rowsRead', 'Durable Object rows read', 'rows'],
      ['rowsWritten', 'Durable Object rows written', 'rows'],
      ['storageDeletes', 'Durable Object storage deletes', 'operations'],
      ['storageReadUnits', 'Durable Object storage read units', '4KB units'],
      ['storageWriteUnits', 'Durable Object storage write units', '4KB units'],
      ['subrequests', 'Durable Object subrequests', 'count'],
    ]
    for (const [field, label, unit] of sums) {
      pushMetric(metrics, `durable_objects.${field}`, label, sumRows(periodicRows, 'sum', field), unit, {
        detail: field === 'inboundWebsocketMsgCount' ? 'Raw incoming WebSocket messages; billing derives billable requests as raw/20.' : undefined,
      })
      addSeries(series, periodicRows, 'sum', field, 'durable_objects', unit, ['namespaceId', 'name'])
    }
    for (const field of ['memoryUsageBytesP50', 'memoryUsageBytesP90', 'memoryUsageBytesP99', 'memoryUsageBytesP999']) {
      pushMetric(metrics, `durable_objects.${field}`, `Durable Object memory ${field.slice(-3)}`, maxRows(periodicRows, 'quantiles', field), 'bytes')
      addSeries(series, periodicRows, 'quantiles', field, 'durable_objects', 'bytes', ['namespaceId', 'name'])
    }
  }
  if (settled[2].status === 'fulfilled') {
    storageRows = filterRows(accountResult(settled[2].value, 'durableObjectsStorageGroups'), query.scope, env, ['namespaceIds'], 'durable_object')
    sourceRows.push(storageRows)
    pushMetric(metrics, 'durable_objects.stored_bytes', 'Durable Object stored bytes', sumLatestRows(storageRows, 'max', 'storedBytes', ['namespaceIds']), 'bytes')
    addSeries(series, storageRows, 'max', 'storedBytes', 'durable_objects', 'bytes', ['namespaceIds'])
  }
  const capReason = groupLimitReason('durable_objects', [
    { label: 'invocations', rows: invocationsRows },
    { label: 'periodic', rows: periodicRows },
    { label: 'storage', rows: storageRows },
  ])
  const coverageStatus = successful.length === settled.length && !capReason ? 'live' : 'partial'
  const reason = successful.length === settled.length
    ? capReason
    : [
        'Some Durable Object datasets were unavailable.',
        settled.map((result, index) => result.status === 'rejected' ? `${['invocations', 'periodic', 'storage'][index]}: ${providerReason(result.reason)}` : undefined).filter(Boolean).join(' '),
        capReason,
      ].filter(Boolean).join(' ')
  return {
    coverage: coverage('durable_objects', coverageStatus, checkedAt, reason, true),
    metrics,
    series,
  }
}

async function readD1(env: CloudflareEnvironment, token: string, query: CloudflareQuery, checkedAt: string): Promise<SourceData> {
  const variables = {
    accountTag: CLOUDFLARE_ACCOUNT_ID,
    from: query.from.toISOString(),
    to: query.to.toISOString(),
  }
  const settled = await Promise.allSettled([
    graphqlRequest(env, token, GRAPHQL_QUERIES.d1Analytics, variables, 'd1.analytics', query.to.getTime() - query.from.getTime()),
    graphqlRequest(env, token, GRAPHQL_QUERIES.d1Storage, variables, 'd1.storage', query.to.getTime() - query.from.getTime()),
  ])
  const successful = settled.filter((result): result is PromiseFulfilledResult<GraphqlResponse> => result.status === 'fulfilled')
  if (!successful.length)
    throw normalizeProviderError(rejectedReason(settled[0]), 'd1')
  const metrics: ObservabilityMetric[] = []
  const series: CloudflareReport['series'] = []
  let analyticsRows: MetricRow[] = []
  let storageRows: MetricRow[] = []
  if (settled[0].status === 'fulfilled') {
    analyticsRows = filterRows(accountResult(settled[0].value, 'd1AnalyticsAdaptiveGroups'), query.scope, env, ['databaseId'], 'd1')
    for (const [field, label, unit] of [
      ['queryBatchResponseBytes', 'D1 query response bytes', 'bytes'],
      ['readQueries', 'D1 read queries', 'queries'],
      ['rowsRead', 'D1 rows read', 'rows'],
      ['rowsWritten', 'D1 rows written', 'rows'],
      ['writeQueries', 'D1 write queries', 'queries'],
    ] as Array<[string, string, string]>) {
      pushMetric(metrics, `d1.${field}`, label, sumRows(analyticsRows, 'sum', field), unit)
      addSeries(series, analyticsRows, 'sum', field, 'd1', unit, ['databaseId'])
    }
  }
  if (settled[1].status === 'fulfilled') {
    storageRows = filterRows(accountResult(settled[1].value, 'd1StorageAdaptiveGroups'), query.scope, env, ['databaseId'], 'd1')
    pushMetric(metrics, 'd1.storage_bytes', 'D1 storage', sumLatestRows(storageRows, 'max', 'databaseSizeBytes', ['databaseId']), 'bytes')
    addSeries(series, storageRows, 'max', 'databaseSizeBytes', 'd1', 'bytes', ['databaseId'])
  }
  const capReason = groupLimitReason('d1', [{ label: 'analytics', rows: analyticsRows }, { label: 'storage', rows: storageRows }])
  const complete = successful.length === settled.length && !capReason
  return {
    coverage: coverage('d1', complete ? 'live' : 'partial', checkedAt, successful.length === settled.length ? capReason : ['Some D1 datasets were unavailable.', capReason].filter(Boolean).join(' '), true),
    metrics,
    series,
  }
}

async function readKv(env: CloudflareEnvironment, token: string, query: CloudflareQuery, checkedAt: string): Promise<SourceData> {
  const variables = { accountTag: CLOUDFLARE_ACCOUNT_ID, from: query.from.toISOString(), to: query.to.toISOString() }
  const settled = await Promise.allSettled([
    graphqlRequest(env, token, GRAPHQL_QUERIES.kvOperations, variables, 'kv.operations', query.to.getTime() - query.from.getTime()),
    graphqlRequest(env, token, GRAPHQL_QUERIES.kvStorage, variables, 'kv.storage', query.to.getTime() - query.from.getTime()),
  ])
  const successful = settled.filter((result): result is PromiseFulfilledResult<GraphqlResponse> => result.status === 'fulfilled')
  if (!successful.length)
    throw normalizeProviderError(rejectedReason(settled[0]), 'kv')
  const metrics: ObservabilityMetric[] = []
  const series: CloudflareReport['series'] = []
  let operationRows: MetricRow[] = []
  let storageRows: MetricRow[] = []
  if (settled[0].status === 'fulfilled') {
    operationRows = filterRows(accountResult(settled[0].value, 'kvOperationsAdaptiveGroups'), query.scope, env, ['namespaceId'], 'kv')
    for (const [field, label, unit] of [['objectBytes', 'KV object bytes', 'bytes'], ['requests', 'KV requests', 'requests']] as Array<[string, string, string]>) {
      pushMetric(metrics, `kv.${field}`, label, sumRows(operationRows, 'sum', field), unit)
      addSeries(series, operationRows, 'sum', field, 'kv', unit, ['namespaceId'])
    }
    const readRows = operationRows.filter(row => ['read', 'get', 'list'].includes((rowDimension(row, 'actionType') ?? '').toLowerCase()))
    const writeRows = operationRows.filter(row => ['write', 'put', 'delete'].includes((rowDimension(row, 'actionType') ?? '').toLowerCase()))
    pushMetric(metrics, 'kv.read_requests', 'KV read requests', sumRows(readRows, 'sum', 'requests'), 'requests')
    pushMetric(metrics, 'kv.write_requests', 'KV write requests', sumRows(writeRows, 'sum', 'requests'), 'requests')
  }
  if (settled[1].status === 'fulfilled') {
    storageRows = filterRows(accountResult(settled[1].value, 'kvStorageAdaptiveGroups'), query.scope, env, ['namespaceId'], 'kv')
    pushMetric(metrics, 'kv.storage_bytes', 'KV storage', sumLatestRows(storageRows, 'max', 'byteCount', ['namespaceId']), 'bytes')
    pushMetric(metrics, 'kv.keys', 'KV keys', sumLatestRows(storageRows, 'max', 'keyCount', ['namespaceId']), 'keys')
    addSeries(series, storageRows, 'max', 'byteCount', 'kv', 'bytes', ['namespaceId'])
  }
  const capReason = groupLimitReason('kv', [{ label: 'operations', rows: operationRows }, { label: 'storage', rows: storageRows }])
  const complete = successful.length === settled.length && !capReason
  return {
    coverage: coverage('kv', complete ? 'live' : 'partial', checkedAt, successful.length === settled.length ? capReason : ['Some KV datasets were unavailable.', capReason].filter(Boolean).join(' '), true),
    metrics,
    series,
  }
}

async function readR2(env: CloudflareEnvironment, token: string, query: CloudflareQuery, checkedAt: string): Promise<SourceData> {
  const variables = { accountTag: CLOUDFLARE_ACCOUNT_ID, from: query.from.toISOString(), to: query.to.toISOString() }
  const settled = await Promise.allSettled([
    graphqlRequest(env, token, GRAPHQL_QUERIES.r2Operations, variables, 'r2.operations', query.to.getTime() - query.from.getTime()),
    graphqlRequest(env, token, GRAPHQL_QUERIES.r2Storage, variables, 'r2.storage', query.to.getTime() - query.from.getTime()),
  ])
  const successful = settled.filter((result): result is PromiseFulfilledResult<GraphqlResponse> => result.status === 'fulfilled')
  if (!successful.length)
    throw normalizeProviderError(rejectedReason(settled[0]), 'r2')
  const metrics: ObservabilityMetric[] = []
  const series: CloudflareReport['series'] = []
  let operationRows: MetricRow[] = []
  let storageRows: MetricRow[] = []
  if (settled[0].status === 'fulfilled') {
    operationRows = filterRows(accountResult(settled[0].value, 'r2OperationsAdaptiveGroups'), query.scope, env, ['bucketName'], 'r2')
    for (const [field, label, unit] of [['requests', 'R2 requests', 'requests'], ['responseBytes', 'R2 response bytes', 'bytes'], ['responseObjectSize', 'R2 response object bytes', 'bytes']] as Array<[string, string, string]>) {
      pushMetric(metrics, `r2.${field}`, label, sumRows(operationRows, 'sum', field), unit)
      addSeries(series, operationRows, 'sum', field, 'r2', unit, ['bucketName'])
    }
    const classARows = operationRows.filter(row => /put|post|copy|list|multipart|delete/i.test(rowDimension(row, 'actionType') ?? ''))
    const classBRows = operationRows.filter(row => /get|head/i.test(rowDimension(row, 'actionType') ?? ''))
    pushMetric(metrics, 'r2.class_a_operations', 'R2 Class A operations', sumRows(classARows, 'sum', 'requests'), 'operations')
    pushMetric(metrics, 'r2.class_b_operations', 'R2 Class B operations', sumRows(classBRows, 'sum', 'requests'), 'operations')
  }
  if (settled[1].status === 'fulfilled') {
    storageRows = filterRows(accountResult(settled[1].value, 'r2StorageAdaptiveGroups'), query.scope, env, ['bucketName'], 'r2')
    for (const [field, label, unit] of [['payloadSize', 'R2 payload storage', 'bytes'], ['metadataSize', 'R2 metadata storage', 'bytes'], ['objectCount', 'R2 objects', 'objects'], ['uploadCount', 'R2 uploads', 'uploads']] as Array<[string, string, string]>) {
      pushMetric(metrics, `r2.${field}`, label, sumLatestRows(storageRows, 'max', field, ['bucketName']), unit)
      addSeries(series, storageRows, 'max', field, 'r2', unit, ['bucketName'])
    }
  }
  const capReason = groupLimitReason('r2', [{ label: 'operations', rows: operationRows }, { label: 'storage', rows: storageRows }])
  const complete = successful.length === settled.length && !capReason
  return {
    coverage: coverage('r2', complete ? 'live' : 'partial', checkedAt, successful.length === settled.length ? capReason : ['Some R2 datasets were unavailable.', capReason].filter(Boolean).join(' '), true),
    metrics,
    series,
  }
}

async function readZones(env: CloudflareEnvironment, token: string, query: CloudflareQuery, checkedAt: string): Promise<SourceData> {
  const body = await graphqlRequest(env, token, GRAPHQL_QUERIES.zones, {
    accountTag: CLOUDFLARE_ACCOUNT_ID,
    from: query.from.toISOString(),
    to: query.to.toISOString(),
  }, 'zones', query.to.getTime() - query.from.getTime())
  const aggregateRows = accountResult(body, 'zonesAggregate') as MetricRow[]
  const byZoneRows = accountResult(body, 'zonesByZone') as MetricRow[]
  const seriesRows = accountResult(body, 'zonesSeries') as MetricRow[]
  const cacheRows = accountResult(body, 'zonesCache') as MetricRow[]
  const statusRows = accountResult(body, 'zonesStatus') as MetricRow[]
  const isSelectedZone = (row: MetricRow): boolean => {
    if (query.scope === 'account')
      return true
    const dimensions = asRecord(row.dimensions)
    const host = typeof dimensions?.clientRequestHTTPHost === 'string' ? dimensions.clientRequestHTTPHost.toLowerCase() : ''
    const zoneTag = typeof dimensions?.zoneTag === 'string' ? dimensions.zoneTag : ''
    return ZONE_NAMES.has(host) || resourceAllowed({ id: zoneTag, name: host, kind: 'zone' }, query.scope, env)
  }
  const metricRows = query.scope === 'account' ? aggregateRows : byZoneRows.filter(isSelectedZone)
  const filteredSeriesRows = seriesRows.filter(isSelectedZone)
  const filteredCacheRows = cacheRows.filter(isSelectedZone)
  const filteredStatusRows = statusRows.filter(isSelectedZone)
  const metrics: ObservabilityMetric[] = []
  const series: CloudflareReport['series'] = []
  pushMetric(metrics, 'zones.requests', 'Zone requests', metricRows.map(row => rowCount(row)).filter((value): value is number => value !== null).reduce((sum, value) => sum + value, 0), 'requests')
  for (const [field, label, unit] of [
    ['edgeRequestBytes', 'Zone request bytes', 'bytes'],
    ['edgeResponseBytes', 'Zone response bytes', 'bytes'],
    ['originResponseDurationMs', 'Zone origin response duration', 'ms'],
  ] as Array<[string, string, string]>) {
    pushMetric(metrics, `zones.${field}`, label, sumRows(metricRows, 'sum', field), unit)
    addSeries(series, filteredSeriesRows, 'sum', field, 'zones', unit, ['zoneTag', 'clientRequestHTTPHost'])
  }
  for (const [field, label] of [['status4xx', 'Zone 4xx ratio'], ['status5xx', 'Zone 5xx ratio']] as Array<[string, string]>) {
    const value = maxRows(metricRows, 'avg', field) ?? maxRows(metricRows, 'ratio', field)
    pushMetric(metrics, `zones.${field}`, label, value, 'ratio')
  }
  const errors = filteredStatusRows.reduce((totals, row) => {
    const status = asFiniteNumber(asRecord(row.dimensions)?.edgeResponseStatus)
    const count = rowCount(row)
    if (status !== null && count !== null) {
      if (status >= 400 && status < 500)
        totals.client += count
      if (status >= 500 && status < 600)
        totals.server += count
    }
    return totals
  }, { client: 0, server: 0 } as { client: number, server: number })
  pushMetric(metrics, 'zones.errors_4xx', 'Zone 4xx requests', errors.client, 'requests')
  pushMetric(metrics, 'zones.errors_5xx', 'Zone 5xx requests', errors.server, 'requests')
  const cacheHits = filteredCacheRows.filter((row) => {
    const value = asRecord(row.dimensions)?.cacheStatus
    return typeof value === 'string' && ['hit', 'stale'].includes(value.toLowerCase())
  }).map(row => rowCount(row)).filter((value): value is number => value !== null).reduce((sum, value) => sum + value, 0)
  const cacheMisses = filteredCacheRows.filter((row) => {
    const value = asRecord(row.dimensions)?.cacheStatus
    return typeof value === 'string' && ['miss', 'dynamic', 'bypass', 'expired'].includes(value.toLowerCase())
  }).map(row => rowCount(row)).filter((value): value is number => value !== null).reduce((sum, value) => sum + value, 0)
  pushMetric(metrics, 'zones.cache_hits', 'Zone cache hits', cacheHits, 'requests')
  pushMetric(metrics, 'zones.cache_misses', 'Zone cache misses', cacheMisses, 'requests')
  for (const row of filteredSeriesRows) {
    const count = rowCount(row)
    const timestamp = timestampFromRow(row)
    if (count !== null && timestamp)
      series.push({ timestamp, metric: 'zones.requests', value: count, ...(rowResourceId(row, ['zoneTag', 'clientRequestHTTPHost']) ? { resourceId: rowResourceId(row, ['zoneTag', 'clientRequestHTTPHost']) } : {}) })
  }
  const capReason = groupLimitReason('zones', [
    { label: 'by-zone', rows: byZoneRows },
    { label: 'series', rows: seriesRows },
    { label: 'cache', rows: cacheRows },
    { label: 'status', rows: statusRows },
  ])
  return { coverage: coverage('zones', capReason ? 'partial' : 'live', checkedAt, capReason, true), metrics, series }
}

async function readAnalyticsEngine(env: CloudflareEnvironment, token: string, query: CloudflareQuery, checkedAt: string): Promise<SourceData> {
  const body = await graphqlRequest(env, token, GRAPHQL_QUERIES.analyticsEngine, {
    accountTag: CLOUDFLARE_ACCOUNT_ID,
    from: query.from.toISOString(),
    to: query.to.toISOString(),
  }, 'analytics_engine', query.to.getTime() - query.from.getTime())
  const rows = accountResult(body, 'workersAnalyticsEngineAdaptiveGroups') as MetricRow[]
  const metrics: ObservabilityMetric[] = []
  const series: CloudflareReport['series'] = []
  const count = rows.map(row => rowCount(row)).filter((value): value is number => value !== null).reduce((sum, value) => sum + value, 0)
  pushMetric(metrics, 'analytics_engine.rows', 'Analytics Engine rows', count, 'rows')
  for (const row of rows) {
    const value = rowCount(row)
    const timestamp = timestampFromRow(row)
    if (value !== null && timestamp)
      series.push({ timestamp, metric: 'analytics_engine.rows', value, ...(rowResourceId(row, ['dataset']) ? { resourceId: rowResourceId(row, ['dataset']) } : {}) })
  }
  const capReason = groupLimitReason('analytics_engine', [{ label: 'rows', rows }])
  return { coverage: coverage('analytics_engine', capReason ? 'partial' : 'live', checkedAt, capReason, true), metrics, series }
}

async function readAi(env: CloudflareEnvironment, token: string, query: CloudflareQuery, checkedAt: string): Promise<SourceData> {
  const body = await graphqlRequest(env, token, GRAPHQL_QUERIES.ai, {
    accountTag: CLOUDFLARE_ACCOUNT_ID,
    from: query.from.toISOString(),
    to: query.to.toISOString(),
  }, 'ai', query.to.getTime() - query.from.getTime())
  const rows = accountResult(body, 'aiInferenceAdaptiveGroups') as MetricRow[]
  const metrics: ObservabilityMetric[] = []
  const series: CloudflareReport['series'] = []
  const count = rows.map(row => rowCount(row)).filter((value): value is number => value !== null).reduce((sum, value) => sum + value, 0)
  pushMetric(metrics, 'ai.inferences', 'AI inferences', count, 'requests')
  for (const row of rows) {
    const value = rowCount(row)
    const timestamp = timestampFromRow(row)
    if (value !== null && timestamp)
      series.push({ timestamp, metric: 'ai.inferences', value, ...(rowResourceId(row, ['modelId', 'requestSource']) ? { resourceId: rowResourceId(row, ['modelId', 'requestSource']) } : {}) })
  }
  const capReason = groupLimitReason('ai', [{ label: 'rows', rows }])
  return { coverage: coverage('ai', capReason ? 'partial' : 'live', checkedAt, capReason, true), metrics, series }
}

async function readQueues(env: CloudflareEnvironment, token: string, query: CloudflareQuery, checkedAt: string): Promise<SourceData> {
  const body = await graphqlRequest(env, token, GRAPHQL_QUERIES.queues, {
    accountTag: CLOUDFLARE_ACCOUNT_ID,
    from: query.from.toISOString(),
    to: query.to.toISOString(),
  }, 'queues', query.to.getTime() - query.from.getTime())
  const operations = accountResult(body, 'queueMessageOperationsAdaptiveGroups') as MetricRow[]
  const backlog = accountResult(body, 'queueBacklogAdaptiveGroups') as MetricRow[]
  const consumers = accountResult(body, 'queueConsumerMetricsAdaptiveGroups') as MetricRow[]
  const metrics: ObservabilityMetric[] = []
  const series: CloudflareReport['series'] = []
  const operationCount = operations.map(row => rowCount(row)).filter((value): value is number => value !== null).reduce((sum, value) => sum + value, 0)
  pushMetric(metrics, 'queues.operations', 'Queue operations', operationCount, 'operations')
  pushMetric(metrics, 'queues.bytes', 'Queue operation bytes', sumRows(operations, 'sum', 'bytes'), 'bytes')
  pushMetric(metrics, 'queues.backlog_messages', 'Queue backlog messages', sumRows(backlog, 'avg', 'messages'), 'messages')
  pushMetric(metrics, 'queues.backlog_bytes', 'Queue backlog bytes', sumRows(backlog, 'avg', 'bytes'), 'bytes')
  pushMetric(metrics, 'queues.consumer_concurrency', 'Queue consumer concurrency', maxRows(consumers, 'avg', 'concurrency'), 'consumers')
  for (const row of operations) {
    const value = rowCount(row)
    const timestamp = timestampFromRow(row)
    if (value !== null && timestamp)
      series.push({ timestamp, metric: 'queues.operations', value, ...(rowResourceId(row, ['queueId']) ? { resourceId: rowResourceId(row, ['queueId']) } : {}) })
  }
  addSeries(series, operations, 'sum', 'bytes', 'queues', 'bytes', ['queueId'])
  const capReason = groupLimitReason('queues', [
    { label: 'operations', rows: operations },
    { label: 'backlog', rows: backlog },
    { label: 'consumers', rows: consumers },
  ])
  return { coverage: coverage('queues', capReason ? 'partial' : 'live', checkedAt, capReason, true), metrics, series }
}

async function readWorkflows(env: CloudflareEnvironment, token: string, query: CloudflareQuery, checkedAt: string): Promise<SourceData> {
  const body = await graphqlRequest(env, token, GRAPHQL_QUERIES.workflows, {
    accountTag: CLOUDFLARE_ACCOUNT_ID,
    from: query.from.toISOString(),
    to: query.to.toISOString(),
  }, 'workflows', query.to.getTime() - query.from.getTime())
  const rows = accountResult(body, 'workflowsAdaptiveGroups') as MetricRow[]
  const metrics: ObservabilityMetric[] = []
  const series: CloudflareReport['series'] = []
  pushMetric(metrics, 'workflows.runs', 'Workflow runs and events', rows.map(row => rowCount(row)).filter((value): value is number => value !== null).reduce((sum, value) => sum + value, 0), 'runs')
  pushMetric(metrics, 'workflows.wall_time', 'Workflow wall time', sumRows(rows, 'sum', 'wallTime'), 'us')
  addSeries(series, rows, 'sum', 'wallTime', 'workflows', 'us', ['workflowName', 'instanceId'])
  const capReason = groupLimitReason('workflows', [{ label: 'rows', rows }])
  return { coverage: coverage('workflows', capReason ? 'partial' : 'live', checkedAt, capReason, true), metrics, series }
}

async function readBuilds(env: CloudflareEnvironment, token: string, query: CloudflareQuery, checkedAt: string): Promise<SourceData> {
  const body = await graphqlRequest(env, token, GRAPHQL_QUERIES.builds, {
    accountTag: CLOUDFLARE_ACCOUNT_ID,
    from: query.from.toISOString(),
    to: query.to.toISOString(),
  }, 'builds', query.to.getTime() - query.from.getTime())
  const rows = accountResult(body, 'workersBuildsBuildMinutesAdaptiveGroups') as MetricRow[]
  const metrics: ObservabilityMetric[] = []
  const series: CloudflareReport['series'] = []
  pushMetric(metrics, 'builds.minutes', 'Workers build minutes', sumRows(rows, 'sum', 'buildMinutes'), 'minutes')
  addSeries(series, rows, 'sum', 'buildMinutes', 'builds', 'minutes', ['projectName', 'buildId'])
  const capReason = groupLimitReason('builds', [{ label: 'rows', rows }])
  return { coverage: coverage('builds', capReason ? 'partial' : 'live', checkedAt, capReason, true), metrics, series }
}

async function readBillingMetrics(env: CloudflareEnvironment, token: string, cycle: { from: string, to: string }, scope: 'account', now: number): Promise<BillingMetricsResult> {
  const cycleFrom = new Date(cycle.from).getTime()
  const cycleTo = Math.min(new Date(cycle.to).getTime(), now)
  const retentionFrom = now - LIVE_GRAPHQL_RETENTION_MS
  const from = Math.max(cycleFrom, retentionFrom)
  const retentionComplete = Number.isFinite(cycleFrom) && cycleFrom >= retentionFrom
  if (!Number.isFinite(from) || !Number.isFinite(cycleTo) || from >= cycleTo)
    return { metrics: [], complete: false, reason: 'Current-cycle analytics were unavailable for the billing window; estimated charges and forecast are withheld.' }
  const cacheKey = `${CLOUDFLARE_ACCOUNT_ID}:${scope}:${cycle.from}:${cycle.to}`
  const cached = billingMetricCache.get(cacheKey)
  if (cached && cached.expiresAt > now)
    return { metrics: cached.metrics, complete: cached.complete, reason: cached.reason }
  const query: CloudflareQuery = {
    from: new Date(from),
    to: new Date(cycleTo),
    scope,
    range: 'billing-cycle',
    historical: false,
  }
  const checkedAt = iso(now)
  const readers = [
    readWorkers(env, token, query, checkedAt),
    readDurableObjects(env, token, query, checkedAt),
    readD1(env, token, query, checkedAt),
    readKv(env, token, query, checkedAt),
    readR2(env, token, query, checkedAt),
    readQueues(env, token, query, checkedAt),
    readWorkflows(env, token, query, checkedAt),
  ]
  const settled = await Promise.allSettled(readers)
  const metrics = settled.flatMap(result => result.status === 'fulfilled' ? result.value.metrics : [])
  const failures = settled
    .map((result, index) => result.status === 'rejected' ? `${['workers', 'durable_objects', 'd1', 'kv', 'r2', 'queues', 'workflows'][index]}: ${providerReason(result.reason)}` : undefined)
    .filter((reason): reason is string => Boolean(reason))
  const partialSources = settled.flatMap((result, index) => {
    if (result.status !== 'fulfilled' || result.value.coverage.status === 'live')
      return []
    const source = ['workers', 'durable_objects', 'd1', 'kv', 'r2', 'queues', 'workflows'][index]
    return [`${source}: ${result.value.coverage.reason ?? `coverage status ${result.value.coverage.status}`}`]
  })
  const reason = [
    retentionComplete ? undefined : 'Current-cycle analytics were bounded to the provider retention window; full-cycle estimates and forecast are withheld.',
    failures.length ? `Billing analytics sources were unavailable: ${failures.join(' ')}` : undefined,
    partialSources.length ? `Billing analytics sources were partial: ${partialSources.join(' ')}` : undefined,
  ].filter(Boolean).join(' ') || undefined
  const complete = retentionComplete && failures.length === 0 && partialSources.length === 0
  if (!billingMetricCache.has(cacheKey) && billingMetricCache.size >= MAX_BILLING_METRIC_CACHE_ENTRIES) {
    const oldest = billingMetricCache.keys().next().value
    if (typeof oldest === 'string')
      billingMetricCache.delete(oldest)
  }
  billingMetricCache.set(cacheKey, { expiresAt: now + OBSERVABILITY_CACHE_MS, metrics, complete, reason })
  return { metrics, complete, reason }
}

function metricValue(metrics: ObservabilityMetric[], key: string): number | null {
  const found = metrics.find(item => item.key === key)
  return found?.value ?? null
}

function subscriptionRows(body: CloudflareApiResponse | undefined): JsonRecord[] {
  return body ? asArray(body.result) : []
}

function providerCycleFromSubscriptions(rows: JsonRecord[]): { from: string, to: string, source: string } | null {
  for (const row of rows) {
    const from = typeof row.current_period_start === 'string' ? row.current_period_start : undefined
    const to = typeof row.current_period_end === 'string' ? row.current_period_end : undefined
    if (from && to)
      return { from, to, source: 'cloudflare:subscriptions' }
  }
  return null
}

function providerFixedFees(rows: JsonRecord[]): number | null {
  const prices = rows
    .filter(row => row.frequency === 'monthly' && row.state !== 'Canceled')
    .map(row => asFiniteNumber(row.price))
    .filter((value): value is number => value !== null)
  return prices.length ? prices.reduce((sum, value) => sum + value, 0) : null
}

function providerCurrency(rows: JsonRecord[]): string | undefined {
  const currency = rows.find(row => typeof row.currency === 'string')?.currency
  return typeof currency === 'string' && currency.trim() ? currency.trim().toUpperCase() : undefined
}

function providerTimestamp(value: unknown): number | null {
  if (typeof value !== 'string' || !value.trim())
    return null
  const raw = value.trim()
  const usDate = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}):(\d{2}))?/.exec(raw)
  if (usDate) {
    const month = Number(usDate[1])
    const day = Number(usDate[2])
    const year = Number(usDate[3])
    const hour = Number(usDate[4] ?? 0)
    const minute = Number(usDate[5] ?? 0)
    const second = Number(usDate[6] ?? 0)
    const parsed = Date.UTC(year, month - 1, day, hour, minute, second)
    return Number.isFinite(parsed) ? parsed : null
  }
  const parsed = new Date(raw).getTime()
  return Number.isFinite(parsed) ? parsed : null
}

function providerDay(value: unknown): string | null {
  const timestamp = providerTimestamp(value)
  return timestamp === null ? null : new Date(timestamp).toISOString().slice(0, 10)
}

function providerUsageRows(body: CloudflareApiResponse | undefined): JsonRecord[] {
  return body ? resultRows(body.result, 'rows') : []
}

function billingHistoryRows(body: CloudflareApiResponse | undefined): JsonRecord[] {
  return body ? resultRows(body.result) : []
}

function aggregateProviderRatedUsage(rows: JsonRecord[], cycle: { from: string, to: string }): ProviderRatedUsage {
  if (!rows.length)
    return { amount: null, reason: 'Cloudflare billable usage returned no rows for the provider billing cycle; current-cycle actual charges are unavailable.' }
  const cycleFrom = new Date(cycle.from).getTime()
  const cycleTo = new Date(cycle.to).getTime()
  const cycleFromDay = providerDay(cycle.from)
  if (!Number.isFinite(cycleFrom) || !Number.isFinite(cycleTo) || !cycleFromDay)
    return { amount: null, reason: 'Cloudflare provider billing-cycle metadata was invalid; current-cycle actual charges are unavailable.' }
  let amount = 0
  let currency: string | undefined
  for (const row of rows) {
    const billingPeriodStart = providerDay(row.BillingPeriodStart)
    if (!billingPeriodStart || billingPeriodStart !== cycleFromDay)
      return { amount: null, reason: `Cloudflare billable usage included a row outside the provider billing period starting ${cycleFromDay}; current-cycle actual charges are unavailable.` }
    const chargeFrom = providerTimestamp(row.ChargePeriodStart)
    const chargeTo = providerTimestamp(row.ChargePeriodEnd)
    if (chargeFrom === null || chargeTo === null || chargeFrom < cycleFrom || chargeTo > cycleTo || chargeFrom >= chargeTo)
      return { amount: null, reason: `Cloudflare billable usage included a charge period outside the provider billing cycle ${cycle.from} to ${cycle.to}; current-cycle actual charges are unavailable.` }
    const rowCurrency = typeof row.BillingCurrency === 'string' && row.BillingCurrency.trim()
      ? row.BillingCurrency.trim().toUpperCase()
      : undefined
    if (rowCurrency && currency && rowCurrency !== currency)
      return { amount: null, reason: 'Cloudflare billable usage returned multiple billing currencies; current-cycle actual charges are unavailable.' }
    currency ??= rowCurrency
    const billedCost = asFiniteNumber(row.BilledCost)
    const effectiveCost = asFiniteNumber(row.EffectiveCost)
    if (billedCost === null && effectiveCost !== null)
      return { amount: null, currency, reason: 'Cloudflare billable usage returned only EffectiveCost without finalized BilledCost; current-cycle actual charges are unavailable.' }
    if (billedCost === null)
      return { amount: null, currency, reason: 'Cloudflare billable usage returned a row without BilledCost or EffectiveCost; current-cycle actual charges are unavailable.' }
    amount += billedCost
  }
  return {
    amount,
    currency,
    reason: `Cloudflare billable usage v1 rows match provider billing cycle ${cycle.from} to ${cycle.to}; finalized BilledCost is reported as provider-rated metered usage charges, not a full invoice total. Fixed subscription fees are reported separately.`,
  }
}

async function readActualBilling(env: CloudflareEnvironment, token: string): Promise<ActualBillingResult> {
  const now = Date.now()
  const cached = actualBillingCache.get(CLOUDFLARE_ACCOUNT_ID)
  if (cached && cached.expiresAt > now)
    return cached.result
  const endpoints = [
    [`/accounts/${CLOUDFLARE_ACCOUNT_ID}/billing/history`, 'billing.history'],
    [`/accounts/${CLOUDFLARE_ACCOUNT_ID}/billing/profile`, 'billing.profile'],
    [`/accounts/${CLOUDFLARE_ACCOUNT_ID}/subscriptions`, 'billing.subscriptions'],
  ] as const
  const settled = await Promise.allSettled(endpoints.map(([path, source]) => cloudflareRest(env, token, path, source)))
  const successful = settled.filter((result): result is PromiseFulfilledResult<CloudflareApiResponse> => result.status === 'fulfilled')
  if (!successful.length) {
    const error = normalizeProviderError(rejectedReason(settled[0]), 'billing')
    const result = { charges: null, fixedFees: null, cycle: null, reason: error.status === 403 ? `Cloudflare billing endpoints returned HTTP 403; using the labeled ${PRICING_VERSION} estimate.` : providerReason(error) }
    actualBillingCache.set(CLOUDFLARE_ACCOUNT_ID, { expiresAt: now + INVENTORY_CACHE_MS, result })
    return result
  }
  const historyResult = settled[0]
  const subscriptionResult = settled[2]
  const history = historyResult?.status === 'fulfilled' ? historyResult.value : undefined
  const subscription = subscriptionResult?.status === 'fulfilled' ? subscriptionResult.value : undefined
  const subscriptions = subscriptionRows(subscription)
  const cycle = providerCycleFromSubscriptions(subscriptions)
  const historyCurrency = providerCurrency(billingHistoryRows(history))
  const subscriptionCurrency = providerCurrency(subscriptions)
  let usage: ProviderRatedUsage = {
    amount: null,
    reason: 'Cloudflare provider billing-cycle metadata was unavailable; posted billing history is not treated as current-cycle usage.',
  }
  if (cycle) {
    const from = providerDay(cycle.from)
    const to = providerDay(cycle.to)
    if (from && to) {
      const usagePath = `/accounts/${CLOUDFLARE_ACCOUNT_ID}/billable-usage?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
      try {
        usage = aggregateProviderRatedUsage(providerUsageRows(await cloudflareRest(env, token, usagePath, 'billing.billable_usage')), cycle)
      }
      catch (error) {
        const normalized = normalizeProviderError(error, 'billing.billable_usage')
        usage = {
          amount: null,
          reason: normalized.status === 403
            ? 'Cloudflare billable usage returned HTTP 403; posted billing history is not treated as current-cycle usage, so actual charges are unavailable.'
            : providerReason(normalized),
        }
      }
    }
  }
  const result = {
    charges: usage.amount,
    fixedFees: providerFixedFees(subscriptions),
    cycle,
    currency: usage.currency ?? subscriptionCurrency ?? historyCurrency,
    reason: usage.reason,
  }
  actualBillingCache.set(CLOUDFLARE_ACCOUNT_ID, { expiresAt: now + INVENTORY_CACHE_MS, result })
  return result
}

function billingUsage(
  key: string,
  label: string,
  consumed: number | null,
  included: number | null,
  unit: string,
  ratePerUnit: number | null,
  attribution: BillingUsage['attribution'] = 'account',
): BillingUsage {
  if (consumed === null)
    return { key, label, consumed: null, included, billable: null, unit, estimatedCost: null, actualCost: null, attribution }
  if (ratePerUnit === null)
    return { key, label, consumed, included, billable: null, unit, estimatedCost: null, actualCost: null, attribution }
  const allowance = applyAllowance(consumed, included ?? 0, ratePerUnit ?? 0)
  return { key, label, consumed, included, billable: allowance.billable, unit, estimatedCost: allowance.estimatedCost, actualCost: null, attribution }
}

function getBillingMetricsCoverage(cycle: { from: string, to: string }, now: number): { complete: boolean, reason?: string } {
  const cycleFrom = new Date(cycle.from).getTime()
  const retentionFrom = now - LIVE_GRAPHQL_RETENTION_MS
  if (!Number.isFinite(cycleFrom) || cycleFrom < retentionFrom)
    return { complete: false, reason: 'Current-cycle analytics are only partially covered by the provider retention window; estimated charges and forecast are withheld.' }
  return { complete: true }
}

function buildBilling(metrics: ObservabilityMetric[], now: number, actual: ActualBillingResult | null, metricsCoverage = getBillingMetricsCoverage(actual?.cycle ?? getBillingCycle(now), now)): CloudflareBilling {
  const calendarCycle = getBillingCycle(now)
  const cycle = actual?.cycle ?? calendarCycle
  const workersRequests = metricValue(metrics, 'workers.requests')
  const workersCpuMs = cpuMicrosecondsToMilliseconds(metricValue(metrics, 'workers.cpuTimeUs'))
  const d1RowsRead = metricValue(metrics, 'd1.rowsRead')
  const d1RowsWritten = metricValue(metrics, 'd1.rowsWritten')
  const d1Storage = metricValue(metrics, 'd1.storage_bytes')
  const kvRequests = metricValue(metrics, 'kv.requests')
  const kvReadRequests = metricValue(metrics, 'kv.read_requests')
  const kvWriteRequests = metricValue(metrics, 'kv.write_requests')
  const kvStorage = metricValue(metrics, 'kv.storage_bytes')
  const r2Storage = metricValue(metrics, 'r2.payloadSize')
  const r2Requests = metricValue(metrics, 'r2.requests')
  const r2ClassA = metricValue(metrics, 'r2.class_a_operations')
  const r2ClassB = metricValue(metrics, 'r2.class_b_operations')
  const doRequests = metricValue(metrics, 'durable_objects.requests')
  const doDuration = metricValue(metrics, 'durable_objects.duration')
  const doWebsocketRaw = metricValue(metrics, 'durable_objects.inboundWebsocketMsgCount')
  const doWebsocketBillable = durableObjectBillableRequests(doWebsocketRaw)
  const queueOperations = metricValue(metrics, 'queues.operations')
  const workflowsRuns = metricValue(metrics, 'workflows.runs')
  const workflowsWall = metricValue(metrics, 'workflows.wall_time')

  const usage: BillingUsage[] = [
    billingUsage('workers_requests', 'Workers requests', workersRequests, 10_000_000, 'requests', 0.30 / 1_000_000),
    billingUsage('workers_cpu_ms', 'Workers CPU time', workersCpuMs, 30_000_000, 'cpu_ms', 0.02 / 1_000_000),
    billingUsage('d1_rows_read', 'D1 rows read', d1RowsRead, 25_000_000_000, 'rows', 0.001 / 1_000_000),
    billingUsage('d1_rows_written', 'D1 rows written', d1RowsWritten, 50_000_000, 'rows', 1 / 1_000_000),
    billingUsage('d1_storage', 'D1 current size', d1Storage === null ? null : d1Storage / (1024 ** 3), null, 'GiB', null),
    ...(kvReadRequests !== null || kvWriteRequests !== null
      ? [
          billingUsage('kv_read_requests', 'KV read requests', kvReadRequests, 10_000_000, 'requests', 0.50 / 1_000_000),
          billingUsage('kv_write_requests', 'KV write requests', kvWriteRequests, 1_000_000, 'requests', 5 / 1_000_000),
        ]
      : [billingUsage('kv_requests', 'KV requests (operation split unavailable)', kvRequests, null, 'requests', null)]),
    billingUsage('kv_storage', 'KV current size', kvStorage === null ? null : kvStorage / (1024 ** 3), null, 'GiB', null),
    billingUsage('r2_storage', 'R2 current payload size', r2Storage === null ? null : r2Storage / (1024 ** 3), null, 'GiB', null),
    ...(r2ClassA !== null || r2ClassB !== null
      ? [
          billingUsage('r2_class_a_operations', 'R2 Class A operations', r2ClassA, 1_000_000, 'operations', 4.50 / 1_000_000),
          billingUsage('r2_class_b_operations', 'R2 Class B operations', r2ClassB, 10_000_000, 'operations', 0.36 / 1_000_000),
        ]
      : [billingUsage('r2_operations', 'R2 operations (Class A/B split unavailable)', r2Requests, null, 'operations', null)]),
    billingUsage('durable_objects_requests', 'Durable Objects requests including one shared WebSocket allowance', doRequests === null && doWebsocketBillable === null ? null : (doRequests ?? 0) + (doWebsocketBillable ?? 0), 1_000_000, 'requests', 0.15 / 1_000_000),
    billingUsage('durable_objects_duration', 'Durable Objects duration', doDuration, 400_000, 'GB*s', 12.50 / 1_000_000),
    billingUsage('queues_operations', 'Queues operations', queueOperations, 1_000_000, 'operations', 0.40 / 1_000_000),
    billingUsage('workflows_runs', 'Workflows runs (provider step attribution unavailable)', workflowsRuns, null, 'runs', null),
    billingUsage('workflows_wall_time', 'Workflows wall time (no standalone rate)', workflowsWall, null, 'us', null),
  ].filter(item => item.consumed !== null)

  const variableEstimate = usage.reduce((sum, item) => sum + (item.estimatedCost ?? 0), 0)
  const fallbackFixedFees = 5
  const fixedFees = actual?.fixedFees ?? fallbackFixedFees
  const hasUnpricedUsage = usage.some(item => (item.consumed ?? 0) > 0 && item.estimatedCost === null)
  const estimatedCharges = metricsCoverage.complete && usage.length && !hasUnpricedUsage ? fixedFees + variableEstimate : null
  const cycleFrom = new Date(cycle.from).getTime()
  const cycleTo = new Date(cycle.to).getTime()
  const elapsed = Math.max(1, now - cycleFrom)
  const duration = Math.max(1, cycleTo - cycleFrom)
  const projectedVariable = variableEstimate * (duration / elapsed)
  const forecast = metricsCoverage.complete && usage.length && !hasUnpricedUsage ? fixedFees + projectedVariable : null
  const actualCharges = actual?.charges ?? null
  const status: SourceStatus = !metricsCoverage.complete || hasUnpricedUsage
    ? 'partial'
    : actualCharges !== null && usage.length ? 'live' : usage.length ? 'partial' : actual?.reason ? 'partial' : 'unavailable'
  const reason = actualCharges !== null
    ? [
        'Provider billable usage is reported as current-cycle provider-rated metered usage charges, not a full invoice total; fixed subscription fees, current-cycle estimates, and forecast are kept separate.',
        ACCOUNT_BILLING_SCOPE_REASON,
        hasUnpricedUsage ? 'Some current-cycle usage lines have no published rate, so aggregate estimate and forecast are withheld; per-line estimates remain available where rates are known.' : undefined,
        metricsCoverage.reason,
        actual?.reason,
      ].filter(Boolean).join(' ')
    : [
        `Actual Cloudflare billing is unavailable. Fallback estimate uses published rates under ${PRICING_VERSION}; fixed fees remain separate from usage overage and forecast.`,
        ACCOUNT_BILLING_SCOPE_REASON,
        hasUnpricedUsage ? 'Some current-cycle usage lines have no published rate, so aggregate estimate and forecast are withheld; per-line estimates remain available where rates are known.' : undefined,
        metricsCoverage.reason,
        actual?.reason,
      ].filter(Boolean).join(' ')
  return {
    status,
    cycle,
    currency: actual?.currency ?? 'USD',
    actualCharges,
    estimatedCharges,
    fixedFees,
    forecast,
    usage,
    url: CLOUDFLARE_BILLING_URL,
    reason,
    pricingAsOf: PRICING_AS_OF,
  }
}

function unavailableBilling(reason: string, now = Date.now()): CloudflareBilling {
  return {
    status: 'unavailable',
    cycle: getBillingCycle(now),
    currency: 'USD',
    actualCharges: null,
    estimatedCharges: null,
    fixedFees: null,
    forecast: null,
    usage: [],
    url: CLOUDFLARE_BILLING_URL,
    reason,
    pricingAsOf: PRICING_AS_OF,
  }
}

function unavailableCoverage(checkedAt: string, reason: string): SourceCoverage[] {
  return emptyCoverageSources.map(source => coverage(source, 'unavailable', checkedAt, reason))
}

function emptyReport(query: CloudflareQuery, now: number, reason: string): CloudflareReport {
  const checkedAt = iso(now)
  const meta: ReportMeta = {
    from: query.from.toISOString(),
    to: query.to.toISOString(),
    checkedAt,
    timezone: OBSERVABILITY_TIMEZONE,
    trackingStartedAt: null,
    scope: query.scope,
  }
  return {
    meta,
    coverage: unavailableCoverage(checkedAt, reason),
    resources: [],
    compute: [],
    durableObjects: [],
    storage: [],
    traffic: [],
    services: [],
    billing: unavailableBilling(reason, now),
    series: [],
    deployments: [],
  }
}

function inventoryResourcesForScope(inventory: InventoryResult, query: CloudflareQuery, env: CloudflareEnvironment): CloudflareResource[] {
  return inventory.resources.filter(resource => resourceAllowed(resource, query.scope, env))
}

function serviceInventoryMetrics(resources: CloudflareResource[], scope: CloudflareQuery['scope'], serviceResources: CloudflareResource[] = []): ObservabilityMetric[] {
  const active = scope === 'account' ? resources : resources.filter(resource => resource.project === 'akmalalif')
  const byKind = new Map<string, number>()
  for (const resource of active)
    byKind.set(resource.kind, (byKind.get(resource.kind) ?? 0) + 1)
  const activeServices = scope === 'account' ? serviceResources : serviceResources.filter(resource => resource.project === 'akmalalif')
  if (activeServices.length)
    byKind.set('worker_service', activeServices.length)
  return [...byKind.entries()].map(([kind, count]) => metric(`services.${kind}_count`, `${kind} services`, count, 'services', { detail: 'Inventory count from the Cloudflare API.' }))
}

function sourceCoverageForResult(result: PromiseSettledResult<SourceData>, source: string, checkedAt: string): SourceCoverage {
  if (result.status === 'fulfilled')
    return result.value.coverage
  return coverage(source, providerStatus(result.reason), checkedAt, providerReason(result.reason), true)
}

async function buildReport(env: CloudflareEnvironment, token: string, query: CloudflareQuery, now: number, allowBilling = true): Promise<CloudflareReport> {
  const checkedAt = iso(now)
  const inventory = await readInventory(env, token, now)
  const scopedEnv = withVerifiedBindings(env, inventory.verifiedBindings)
  const variables = [
    ['workers', readWorkers(scopedEnv, token, query, checkedAt)],
    ['durable_objects', readDurableObjects(scopedEnv, token, query, checkedAt)],
    ['d1', readD1(scopedEnv, token, query, checkedAt)],
    ['kv', readKv(scopedEnv, token, query, checkedAt)],
    ['r2', readR2(scopedEnv, token, query, checkedAt)],
    ['zones', readZones(scopedEnv, token, query, checkedAt)],
    ['analytics_engine', readAnalyticsEngine(scopedEnv, token, query, checkedAt)],
    ['ai', readAi(scopedEnv, token, query, checkedAt)],
    ['queues', readQueues(scopedEnv, token, query, checkedAt)],
    ['workflows', readWorkflows(scopedEnv, token, query, checkedAt)],
    ['builds', readBuilds(scopedEnv, token, query, checkedAt)],
  ] as const
  const [settled, actualBilling] = await Promise.all([
    Promise.allSettled(variables.map(([, promise]) => promise)),
    allowBilling ? readActualBilling(env, token) : Promise.resolve(null),
  ])
  const sourceData = new Map<string, SourceData>()
  const sourceCoverage: SourceCoverage[] = [...inventory.coverage]
  for (let index = 0; index < variables.length; index++) {
    const source = variables[index]![0]
    const result = settled[index]!
    if (result.status === 'fulfilled')
      sourceData.set(source, result.value)
    sourceCoverage.push(sourceCoverageForResult(result, source, checkedAt))
  }
  const allSeries = [...sourceData.values()].flatMap(data => data.series)
  const resources = inventoryResourcesForScope(inventory, query, scopedEnv)
  const billingCycle = actualBilling?.cycle ?? getBillingCycle(now)
  let billing: CloudflareBilling
  if (allowBilling) {
    const billingMetricsResult = await readBillingMetrics(scopedEnv, token, billingCycle, 'account', now)
    const metricsCoverage = { complete: billingMetricsResult.complete, reason: billingMetricsResult.reason }
    // Billing is intentionally account-wide even when the report itself is project-filtered.
    billing = buildBilling(billingMetricsResult.metrics, now, actualBilling, metricsCoverage)
    if (actualBilling) {
      sourceCoverage.push(coverage(
        'billing',
        billing.status,
        checkedAt,
        billing.reason,
      ))
    }
  }
  else {
    billing = unavailableBilling('Billing is loaded separately from 15-minute observability collection snapshots; account-wide shared and unattributed costs are not estimated from this window.', now)
  }
  const report: CloudflareReport = {
    meta: {
      from: query.from.toISOString(),
      to: query.to.toISOString(),
      checkedAt,
      timezone: OBSERVABILITY_TIMEZONE,
      trackingStartedAt: null,
      scope: query.scope,
    },
    coverage: sourceCoverage,
    resources,
    compute: sourceData.get('workers')?.metrics ?? [],
    durableObjects: sourceData.get('durable_objects')?.metrics ?? [],
    storage: [
      ...(sourceData.get('d1')?.metrics ?? []),
      ...(sourceData.get('kv')?.metrics ?? []),
      ...(sourceData.get('r2')?.metrics ?? []),
      ...(sourceData.get('durable_objects')?.metrics.filter(item => item.key === 'durable_objects.stored_bytes') ?? []),
    ],
    traffic: [
      ...(sourceData.get('zones')?.metrics ?? []),
      ...(sourceData.get('r2')?.metrics.filter(item => item.key === 'r2.requests' || item.key === 'r2.responseBytes') ?? []),
    ],
    services: [
      ...serviceInventoryMetrics(resources, query.scope, inventory.serviceResources),
      ...(sourceData.get('analytics_engine')?.metrics ?? []),
      ...(sourceData.get('ai')?.metrics ?? []),
      ...(sourceData.get('queues')?.metrics ?? []),
      ...(sourceData.get('workflows')?.metrics ?? []),
      ...(sourceData.get('builds')?.metrics ?? []),
    ],
    billing,
    series: allSeries,
    deployments: inventory.deployments.filter(deployment => resources.some(resource => resource.id === deployment.id || resource.name.toLowerCase() === deployment.resourceName.toLowerCase())),
  }
  return report
}

function database(env: CloudflareEnvironment): D1Like | undefined {
  return env.DB
}

function dailyMetricIsGauge(item: ObservabilityMetric): boolean {
  const key = item.key.toLowerCase()
  return item.unit === 'ratio'
    || /p(?:50|90|99|999)$/.test(key)
    || /storage_bytes|stored_bytes|payloadsize|metadatasize|objectcount|keycount|memory|backlog|concurrency/.test(key)
    || key.startsWith('services.')
}

async function persistReport(env: CloudflareEnvironment, report: CloudflareReport, capturedAt: number): Promise<void> {
  const db = database(env)
  if (!db)
    return
  const scope = report.meta.scope ?? 'account'
  const snapshotAt = floorQuarter(capturedAt)
  const id = `${scope}:${snapshotAt}`
  const snapshot = db.prepare(`
    INSERT OR REPLACE INTO cloudflare_observability_snapshots
      (snapshot_id, scope, captured_at, from_at, to_at, status, report_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id,
    scope,
    snapshotAt,
    report.meta.from,
    report.meta.to,
    report.coverage.some(item => item.status === 'unavailable') ? 'partial' : 'live',
    JSON.stringify(report),
    capturedAt,
  )
  if (snapshot.run)
    await snapshot.run()
  const day = new Date(capturedAt).toISOString().slice(0, 10)
  const metrics = [
    ...report.compute,
    ...report.durableObjects,
    ...report.storage,
    ...report.traffic,
    ...report.services,
  ]
  for (const item of metrics) {
    if (item.value === null)
      continue
    const resourceId = item.resourceId ?? ''
    const existingStatement = db.prepare(`
      SELECT value, updated_at
      FROM cloudflare_observability_daily
      WHERE day = ? AND scope = ? AND metric_key = ? AND resource_id = ?
      LIMIT 1
    `).bind(day, scope, item.key, resourceId)
    const existing = existingStatement.first
      ? await existingStatement.first<{ value?: unknown, updated_at?: unknown }>()
      : null
    const existingAt = asFiniteNumber(existing?.updated_at)
    if (existingAt !== null && existingAt >= snapshotAt)
      continue
    const previousValue = asFiniteNumber(existing?.value)
    const value = !dailyMetricIsGauge(item) && previousValue !== null
      ? previousValue + item.value
      : item.value
    const daily = db.prepare(`
      INSERT INTO cloudflare_observability_daily
        (day, scope, metric_key, resource_id, unit, value, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(day, scope, metric_key, resource_id)
      DO UPDATE SET value = excluded.value, unit = excluded.unit, updated_at = excluded.updated_at
    `).bind(day, scope, item.key, resourceId, item.unit, value, snapshotAt)
    if (daily.run)
      await daily.run()
  }
}

interface DailyMetricRow {
  [key: string]: unknown
  day?: unknown
  metric_key?: unknown
  resource_id?: unknown
  unit?: unknown
  value?: unknown
}

const UTC_DAY_MS = 24 * 60 * 60 * 1000

function utcDayStart(value: Date | number): number {
  const date = new Date(value)
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
}

function isUtcMidnight(value: Date): boolean {
  return value.getUTCHours() === 0 && value.getUTCMinutes() === 0 && value.getUTCSeconds() === 0 && value.getUTCMilliseconds() === 0
}

function dailyQueryBounds(query: CloudflareQuery): { fromDay: string, toDay: string, partialBoundary: boolean } | null {
  const fromStart = utcDayStart(query.from)
  const toStart = utcDayStart(query.to)
  const fromDay = fromStart + (isUtcMidnight(query.from) ? 0 : UTC_DAY_MS)
  const toDay = toStart - UTC_DAY_MS
  if (fromDay > toDay)
    return null
  return {
    fromDay: new Date(fromDay).toISOString().slice(0, 10),
    toDay: new Date(toDay).toISOString().slice(0, 10),
    partialBoundary: !isUtcMidnight(query.from) || !isUtcMidnight(query.to),
  }
}

interface DailyMetricAggregate {
  item: ObservabilityMetric
  latestDay: string
}

function aggregateDailyMetrics(rows: DailyMetricRow[]): { metrics: ObservabilityMetric[], series: CloudflareReport['series'] } {
  const aggregate = new Map<string, DailyMetricAggregate>()
  const series: CloudflareReport['series'] = []
  for (const row of rows) {
    const key = typeof row.metric_key === 'string' ? row.metric_key : ''
    const day = typeof row.day === 'string' ? row.day : ''
    const unit = typeof row.unit === 'string' ? row.unit : 'unknown'
    const value = asFiniteNumber(row.value)
    if (!key || !/^\d{4}-\d{2}-\d{2}$/.test(day) || value === null)
      continue
    const resourceId = typeof row.resource_id === 'string' && row.resource_id ? row.resource_id : undefined
    const item = metric(key, key, value, unit, resourceId ? { resourceId, resourceName: resourceId } : {})
    const aggregateKey = `${key}\u0000${resourceId ?? ''}`
    const previous = aggregate.get(aggregateKey)
    if (!previous) {
      aggregate.set(aggregateKey, { item, latestDay: day })
    }
    else if (dailyMetricIsGauge(item)) {
      if (day >= previous.latestDay)
        aggregate.set(aggregateKey, { item, latestDay: day })
    }
    else {
      aggregate.set(aggregateKey, {
        item: { ...previous.item, value: (previous.item.value ?? 0) + value },
        latestDay: day >= previous.latestDay ? day : previous.latestDay,
      })
    }
    series.push({ timestamp: `${day}T00:00:00.000Z`, metric: key, value, ...(resourceId ? { resourceId } : {}) })
  }
  return { metrics: [...aggregate.values()].map(entry => entry.item), series }
}

function historicalMetricBucket(key: string): 'compute' | 'durableObjects' | 'storage' | 'traffic' | 'services' {
  if (key.startsWith('workers.'))
    return 'compute'
  if (key.startsWith('durable_objects.'))
    return 'durableObjects'
  if (key.startsWith('d1.') || key.startsWith('kv.') || key.startsWith('r2.') || key === 'durable_objects.stored_bytes')
    return 'storage'
  if (key.startsWith('zones.') || key === 'r2.requests' || key === 'r2.responseBytes')
    return 'traffic'
  return 'services'
}

async function readDailyHistoricalReport(env: CloudflareEnvironment, query: CloudflareQuery, now: number): Promise<CloudflareReport | null> {
  const db = database(env)
  if (!db)
    return null
  const bounds = dailyQueryBounds(query)
  if (!bounds)
    return null
  const statement = db.prepare(`
    SELECT day, metric_key, resource_id, unit, value
    FROM cloudflare_observability_daily
    WHERE scope = ? AND day >= ? AND day <= ?
    ORDER BY day ASC, metric_key ASC, resource_id ASC
  `).bind(query.scope, bounds.fromDay, bounds.toDay)
  if (!statement.all)
    return null
  const result = await statement.all<DailyMetricRow>()
  const rows = result.results ?? []
  if (!rows.length)
    return null
  const checkedAt = iso(now)
  const aggregate = aggregateDailyMetrics(rows)
  const compute: ObservabilityMetric[] = []
  const durableObjects: ObservabilityMetric[] = []
  const storage: ObservabilityMetric[] = []
  const traffic: ObservabilityMetric[] = []
  const services: ObservabilityMetric[] = []
  for (const item of aggregate.metrics) {
    const bucket = historicalMetricBucket(item.key)
    if (bucket === 'compute')
      compute.push(item)
    else if (bucket === 'durableObjects')
      durableObjects.push(item)
    else if (bucket === 'storage')
      storage.push(item)
    else if (bucket === 'traffic')
      traffic.push(item)
    else
      services.push(item)
  }
  if (!compute.length && !durableObjects.length && !storage.length && !traffic.length && !services.length)
    return null
  const reason = bounds.partialBoundary
    ? 'Historical Cloudflare daily aggregates cover complete UTC days only; partial boundary days were excluded.'
    : 'Historical Cloudflare daily aggregates; live retention and billing data were not re-read.'
  return {
    meta: {
      from: query.from.toISOString(),
      to: query.to.toISOString(),
      checkedAt,
      timezone: OBSERVABILITY_TIMEZONE,
      trackingStartedAt: null,
      scope: query.scope,
    },
    coverage: emptyCoverageSources.map(source => coverage(source, 'stale', checkedAt, reason)),
    resources: [],
    compute,
    durableObjects,
    storage,
    traffic,
    services,
    billing: unavailableBilling(reason, now),
    series: aggregate.series,
    deployments: [],
  }
}

function mergeMetricLists(historical: ObservabilityMetric[], live: ObservabilityMetric[]): ObservabilityMetric[] {
  const merged = new Map<string, ObservabilityMetric>()
  for (const item of historical) {
    const key = `${item.key}\u0000${item.resourceId ?? ''}`
    merged.set(key, item)
  }
  for (const item of live) {
    const key = `${item.key}\u0000${item.resourceId ?? ''}`
    const previous = merged.get(key)
    if (!previous) {
      merged.set(key, item)
      continue
    }
    if (dailyMetricIsGauge(item)) {
      merged.set(key, item)
      continue
    }
    merged.set(key, {
      ...item,
      value: previous.value === null ? item.value : item.value === null ? previous.value : previous.value + item.value,
    })
  }
  return [...merged.values()]
}

function mergeSeriesLists(historical: CloudflareReport['series'], live: CloudflareReport['series']): CloudflareReport['series'] {
  const merged = new Map<string, CloudflareReport['series'][number]>()
  for (const item of [...historical, ...live]) {
    const key = `${item.timestamp}\u0000${item.metric}\u0000${item.resourceId ?? ''}`
    merged.set(key, item)
  }
  return [...merged.values()].sort((left, right) => left.timestamp.localeCompare(right.timestamp) || left.metric.localeCompare(right.metric))
}

const MIXED_HISTORY_REASON = 'Mixed retained and live Cloudflare data; additive metrics combine daily history with live analytics, gauges use the latest value, and percentiles are not recomputed across the full range.'

function mergeMixedCoverage(
  historical: CloudflareReport | null,
  live: CloudflareReport | null,
  checkedAt: string,
  historyMissing: boolean,
): SourceCoverage[] {
  const historicalCoverage = new Map((historical?.coverage ?? []).map(item => [item.source, item]))
  const liveCoverage = new Map((live?.coverage ?? []).map(item => [item.source, item]))
  const sources = [...new Set([...emptyCoverageSources, ...historicalCoverage.keys(), ...liveCoverage.keys()])]
  return sources.map((source) => {
    const historicalItem = historicalCoverage.get(source)
    const liveItem = liveCoverage.get(source)
    if (source === 'billing' && liveItem)
      return { ...liveItem, checkedAt }
    if (liveItem) {
      const shouldBePartial = historyMissing || Boolean(historicalItem)
      return {
        ...liveItem,
        status: shouldBePartial && liveItem.status === 'live' ? 'partial' : liveItem.status,
        checkedAt,
        reason: [liveItem.reason, historicalItem?.reason, shouldBePartial ? MIXED_HISTORY_REASON : undefined, historyMissing ? 'Stored daily history for the older prefix was unavailable.' : undefined].filter(Boolean).join(' ') || undefined,
      }
    }
    if (historicalItem)
      return { ...historicalItem, checkedAt }
    return coverage(source, historyMissing ? 'partial' : 'unavailable', checkedAt, historyMissing ? 'Stored daily history and live provider data were unavailable for this source.' : undefined)
  })
}

function mergeMixedReports(historical: CloudflareReport | null, live: CloudflareReport | null, query: CloudflareQuery, now: number): CloudflareReport | null {
  if (!historical && !live)
    return null
  if (!historical && live) {
    const checkedAt = iso(now)
    return {
      ...live,
      meta: { ...live.meta, from: query.from.toISOString(), to: query.to.toISOString(), checkedAt, scope: query.scope },
      coverage: mergeMixedCoverage(null, live, checkedAt, true),
    }
  }
  if (historical && !live) {
    return {
      ...historical,
      meta: { ...historical.meta, from: query.from.toISOString(), to: query.to.toISOString(), checkedAt: iso(now), scope: query.scope },
    }
  }
  const checkedAt = iso(now)
  const historicalReport = historical!
  const liveReport = live!
  return {
    meta: { ...liveReport.meta, from: query.from.toISOString(), to: query.to.toISOString(), checkedAt, scope: query.scope },
    coverage: mergeMixedCoverage(historicalReport, liveReport, checkedAt, false),
    resources: liveReport.resources.length ? liveReport.resources : historicalReport.resources,
    compute: mergeMetricLists(historicalReport.compute, liveReport.compute),
    durableObjects: mergeMetricLists(historicalReport.durableObjects, liveReport.durableObjects),
    storage: mergeMetricLists(historicalReport.storage, liveReport.storage),
    traffic: mergeMetricLists(historicalReport.traffic, liveReport.traffic),
    services: mergeMetricLists(historicalReport.services, liveReport.services),
    billing: liveReport.billing,
    series: mergeSeriesLists(historicalReport.series, liveReport.series),
    deployments: liveReport.deployments,
  }
}

async function readHistoricalReport(env: CloudflareEnvironment, query: CloudflareQuery, now: number): Promise<CloudflareReport | null> {
  const db = database(env)
  if (!db)
    return null
  const daily = await readDailyHistoricalReport(env, query, now)
  if (daily)
    return daily
  if (query.to.getTime() <= now - SNAPSHOT_RETENTION_MS)
    return null
  const statement = db.prepare(`
    SELECT report_json
    FROM cloudflare_observability_snapshots
    WHERE scope = ? AND captured_at <= ?
    ORDER BY captured_at DESC
    LIMIT 1
  `).bind(query.scope, query.to.getTime())
  if (!statement.first)
    return null
  const row = await statement.first<{ report_json?: unknown }>()
  if (!row || typeof row.report_json !== 'string')
    return null
  try {
    const report = JSON.parse(row.report_json) as CloudflareReport
    const checkedAt = iso(now)
    return {
      ...report,
      meta: { ...report.meta, from: query.from.toISOString(), to: query.to.toISOString(), checkedAt, scope: query.scope },
      coverage: report.coverage.map(item => ({ ...item, status: item.status === 'unavailable' ? 'unavailable' : 'stale', checkedAt, reason: 'Historical Cloudflare snapshot; live retention does not cover this range.' })),
      billing: { ...report.billing, status: report.billing.status === 'unavailable' ? 'unavailable' : 'stale', reason: 'Historical Cloudflare snapshot; billing was not re-read.' },
    }
  }
  catch {
    return null
  }
}

function mixedLiveStart(now: number): number {
  return utcDayStart(now - LIVE_GRAPHQL_RETENTION_MS) + UTC_DAY_MS
}

async function readMixedRangeReport(env: CloudflareEnvironment, token: string, query: CloudflareQuery, now: number): Promise<CloudflareReport | null> {
  const liveStart = mixedLiveStart(now)
  if (query.from.getTime() >= liveStart || query.to.getTime() <= liveStart)
    return null
  const historicalQuery: CloudflareQuery = {
    ...query,
    to: new Date(liveStart),
    historical: true,
    preset: false,
  }
  const historical = await readDailyHistoricalReport(env, historicalQuery, now)
  const liveFrom = new Date(Math.max(query.from.getTime(), liveStart))
  const liveQuery: CloudflareQuery = {
    ...query,
    from: liveFrom,
    historical: false,
    preset: false,
  }
  const live = liveFrom.getTime() < query.to.getTime()
    ? await buildReport(env, token, liveQuery, now)
    : null
  return mergeMixedReports(historical, live, query, now)
}

async function pruneObservability(env: CloudflareEnvironment, now: number): Promise<void> {
  const db = database(env)
  if (!db)
    return
  const snapshots = db.prepare('DELETE FROM cloudflare_observability_snapshots WHERE captured_at < ?').bind(now - SNAPSHOT_RETENTION_MS)
  if (snapshots.run)
    await snapshots.run()
  const cutoff = new Date(Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth() - (DAILY_RETENTION_MONTHS - 1), 1)).toISOString().slice(0, 10)
  const daily = db.prepare('DELETE FROM cloudflare_observability_daily WHERE day < ?').bind(cutoff)
  if (daily.run)
    await daily.run()
}

function tokenFromEnvironment(env: CloudflareEnvironment): string {
  return getEnvString(env, 'CF_OBSERVABILITY_TOKEN', 'NUXT_CF_OBSERVABILITY_TOKEN', 'cfObservabilityToken') ?? ''
}

function tokenFromEvent(event: H3Event, env: CloudflareEnvironment): string {
  try {
    const runtime = getRuntimeString(event, 'cfObservabilityToken', 'CF_OBSERVABILITY_TOKEN')
    if (runtime.trim())
      return runtime.trim()
  }
  catch {
    // Unit tests and non-Nuxt callers do not provide useRuntimeConfig().
  }
  return tokenFromEnvironment(env)
}

function queryCacheKey(query: CloudflareQuery): string {
  return query.preset
    ? `${query.scope}:preset:${query.range}`
    : `${query.scope}:explicit:${query.from.toISOString()}:${query.to.toISOString()}`
}

export function clearCloudflareObservabilityCache(): void {
  reportCache.clear()
  inventoryCache.clear()
  billingMetricCache.clear()
  actualBillingCache.clear()
}

export async function readCloudflareReport(event: H3Event): Promise<CloudflareReport> {
  const env = (event.context.cloudflare?.env ?? {}) as unknown as CloudflareEnvironment
  const query = parseCloudflareQuery(getQuery(event) as Record<string, QueryValue>)
  const now = Date.now()
  const token = tokenFromEvent(event, env)
  if (!token)
    return emptyReport(query, now, 'Cloudflare observability credentials are unavailable; no demo values are used.')
  if (query.historical) {
    const stored = await readHistoricalReport(env, query, now)
    if (stored)
      return stored
    return emptyReport(query, now, 'The requested range is outside live Cloudflare retention and no stored snapshot is available.')
  }
  const cacheKey = queryCacheKey(query)
  const cached = reportCache.get(cacheKey)
  if (cached && cached.expiresAt > now) {
    return {
      ...cached.report,
      meta: { ...cached.report.meta, from: query.from.toISOString(), to: query.to.toISOString(), scope: query.scope },
    }
  }
  if (query.from.getTime() < mixedLiveStart(now) && query.to.getTime() > mixedLiveStart(now)) {
    const mixed = await readMixedRangeReport(env, token, query, now)
    if (mixed) {
      if (!reportCache.has(cacheKey) && reportCache.size >= MAX_REPORT_CACHE_ENTRIES) {
        const oldest = reportCache.keys().next().value
        if (typeof oldest === 'string')
          reportCache.delete(oldest)
      }
      reportCache.set(cacheKey, { expiresAt: now + OBSERVABILITY_CACHE_MS, report: mixed })
      return mixed
    }
  }
  const effectiveQuery = query.from.getTime() < now - LIVE_GRAPHQL_RETENTION_MS
    ? { ...query, from: new Date(now - LIVE_GRAPHQL_RETENTION_MS), historical: false }
    : query
  const report = await buildReport(env, token, effectiveQuery, now)
  report.meta.from = query.from.toISOString()
  report.meta.to = query.to.toISOString()
  if (effectiveQuery.from.getTime() !== query.from.getTime()) {
    report.coverage = report.coverage.map(item => item.status === 'live'
      ? { ...item, status: 'partial', reason: 'Live Cloudflare data was bounded to the provider retention window.' }
      : item)
  }
  if (!reportCache.has(cacheKey) && reportCache.size >= MAX_REPORT_CACHE_ENTRIES) {
    const oldest = reportCache.keys().next().value
    if (typeof oldest === 'string')
      reportCache.delete(oldest)
  }
  reportCache.set(cacheKey, { expiresAt: now + OBSERVABILITY_CACHE_MS, report })
  return report
}

export async function collectCloudflareObservability(env: CloudflareEnvironment, now = Date.now()): Promise<CloudflareReport> {
  const query: CloudflareQuery = {
    from: new Date(now - 15 * 60 * 1000),
    to: new Date(now),
    scope: 'account',
    range: '15m',
    historical: false,
  }
  const token = tokenFromEnvironment(env)
  const report = token
    ? await buildReport(env, token, query, now, false)
    : emptyReport(query, now, 'Cloudflare observability credentials are unavailable; no demo values are used.')
  try {
    await persistReport(env, report, now)
  }
  catch {
    report.coverage.push(coverage('observability_store', 'partial', iso(now), 'Cloudflare observability data was collected but could not be persisted.'))
  }
  if (token && database(env)) {
    const scopedQuery: CloudflareQuery = {
      from: new Date(now - 15 * 60 * 1000),
      to: new Date(now),
      scope: 'akmalalif',
      range: '15m',
      historical: false,
      preset: true,
    }
    try {
      const scopedReport = await buildReport(env, token, scopedQuery, now, false)
      await persistReport(env, scopedReport, now)
    }
    catch {
      report.coverage.push(coverage('observability_store', 'partial', iso(now), 'Account data was collected, but the akmalalif scope snapshot could not be persisted.'))
    }
  }
  return report
}

export async function runCloudflareMaintenance(env: CloudflareEnvironment, now = Date.now()): Promise<CloudflareReport> {
  const report = await collectCloudflareObservability(env, now)
  try {
    await pruneObservability(env, now)
  }
  catch {
    report.coverage.push(coverage('observability_store', 'partial', iso(now), 'Cloudflare observability retention cleanup failed.'))
  }
  return report
}
