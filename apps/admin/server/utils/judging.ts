import type { H3Event } from 'h3'
import { getHeader, getRequestURL, getRequestWebStream, getRouterParam, readBody, readRawBody } from 'h3'
import { JUDGING_EVENT_ID, JUDGING_REPO_CHECKS, judgingAssignment, judgingTeamIds, loadJudgingModel } from './judging-model'
import { getRuntimeBoolean } from './runtime-config'

export const JUDGING_OWNER_EMAIL = 'iamaleep@gmail.com'
export const JUDGING_R2_PREFIX = `judging/${JUDGING_EVENT_ID}`
export const JUDGING_TEMPLATE_KEY = `${JUDGING_R2_PREFIX}/template.xlsx`
export const JUDGING_MAX_JSON_BYTES = 512 * 1024
export const JUDGING_MAX_EVIDENCE_BYTES = 5 * 1024 * 1024
export const JUDGING_DEVICE_TTL_MS = 7 * 24 * 60 * 60 * 1000
export const JUDGING_PAIR_TTL_MS = 10 * 60 * 1000

type JudgingEnv = Cloudflare.Env & { DB?: D1Database, R2?: R2Bucket, AI?: Ai }
type DbLike = D1Database

interface JudgingDeviceContext {
  id: string
  name: string
  eventId: string
  expiresAt: string
}

interface JudgingRecordRow {
  event_id: string
  record_key: string
  version: number
  data_json: string
  updated_at: string
  updated_by: string
}

export interface JudgingRecord {
  key: string
  version: number
  data: Record<string, unknown>
  updatedAt: string
}

export interface JudgingMutationResult {
  record: JudgingRecord
  idempotent?: boolean
}

export interface JudgingEvidenceMeta {
  id: string
  teamId: string
  snapshotSha: string
  path: string
  kind: 'source' | 'document' | 'transcript' | 'link'
  sha256: string
  text: string
  lines: number
  pages?: { page: number, text: string }[]
  url?: string
  coverage?: string
  createdAt: string
  contentType?: string
  size?: number
  objectKey?: string
  filename?: string
}

function environment(event: H3Event): JudgingEnv {
  return (event.context.cloudflare?.env ?? {}) as JudgingEnv
}

export function requireJudgingDb(event: H3Event): DbLike {
  const db = environment(event).DB
  if (!db) {
    throw createError({ statusCode: 503, statusMessage: 'Judging database binding not configured' })
  }
  return db
}

export function requireJudgingR2(event: H3Event): R2Bucket {
  const bucket = environment(event).R2
  if (!bucket) {
    throw createError({ statusCode: 503, statusMessage: 'Judging R2 binding not configured' })
  }
  return bucket
}

export function judgingEnv(event: H3Event): JudgingEnv {
  return environment(event)
}

export function changes(result: unknown): number {
  if (!result || typeof result !== 'object')
    return 0
  const value = result as { meta?: { changes?: unknown }, changes?: unknown }
  return Number(value.meta?.changes ?? value.changes ?? 0)
}

export function rows<T = Record<string, unknown>>(result: unknown): T[] {
  if (!result || typeof result !== 'object')
    return []
  const value = result as { results?: unknown }
  return Array.isArray(value.results) ? value.results as T[] : []
}

export function first<T = Record<string, unknown>>(result: unknown): T | null {
  return rows<T>(result)[0] ?? null
}

function jsonValue(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw createError({ statusCode: 400, statusMessage: 'Record data must be a JSON object' })
  return value as Record<string, unknown>
}

function stringValue(value: unknown, field: string, max: number, required = true): string {
  if (value == null && !required)
    return ''
  if (typeof value !== 'string')
    throw createError({ statusCode: 400, statusMessage: `${field} must be a string` })
  const result = value.trim()
  if (required && !result)
    throw createError({ statusCode: 400, statusMessage: `${field} is required` })
  if (result.length > max)
    throw createError({ statusCode: 400, statusMessage: `${field} is too long` })
  return result
}

function integerValue(value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max)
    throw createError({ statusCode: 400, statusMessage: `${field} is invalid` })
  return value
}

function booleanValue(value: unknown, field: string, required = false): boolean | undefined {
  if (value == null && !required)
    return undefined
  if (typeof value !== 'boolean')
    throw createError({ statusCode: 400, statusMessage: `${field} must be a boolean` })
  return value
}

function stringArray(value: unknown, field: string, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value) || value.length > maxItems)
    throw createError({ statusCode: 400, statusMessage: `${field} must be an array` })
  return value.map((item, index) => stringValue(item, `${field}[${index}]`, maxLength))
}

function validateReview(data: Record<string, unknown>): Record<string, unknown> {
  if (!Array.isArray(data.scores) || data.scores.length !== 4)
    throw createError({ statusCode: 400, statusMessage: 'review.scores must contain four entries' })
  const scores = data.scores.map((score, index) => {
    if (score === null)
      return null
    if (typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > 100)
      throw createError({ statusCode: 400, statusMessage: `review.scores[${index}] is invalid` })
    return score
  })
  const repoCheck = stringValue(data.repoCheck ?? '', 'review.repoCheck', 80, false)
  if (repoCheck && !(JUDGING_REPO_CHECKS as readonly string[]).includes(repoCheck))
    throw createError({ statusCode: 400, statusMessage: 'review.repoCheck is invalid' })
  const notes = stringValue(data.notes ?? '', 'review.notes', 20_000, false)
  const reviewedAt = data.reviewedAt == null ? '' : stringValue(data.reviewedAt, 'review.reviewedAt', 80, false)
  if (reviewedAt && Number.isNaN(Date.parse(reviewedAt)))
    throw createError({ statusCode: 400, statusMessage: 'review.reviewedAt is invalid' })
  const featureSource = Array.isArray(data.features)
    ? data.features.map((value, index) => [String(index), value] as const)
    : data.features6 && typeof data.features6 === 'object' && !Array.isArray(data.features6)
      ? Object.entries(data.features6 as Record<string, unknown>)
      : []
  if (featureSource.length !== 6)
    throw createError({ statusCode: 400, statusMessage: 'review.features must contain six entries' })
  const features: Record<string, unknown>[] = []
  const features6: Record<string, unknown> = {}
  for (const [key, value] of featureSource) {
    const feature = jsonValue(value)
    const proposal = stringValue(feature.proposal, `review.features6.${key}.proposal`, 20)
    const demo = stringValue(feature.demo, `review.features6.${key}.demo`, 20)
    if (!['unverified', 'present', 'missing'].includes(proposal) || !['unverified', 'present', 'missing'].includes(demo))
      throw createError({ statusCode: 400, statusMessage: `review.features6.${key} has invalid status` })
    const normalizedFeature = { proposal, demo, note: stringValue(feature.note ?? '', `review.features6.${key}.note`, 2_000, false) }
    features.push(normalizedFeature)
    features6[key] = normalizedFeature
  }
  return {
    ...data,
    scores,
    repoCheck,
    notes,
    reviewedAt: reviewedAt || null,
    features,
    features6,
    warningsAcknowledged: booleanValue(data.warningsAcknowledged, 'review.warningsAcknowledged') ?? false,
  }
}

function validateJudge(data: Record<string, unknown>): Record<string, unknown> {
  const name = stringValue(data.name ?? '', 'judge.name', 200, false)
  const date = stringValue(data.date ?? data.dateYYYYMMDD ?? '', 'judge.date', 10, false)
  if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))))
    throw createError({ statusCode: 400, statusMessage: 'judge.date must be YYYY-MM-DD' })
  const domain = stringValue(data.domain ?? '', 'judge.domain', 200, false)
  const generalNotes = stringValue(data.generalNotes ?? '', 'judge.generalNotes', 20_000, false)
  return {
    ...data,
    name,
    date,
    domain,
    generalNotes,
    warningsAcknowledged: booleanValue(data.warningsAcknowledged, 'judge.warningsAcknowledged') ?? false,
  }
}

function validateIntake(data: Record<string, unknown>): Record<string, unknown> {
  const teamId = stringValue(data.teamId, 'intake.teamId', 80)
  const repoUrl = stringValue(data.repoUrl, 'intake.repoUrl', 2_048)
  if (!/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/?$/i.test(repoUrl))
    throw createError({ statusCode: 400, statusMessage: 'intake.repoUrl must be a GitHub repository URL' })
  const branch = stringValue(data.branch ?? '', 'intake.branch', 200, false)
  const sha = stringValue(data.sha ?? '', 'intake.sha', 128, false)
  const retrievedAt = stringValue(data.retrievedAt, 'intake.retrievedAt', 80)
  if (Number.isNaN(Date.parse(retrievedAt)))
    throw createError({ statusCode: 400, statusMessage: 'intake.retrievedAt is invalid' })
  const snapshotPath = stringValue(data.snapshotPath, 'intake.snapshotPath', 2_048)
  const verified = booleanValue(data.verified, 'intake.verified', true)
  const evidenceIds = stringArray(data.evidenceIds ?? [], 'intake.evidenceIds', 128, 160)
  const artifacts = Array.isArray(data.artifacts)
    ? data.artifacts.slice(0, 256).map((item, index) => {
        const value = jsonValue(item)
        return {
          path: stringValue(value.path, `intake.artifacts[${index}].path`, 2_048),
          sha256: stringValue(value.sha256, `intake.artifacts[${index}].sha256`, 128),
          size: integerValue(value.size, `intake.artifacts[${index}].size`, 0, JUDGING_MAX_EVIDENCE_BYTES * 100),
        }
      })
    : []
  const links = Array.isArray(data.links)
    ? data.links.slice(0, 256).map((item, index) => {
        const value = jsonValue(item)
        return {
          url: stringValue(value.url, `intake.links[${index}].url`, 2_048),
          kind: stringValue(value.kind, `intake.links[${index}].kind`, 80),
          status: integerValue(value.status, `intake.links[${index}].status`, 100, 599),
          checkedAt: stringValue(value.checkedAt, `intake.links[${index}].checkedAt`, 80),
        }
      })
    : []
  const demoParity = stringValue(data.demoParity ?? 'unverified', 'intake.demoParity', 30)
  if (!['unverified', 'verified', 'mismatch'].includes(demoParity))
    throw createError({ statusCode: 400, statusMessage: 'intake.demoParity is invalid' })
  return {
    ...data,
    teamId,
    repoUrl,
    branch,
    sha,
    retrievedAt,
    snapshotPath,
    verified,
    evidenceIds,
    artifacts,
    links,
    demoParity,
    issues: stringArray(data.issues ?? [], 'intake.issues', 128, 2_000),
    declaredDemoCommits: stringArray(data.declaredDemoCommits ?? [], 'intake.declaredDemoCommits', 64, 128),
  }
}

function validateEvidence(data: Record<string, unknown>): Record<string, unknown> {
  const id = stringValue(data.id, 'evidence.id', 160)
  const teamId = stringValue(data.teamId, 'evidence.teamId', 80)
  const snapshotSha = stringValue(data.snapshotSha, 'evidence.snapshotSha', 128)
  const path = stringValue(data.path, 'evidence.path', 2_048)
  const kind = stringValue(data.kind, 'evidence.kind', 30)
  if (!['source', 'document', 'transcript', 'link'].includes(kind))
    throw createError({ statusCode: 400, statusMessage: 'evidence.kind is invalid' })
  const sha256 = stringValue(data.sha256, 'evidence.sha256', 128)
  if (!/^[a-f0-9]{32,128}$/i.test(sha256))
    throw createError({ statusCode: 400, statusMessage: 'evidence.sha256 is invalid' })
  const text = data.text ?? ''
  if (typeof text !== 'string' || text.length > 256 * 1024)
    throw createError({ statusCode: 400, statusMessage: 'evidence.text is invalid' })
  const expectedLines = text ? text.split('\n').length : 0
  const lines = integerValue(data.lines ?? expectedLines, 'evidence.lines', 0, 1_000_000)
  if (lines !== expectedLines)
    throw createError({ statusCode: 400, statusMessage: 'evidence.lines does not match evidence.text' })
  const pages = Array.isArray(data.pages)
    ? data.pages.slice(0, 10_000).map((item, index) => {
        const value = jsonValue(item)
        return {
          page: integerValue(value.page, `evidence.pages[${index}].page`, 1, 100_000),
          text: value.text ?? '',
        }
      })
    : undefined
  const createdAt = stringValue(data.createdAt, 'evidence.createdAt', 80)
  if (Number.isNaN(Date.parse(createdAt)))
    throw createError({ statusCode: 400, statusMessage: 'evidence.createdAt is invalid' })
  if (pages?.some(page => typeof page.text !== 'string' || page.text.length > 256 * 1024))
    throw createError({ statusCode: 400, statusMessage: 'evidence.pages text is invalid' })
  return {
    ...data,
    id,
    teamId,
    snapshotSha,
    path,
    kind,
    sha256,
    text,
    lines,
    pages,
    url: data.url == null ? undefined : stringValue(data.url, 'evidence.url', 2_048),
    coverage: data.coverage == null ? undefined : stringValue(data.coverage, 'evidence.coverage', 2_000),
    createdAt,
  }
}

function validateAssessment(data: Record<string, unknown>): Record<string, unknown> {
  const teamId = stringValue(data.teamId, 'assessment.teamId', 80)
  const inputHash = stringValue(data.inputHash, 'assessment.inputHash', 128)
  const status = stringValue(data.status ?? 'draft', 'assessment.status', 30)
  if (!['draft', 'queued', 'running', 'completed', 'failed', 'cancelled'].includes(status))
    throw createError({ statusCode: 400, statusMessage: 'assessment.status is invalid' })
  return {
    ...data,
    teamId,
    inputHash,
    status,
  }
}

export async function validateJudgingRecord(key: string, data: unknown): Promise<Record<string, unknown>> {
  const value = jsonValue(data)
  let normalized: Record<string, unknown>
  if (key === 'judge')
    normalized = validateJudge(value)
  else if (key.startsWith('review:'))
    normalized = validateReview(value)
  else if (key.startsWith('intake:'))
    normalized = validateIntake(value)
  else if (key.startsWith('evidence:'))
    normalized = validateEvidence(value)
  else if (key.startsWith('assessment:'))
    normalized = validateAssessment(value)
  else
    normalized = value

  const keyedId = /^(?:evidence|assessment):(.+)$/.exec(key)?.[1]
  if (keyedId && normalized.id !== undefined && normalized.id !== keyedId)
    throw createError({ statusCode: 400, statusMessage: 'Record id does not match its key' })

  const model = await loadJudgingModel()
  if (typeof model.validateRecord !== 'function')
    return normalized
  const result = await model.validateRecord(key, normalized)
  if (result === false || result == null)
    throw createError({ statusCode: 400, statusMessage: 'Record data failed judging validation' })
  if (typeof result === 'object' && !Array.isArray(result)) {
    const validation = result as { valid?: unknown, ok?: unknown, data?: unknown, error?: unknown }
    if (validation.valid === false || validation.ok === false)
      throw createError({ statusCode: 400, statusMessage: typeof validation.error === 'string' ? validation.error : 'Record data failed judging validation' })
    if (validation.data && typeof validation.data === 'object' && !Array.isArray(validation.data))
      return validation.data as Record<string, unknown>
  }
  return normalized
}

export async function validateRecordKey(key: unknown): Promise<string> {
  if (typeof key !== 'string' || !key.trim() || key.length > 240)
    throw createError({ statusCode: 400, statusMessage: 'Record key is invalid' })
  const value = key.trim()
  if (value === 'judge')
    return value
  const teamIds = await judgingTeamIds()
  const teamId = /^(?:review|intake):([A-Za-z0-9][\w-]{0,79})$/.exec(value)?.[1]
  if (teamId && teamIds.includes(teamId))
    return value
  if (/^(?:evidence|assessment):[\da-f]{8}-[\da-f]{4}-[1-5][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(value))
    return value
  throw createError({ statusCode: 400, statusMessage: 'Record key is not part of this judging event' })
}

function parseRecord(row: JudgingRecordRow): JudgingRecord {
  let data: unknown
  try {
    data = JSON.parse(row.data_json)
  }
  catch {
    throw createError({ statusCode: 500, statusMessage: 'Stored judging record is invalid' })
  }
  return {
    key: row.record_key,
    version: Number(row.version),
    data: jsonValue(data),
    updatedAt: row.updated_at,
  }
}

export async function getJudgingRecord(db: DbLike, key: string): Promise<JudgingRecord | null> {
  const row = first<JudgingRecordRow>(await db.prepare('SELECT event_id, record_key, version, data_json, updated_at, updated_by FROM judging_records WHERE event_id = ? AND record_key = ? LIMIT 1').bind(JUDGING_EVENT_ID, key).all())
  return row ? parseRecord(row) : null
}

export async function listJudgingRecords(db: DbLike): Promise<JudgingRecord[]> {
  const result = await db.prepare('SELECT event_id, record_key, version, data_json, updated_at, updated_by FROM judging_records WHERE event_id = ? ORDER BY record_key ASC').bind(JUDGING_EVENT_ID).all()
  return rows<JudgingRecordRow>(result).map(parseRecord)
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value))
    return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>).sort().map(key => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export async function sha256Text(value: string): Promise<string> {
  return bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))))
}

export async function sha256Bytes(value: Uint8Array): Promise<string> {
  const copy = new Uint8Array(value.byteLength)
  copy.set(value)
  return bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-256', copy.buffer)))
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

export async function saveJudgingRecord(
  db: DbLike,
  key: string,
  baseVersion: number,
  data: Record<string, unknown>,
  mutationId: string,
  actor: string,
  deviceId?: string,
): Promise<JudgingMutationResult> {
  if (!Number.isInteger(baseVersion) || baseVersion < 0 || baseVersion > Number.MAX_SAFE_INTEGER)
    throw createError({ statusCode: 400, statusMessage: 'baseVersion is invalid' })
  if (!/^[A-Z0-9][\w-]{0,159}$/i.test(mutationId))
    throw createError({ statusCode: 400, statusMessage: 'mutationId is invalid' })
  const requestHash = await sha256Text(canonicalJson({ key, baseVersion, data }))
  const existingMutation = first<{ request_hash: string, response_json: string }>(await db.prepare('SELECT request_hash, response_json FROM judging_mutations WHERE event_id = ? AND mutation_id = ? LIMIT 1').bind(JUDGING_EVENT_ID, mutationId).all())
  if (existingMutation) {
    if (existingMutation.request_hash !== requestHash)
      throw createError({ statusCode: 409, statusMessage: 'mutationId was already used for another record' })
    try {
      return { record: JSON.parse(existingMutation.response_json) as JudgingRecord, idempotent: true }
    }
    catch {
      throw createError({ statusCode: 500, statusMessage: 'Stored judging mutation is invalid' })
    }
  }

  const now = new Date().toISOString()
  let result: unknown
  if (baseVersion === 0) {
    result = await db.prepare('INSERT INTO judging_records (event_id, record_key, version, data_json, updated_at, updated_by) VALUES (?, ?, 1, ?, ?, ?) ON CONFLICT(event_id, record_key) DO NOTHING').bind(JUDGING_EVENT_ID, key, JSON.stringify(data), now, actor).run()
  }
  else {
    result = await db.prepare('UPDATE judging_records SET version = ?, data_json = ?, updated_at = ?, updated_by = ? WHERE event_id = ? AND record_key = ? AND version = ?').bind(baseVersion + 1, JSON.stringify(data), now, actor, JUDGING_EVENT_ID, key, baseVersion).run()
  }
  if (changes(result) !== 1) {
    const current = await getJudgingRecord(db, key)
    throw createError({ statusCode: 409, statusMessage: 'Record version conflict', data: { current } })
  }

  const record = await getJudgingRecord(db, key)
  if (!record)
    throw createError({ statusCode: 500, statusMessage: 'Judging record was not persisted' })
  const responseJson = JSON.stringify(record)
  try {
    await db.batch([
      db.prepare('INSERT INTO judging_mutations (event_id, mutation_id, record_key, base_version, request_hash, response_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(JUDGING_EVENT_ID, mutationId, key, baseVersion, requestHash, responseJson, now),
      db.prepare('INSERT INTO judging_events (id, event_id, event_type, record_key, mutation_id, actor, device_id, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(crypto.randomUUID(), JUDGING_EVENT_ID, 'record.write', key, mutationId, actor, deviceId ?? null, responseJson, now),
    ])
  }
  catch (error) {
    const retry = first<{ request_hash: string, response_json: string }>(await db.prepare('SELECT request_hash, response_json FROM judging_mutations WHERE event_id = ? AND mutation_id = ? LIMIT 1').bind(JUDGING_EVENT_ID, mutationId).all())
    if (!retry)
      throw error
    if (retry.request_hash !== requestHash)
      throw createError({ statusCode: 409, statusMessage: 'mutationId was already used for another record' })
  }
  return { record }
}

export async function recordJudgingEvent(db: DbLike, eventType: string, actor: string, payload: unknown, recordKey?: string, deviceId?: string): Promise<void> {
  const safeType = stringValue(eventType, 'eventType', 80)
  const payloadJson = JSON.stringify(payload ?? {})
  if (payloadJson.length > 64 * 1024)
    throw createError({ statusCode: 413, statusMessage: 'Judging event payload is too large' })
  await db.prepare('INSERT INTO judging_events (id, event_id, event_type, record_key, mutation_id, actor, device_id, payload_json, created_at) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?)').bind(crypto.randomUUID(), JUDGING_EVENT_ID, safeType, recordKey ?? null, actor, deviceId ?? null, payloadJson, new Date().toISOString()).run()
}

export async function readJudgingJson<T extends Record<string, unknown>>(event: H3Event, maxBytes = JUDGING_MAX_JSON_BYTES): Promise<T> {
  const contentLength = getHeader(event, 'content-length')
  if (contentLength) {
    const length = Number(contentLength)
    if (!Number.isSafeInteger(length) || length < 0 || length > maxBytes)
      throw createError({ statusCode: 413, statusMessage: 'Judging request body is too large' })
  }
  const stream = getRequestWebStream(event)
  let bytes: Uint8Array | null = null
  if (stream && typeof (stream as ReadableStream).getReader === 'function') {
    const reader = (stream as ReadableStream<Uint8Array>).getReader()
    const chunks: Uint8Array[] = []
    let size = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done)
        break
      const chunk = value instanceof Uint8Array ? value : new Uint8Array(value)
      size += chunk.byteLength
      if (size > maxBytes) {
        await reader.cancel()
        throw createError({ statusCode: 413, statusMessage: 'Judging request body is too large' })
      }
      chunks.push(chunk)
    }
    bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
  }
  else {
    const raw = await readRawBody(event)
    if (raw != null) {
      bytes = typeof raw === 'string' ? new TextEncoder().encode(raw) : new Uint8Array(raw)
      if (bytes.byteLength > maxBytes)
        throw createError({ statusCode: 413, statusMessage: 'Judging request body is too large' })
    }
  }
  let value: unknown
  try {
    value = bytes ? JSON.parse(new TextDecoder().decode(bytes)) : await readBody(event)
  }
  catch {
    throw createError({ statusCode: 400, statusMessage: 'Judging request body must be valid JSON' })
  }
  return jsonValue(value) as T
}

export async function readJudgingBytes(event: H3Event, maxBytes = JUDGING_MAX_EVIDENCE_BYTES): Promise<Uint8Array> {
  const contentLength = getHeader(event, 'content-length')
  if (contentLength) {
    const length = Number(contentLength)
    if (!Number.isSafeInteger(length) || length < 0 || length > maxBytes)
      throw createError({ statusCode: 413, statusMessage: 'Evidence is too large' })
  }
  const stream = getRequestWebStream(event)
  if (stream && typeof (stream as ReadableStream).getReader === 'function') {
    const reader = (stream as ReadableStream<Uint8Array>).getReader()
    const chunks: Uint8Array[] = []
    let size = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done)
        break
      const chunk = value instanceof Uint8Array ? value : new Uint8Array(value)
      size += chunk.byteLength
      if (size > maxBytes) {
        await reader.cancel()
        throw createError({ statusCode: 413, statusMessage: 'Evidence is too large' })
      }
      chunks.push(chunk)
    }
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    return bytes
  }
  const raw = await readRawBody(event)
  const bytes = raw == null ? new Uint8Array() : typeof raw === 'string' ? new TextEncoder().encode(raw) : new Uint8Array(raw)
  if (bytes.byteLength > maxBytes)
    throw createError({ statusCode: 413, statusMessage: 'Evidence is too large' })
  return bytes
}

export function eventParam(event: H3Event, expected = JUDGING_EVENT_ID): string {
  const eventId = getRouterParam(event, 'event') || expected
  if (eventId !== expected)
    throw createError({ statusCode: 404, statusMessage: 'Judging event not found' })
  return eventId
}

export function pathId(event: H3Event): string {
  const id = getRouterParam(event, 'id')?.trim() || ''
  if (!/^[A-Z0-9][\w-]{0,159}$/i.test(id))
    throw createError({ statusCode: 400, statusMessage: 'Judging identifier is invalid' })
  return id
}

function requestIsSameOrigin(event: H3Event): boolean {
  const origin = getHeader(event, 'origin')
  if (origin && origin !== getRequestURL(event).origin)
    return false
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(event.method))
    return origin === getRequestURL(event).origin
  return true
}

export function requireJudgingOwner(event: H3Event): { actor: string } {
  const authMethod = String(event.context.authMethod ?? '')
  const email = String(event.context.userEmail ?? '').trim().toLowerCase()
  const local = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(getRequestURL(event).hostname)
  const localAllowed = authMethod === 'local-admin' && local && getRuntimeBoolean(event, 'allowLocalAdmin', 'ALLOW_LOCAL_ADMIN')
  if ((authMethod !== 'access-user' && !localAllowed) || email !== JUDGING_OWNER_EMAIL)
    throw createError({ statusCode: 403, statusMessage: 'The judging owner account is required' })
  if (!requestIsSameOrigin(event))
    throw createError({ statusCode: 403, statusMessage: 'Judging owner requests must be same-origin' })
  return { actor: email }
}

function setDeviceContext(event: H3Event, device: JudgingDeviceContext): void {
  const context = event.context as unknown as Record<string, unknown>
  context.judgingDevice = device
  context.authMethod = 'judging-device'
  context.userID = device.id
  context.userEmail = `device:${device.id}`
}

export async function authenticateJudgingDeviceRequest(event: H3Event, eventId = JUDGING_EVENT_ID): Promise<boolean> {
  const token = getHeader(event, 'authorization')?.replace(/^Bearer\s+/i, '').trim()
  if (!token || token.length < 32)
    return false
  const db = requireJudgingDb(event)
  const tokenHash = await sha256Text(token)
  const now = new Date().toISOString()
  const row = first<{ id: string, name: string, event_id: string, expires_at: string }>(await db.prepare('SELECT id, name, event_id, expires_at FROM judging_devices WHERE event_id = ? AND token_hash = ? AND revoked_at IS NULL AND expires_at > ? LIMIT 1').bind(eventId, tokenHash, now).all())
  if (!row)
    return false
  await db.prepare('UPDATE judging_devices SET last_seen_at = ? WHERE id = ? AND event_id = ?').bind(now, row.id, eventId).run()
  setDeviceContext(event, { id: row.id, name: row.name, eventId: row.event_id, expiresAt: row.expires_at })
  return true
}

export async function requireJudgingDevice(event: H3Event, eventId = JUDGING_EVENT_ID): Promise<JudgingDeviceContext> {
  const context = (event.context as unknown as { judgingDevice?: JudgingDeviceContext }).judgingDevice
  if (context?.eventId === eventId)
    return context
  if (await authenticateJudgingDeviceRequest(event, eventId))
    return (event.context as unknown as { judgingDevice: JudgingDeviceContext }).judgingDevice
  throw createError({ statusCode: 401, statusMessage: 'A valid judging device token is required' })
}

export async function createPairCode(db: DbLike, actor: string): Promise<{ code: string, expiresAt: string }> {
  const bytes = new Uint8Array(8)
  crypto.getRandomValues(bytes)
  const code = [...bytes].map(value => String(value % 10)).join('')
  const expiresAt = new Date(Date.now() + JUDGING_PAIR_TTL_MS).toISOString()
  const codeHash = await sha256Text(code)
  await db.prepare('INSERT INTO judging_pair_codes (event_id, code_hash, created_at, expires_at, used_at, created_by) VALUES (?, ?, ?, ?, NULL, ?)').bind(JUDGING_EVENT_ID, codeHash, new Date().toISOString(), expiresAt, actor).run()
  return { code, expiresAt }
}

async function pairRateLimit(db: DbLike, event: H3Event): Promise<void> {
  const ip = getHeader(event, 'x-judging-pair-ip') || getHeader(event, 'cf-connecting-ip') || getHeader(event, 'x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  const clientHash = await sha256Text(ip)
  const now = Date.now()
  const windowStart = Math.floor(now / 60_000) * 60_000
  await db.prepare(`INSERT INTO judging_pair_attempts (event_id, client_hash, window_started_at, attempts)
    VALUES (?, ?, ?, 1)
    ON CONFLICT(event_id, client_hash) DO UPDATE SET
      attempts = CASE WHEN window_started_at = excluded.window_started_at THEN attempts + 1 ELSE 1 END,
      window_started_at = excluded.window_started_at`).bind(JUDGING_EVENT_ID, clientHash, windowStart).run()
  const row = first<{ attempts: number }>(await db.prepare('SELECT attempts FROM judging_pair_attempts WHERE event_id = ? AND client_hash = ? LIMIT 1').bind(JUDGING_EVENT_ID, clientHash).all())
  if (Number(row?.attempts ?? 0) > 10)
    throw createError({ statusCode: 429, statusMessage: 'Pair-code redemption is rate limited' })
}

export async function redeemPairCode(db: DbLike, event: H3Event, codeValue: unknown, nameValue: unknown): Promise<{ token: string, device: { id: string, name: string, expiresAt: string } }> {
  await pairRateLimit(db, event)
  const code = stringValue(codeValue, 'code', 40)
  const name = stringValue(nameValue, 'name', 120)
  const codeHash = await sha256Text(code)
  const now = new Date().toISOString()
  const row = first<{ code_hash: string, expires_at: string, used_at: string | null }>(await db.prepare('SELECT code_hash, expires_at, used_at FROM judging_pair_codes WHERE event_id = ? AND code_hash = ? LIMIT 1').bind(JUDGING_EVENT_ID, codeHash).all())
  if (!row)
    throw createError({ statusCode: 400, statusMessage: 'Pair code is invalid' })
  if (row.used_at || row.expires_at <= now)
    throw createError({ statusCode: 410, statusMessage: 'Pair code has expired or already been used' })
  const token = randomToken()
  const id = crypto.randomUUID()
  const expiresAt = new Date(Date.now() + JUDGING_DEVICE_TTL_MS).toISOString()
  const tokenHash = await sha256Text(token)
  const updated = await db.prepare('UPDATE judging_pair_codes SET used_at = ? WHERE event_id = ? AND code_hash = ? AND used_at IS NULL AND expires_at > ?').bind(now, JUDGING_EVENT_ID, codeHash, now).run()
  if (changes(updated) !== 1)
    throw createError({ statusCode: 410, statusMessage: 'Pair code has expired or already been used' })
  await db.batch([
    db.prepare('INSERT INTO judging_devices (id, event_id, name, token_hash, created_at, expires_at, last_seen_at, revoked_at, paired_by) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?)').bind(id, JUDGING_EVENT_ID, name, tokenHash, now, expiresAt, 'pair-code'),
    db.prepare('INSERT INTO judging_events (id, event_id, event_type, record_key, mutation_id, actor, device_id, payload_json, created_at) VALUES (?, ?, ?, NULL, NULL, ?, ?, ?, ?)').bind(crypto.randomUUID(), JUDGING_EVENT_ID, 'device.paired', `device:${id}`, id, JSON.stringify({ name }), now),
  ])
  return { token, device: { id, name, expiresAt } }
}

export async function listJudgingDevices(db: DbLike): Promise<{ id: string, name: string, createdAt: string, expiresAt: string, lastSeenAt: string | null, revokedAt: string | null }[]> {
  const result = await db.prepare('SELECT id, name, created_at, expires_at, last_seen_at, revoked_at FROM judging_devices WHERE event_id = ? ORDER BY created_at DESC').bind(JUDGING_EVENT_ID).all()
  return rows<{ id: string, name: string, created_at: string, expires_at: string, last_seen_at: string | null, revoked_at: string | null }>(result).map(row => ({
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    lastSeenAt: row.last_seen_at,
    revokedAt: row.revoked_at,
  }))
}

export async function revokeJudgingDevice(db: DbLike, id: string, actor: string): Promise<void> {
  const now = new Date().toISOString()
  const result = await db.prepare('UPDATE judging_devices SET revoked_at = ? WHERE event_id = ? AND id = ? AND revoked_at IS NULL').bind(now, JUDGING_EVENT_ID, id).run()
  if (changes(result) !== 1)
    throw createError({ statusCode: 404, statusMessage: 'Judging device not found or already revoked' })
  await recordJudgingEvent(db, 'device.revoked', actor, { id }, undefined, id)
}

export async function putJudgingTemplate(event: H3Event, bytes: Uint8Array, actor: string, deviceId?: string): Promise<{ size: number, sha256: string, updatedAt: string }> {
  const bucket = requireJudgingR2(event)
  const sha256 = await sha256Bytes(bytes)
  const updatedAt = new Date().toISOString()
  await bucket.put(JUDGING_TEMPLATE_KEY, bytes, {
    httpMetadata: { contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
    customMetadata: { sha256, updatedAt, eventId: JUDGING_EVENT_ID, actor, deviceId: deviceId ?? '' },
  })
  return { size: bytes.byteLength, sha256, updatedAt }
}

export async function getJudgingTemplate(event: H3Event): Promise<Uint8Array> {
  const bucket = requireJudgingR2(event)
  const object = await bucket.get(JUDGING_TEMPLATE_KEY)
  if (!object)
    throw createError({ statusCode: 404, statusMessage: 'Judging workbook template has not been uploaded' })
  const bytes = new Uint8Array(await object.arrayBuffer())
  if (bytes.byteLength > 20 * 1024 * 1024)
    throw createError({ statusCode: 500, statusMessage: 'Judging workbook template is too large' })
  return bytes
}

export async function putJudgingEvidence(event: H3Event, id: string, bytes: Uint8Array, actor: string, deviceId?: string): Promise<JudgingEvidenceMeta> {
  if (bytes.byteLength > JUDGING_MAX_EVIDENCE_BYTES)
    throw createError({ statusCode: 413, statusMessage: 'Evidence is too large' })
  const contentType = getHeader(event, 'content-type')?.split(';', 1)[0]?.trim().toLowerCase() || 'application/octet-stream'
  const kind = String(getHeader(event, 'x-judging-kind') || 'source')
  if (!['source', 'document', 'transcript', 'link'].includes(kind))
    throw createError({ statusCode: 400, statusMessage: 'Evidence kind is invalid' })
  const bucket = requireJudgingR2(event)
  const sha256 = await sha256Bytes(bytes)
  const objectKey = `${JUDGING_R2_PREFIX}/evidence/${id}`
  await bucket.put(objectKey, bytes, {
    httpMetadata: { contentType },
    customMetadata: { sha256, eventId: JUDGING_EVENT_ID, actor, deviceId: deviceId ?? '' },
  })
  const now = new Date().toISOString()
  const meta: JudgingEvidenceMeta = {
    id,
    teamId: String(getHeader(event, 'x-judging-team-id') || ''),
    snapshotSha: String(getHeader(event, 'x-judging-snapshot-sha') || ''),
    path: String(getHeader(event, 'x-judging-path') || id),
    kind: kind as JudgingEvidenceMeta['kind'],
    sha256,
    text: '',
    lines: 0,
    createdAt: now,
    contentType,
    size: bytes.byteLength,
    objectKey,
    filename: getHeader(event, 'x-judging-filename') || undefined,
  }
  return meta
}

export async function getJudgingEvidenceObject(event: H3Event, id: string): Promise<{ object: R2ObjectBody, meta: JudgingEvidenceMeta | null }> {
  const bucket = requireJudgingR2(event)
  const object = await bucket.get(`${JUDGING_R2_PREFIX}/evidence/${id}`)
  if (!object)
    throw createError({ statusCode: 404, statusMessage: 'Judging evidence not found' })
  const db = requireJudgingDb(event)
  const row = await getJudgingRecord(db, `evidence:${id}`)
  return { object, meta: row?.data as unknown as JudgingEvidenceMeta | null }
}

export function randomToken(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  let binary = ''
  for (const byte of bytes)
    binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

export function recordResponseBody(record: JudgingRecord): JudgingRecord {
  return record
}

export async function judgingState(db: DbLike): Promise<{ assignment: unknown, records: JudgingRecord[], serverTime: string }> {
  return {
    assignment: await judgingAssignment(),
    records: await listJudgingRecords(db),
    serverTime: new Date().toISOString(),
  }
}

export function modelReadiness(input: unknown): boolean {
  return Boolean(input)
}
