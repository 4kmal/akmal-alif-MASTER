import type { H3Event } from 'h3'
import { getHeader, getQuery, getRequestURL, getRequestWebStream, getRouterParam, readBody, readRawBody } from 'h3'
import { assertRecord, ASSIGNMENT, TEAM_IDS } from '../../shared/judging/model.mjs'
import { getRuntimeBoolean, getRuntimeString } from './runtime-config'

export const JUDGING_EVENT_ID = ASSIGNMENT.id

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

export interface JudgingRecordRow {
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
  coverage: string
  createdAt: string
  contentType?: string
  size?: number
  objectKey?: string
  jsonSha256?: string
  jsonObjectKey?: string
  filename?: string
}

const EVIDENCE_ID_PATTERN = /^(?:[\da-f]{32}|[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12})$/i
const SHA256_PATTERN = /^[\da-f]{64}$/i

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
export function validateJudgingRecord(key: string, data: unknown): Record<string, unknown> {
  const value = jsonValue(data)
  try {
    return jsonValue(assertRecord(key, value))
  }
  catch (error) {
    throw createError({ statusCode: 400, statusMessage: error instanceof Error ? error.message : 'Record data failed judging validation' })
  }
}

export async function validateRecordKey(key: unknown): Promise<string> {
  if (typeof key !== 'string' || !key.trim() || key.length > 240)
    throw createError({ statusCode: 400, statusMessage: 'Record key is invalid' })
  const value = key.trim()
  if (value === 'judge')
    return value
  const teamIds = TEAM_IDS as readonly string[]
  const teamId = /^(?:review|intake):([A-Za-z0-9][\w-]{0,79})$/.exec(value)?.[1]
  if (teamId && teamIds.includes(teamId))
    return value
  if (/^(?:evidence|assessment):(?:[\da-f]{32}|[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12})$/i.test(value))
    return value
  throw createError({ statusCode: 400, statusMessage: 'Record key is not part of this judging event' })
}

export function parseJudgingRecordRow(row: JudgingRecordRow): JudgingRecord {
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
  return row ? parseJudgingRecordRow(row) : null
}

export async function listJudgingRecords(db: DbLike): Promise<JudgingRecord[]> {
  const result = await db.prepare('SELECT event_id, record_key, version, data_json, updated_at, updated_by FROM judging_records WHERE event_id = ? ORDER BY record_key ASC').bind(JUDGING_EVENT_ID).all()
  return rows<JudgingRecordRow>(result).map(parseJudgingRecordRow)
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value))
    return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>).sort().map(key => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function mutationHashData(key: string, data: Record<string, unknown>): Record<string, unknown> {
  if (!key.startsWith('evidence:'))
    return data
  const value = { ...data }
  delete value.jsonSha256
  delete value.jsonObjectKey
  return value
}

function evidenceSourceObjectKey(id: string, sha256: string): string {
  return `${JUDGING_R2_PREFIX}/evidence/${id}/${sha256}`
}

function evidenceJsonObjectKey(id: string, jsonSha256: string): string {
  return `${JUDGING_R2_PREFIX}/evidence/${id}/json/${jsonSha256}`
}

function assertEvidenceStorageFields(id: string, data: Record<string, unknown>): void {
  if (!EVIDENCE_ID_PATTERN.test(id))
    throw createError({ statusCode: 400, statusMessage: 'Evidence identifier is invalid' })

  const objectKey = data.objectKey
  if (objectKey !== undefined) {
    if (typeof data.sha256 !== 'string' || !SHA256_PATTERN.test(data.sha256) || typeof objectKey !== 'string' || objectKey !== evidenceSourceObjectKey(id, data.sha256))
      throw createError({ statusCode: 400, statusMessage: 'Evidence source object key is invalid' })
  }

  const jsonSha256 = data.jsonSha256
  const jsonObjectKey = data.jsonObjectKey
  if (jsonSha256 !== undefined || jsonObjectKey !== undefined) {
    if (typeof jsonSha256 !== 'string' || !SHA256_PATTERN.test(jsonSha256) || typeof jsonObjectKey !== 'string' || jsonObjectKey !== evidenceJsonObjectKey(id, jsonSha256))
      throw createError({ statusCode: 400, statusMessage: 'Evidence JSON object key is invalid' })
  }
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
  event?: H3Event,
): Promise<JudgingMutationResult> {
  if (!Number.isInteger(baseVersion) || baseVersion < 0 || baseVersion > Number.MAX_SAFE_INTEGER)
    throw createError({ statusCode: 400, statusMessage: 'baseVersion is invalid' })
  if (!/^[A-Z0-9][\w-]{0,159}$/i.test(mutationId))
    throw createError({ statusCode: 400, statusMessage: 'mutationId is invalid' })
  let requestHash = await sha256Text(canonicalJson({ key, baseVersion, data: mutationHashData(key, data) }))
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
  if (key.startsWith('evidence:')) {
    const evidenceId = key.slice('evidence:'.length)
    assertEvidenceStorageFields(evidenceId, data)
    const current = baseVersion > 0 ? await getJudgingRecord(db, key) : null
    const currentHash = current?.data.sha256
    const nextHash = data.sha256
    if (baseVersion > 0 && typeof currentHash === 'string' && typeof nextHash === 'string' && currentHash !== nextHash)
      throw createError({ statusCode: 409, statusMessage: 'Evidence source sha256 is immutable', data: { current } })
    if (typeof current?.data.objectKey === 'string' && data.objectKey == null)
      data = { ...current.data, ...data, objectKey: current.data.objectKey }
    assertEvidenceStorageFields(evidenceId, data)
    if (event) {
      data = validateJudgingRecord(key, data)
      data = await mirrorJudgingEvidenceRecord(event, evidenceId, data, actor, deviceId)
    }
    requestHash = await sha256Text(canonicalJson({ key, baseVersion, data: mutationHashData(key, data) }))
  }

  const now = new Date().toISOString()
  const claimId = crypto.randomUUID()
  const record: JudgingRecord = {
    key,
    version: baseVersion + 1,
    data,
    updatedAt: now,
  }
  const responseJson = JSON.stringify(record)
  try {
    const claim = baseVersion === 0
      ? db.prepare(`INSERT INTO judging_mutations
          (event_id, mutation_id, claim_id, record_key, base_version, request_hash, response_json, created_at)
          SELECT ?, ?, ?, ?, ?, ?, ?, ?
          WHERE NOT EXISTS (SELECT 1 FROM judging_records WHERE event_id = ? AND record_key = ?)`)
          .bind(JUDGING_EVENT_ID, mutationId, claimId, key, baseVersion, requestHash, responseJson, now, JUDGING_EVENT_ID, key)
      : db.prepare(`INSERT INTO judging_mutations
          (event_id, mutation_id, claim_id, record_key, base_version, request_hash, response_json, created_at)
          SELECT ?, ?, ?, ?, ?, ?, ?, ?
          WHERE EXISTS (SELECT 1 FROM judging_records WHERE event_id = ? AND record_key = ? AND version = ?)`)
          .bind(JUDGING_EVENT_ID, mutationId, claimId, key, baseVersion, requestHash, responseJson, now, JUDGING_EVENT_ID, key, baseVersion)
    const write = baseVersion === 0
      ? db.prepare(`INSERT INTO judging_records
          (event_id, record_key, version, data_json, updated_at, updated_by)
          SELECT ?, ?, ?, ?, ?, ?
          WHERE EXISTS (SELECT 1 FROM judging_mutations WHERE event_id = ? AND mutation_id = ? AND claim_id = ?)`)
          .bind(JUDGING_EVENT_ID, key, record.version, JSON.stringify(data), now, actor, JUDGING_EVENT_ID, mutationId, claimId)
      : db.prepare(`UPDATE judging_records
          SET version = ?, data_json = ?, updated_at = ?, updated_by = ?
          WHERE event_id = ? AND record_key = ? AND version = ?
            AND EXISTS (SELECT 1 FROM judging_mutations WHERE event_id = ? AND mutation_id = ? AND claim_id = ?)`)
          .bind(record.version, JSON.stringify(data), now, actor, JUDGING_EVENT_ID, key, baseVersion, JUDGING_EVENT_ID, mutationId, claimId)
    const audit = db.prepare(`INSERT INTO judging_events
        (id, event_id, event_type, record_key, mutation_id, actor, device_id, payload_json, created_at)
        SELECT ?, ?, ?, ?, ?, ?, ?, response_json, ?
        FROM judging_mutations
        WHERE event_id = ? AND mutation_id = ? AND claim_id = ?`)
      .bind(crypto.randomUUID(), JUDGING_EVENT_ID, 'record.write', key, mutationId, actor, deviceId ?? null, now, JUDGING_EVENT_ID, mutationId, claimId)
    const result = await db.batch([claim, write, audit])
    if (changes(result?.[0]) !== 1) {
      const retry = first<{ request_hash: string, response_json: string }>(await db.prepare('SELECT request_hash, response_json FROM judging_mutations WHERE event_id = ? AND mutation_id = ? LIMIT 1').bind(JUDGING_EVENT_ID, mutationId).all())
      if (retry) {
        if (retry.request_hash !== requestHash)
          throw createError({ statusCode: 409, statusMessage: 'mutationId was already used for another record' })
        return { record: JSON.parse(retry.response_json) as JudgingRecord, idempotent: true }
      }
      const current = await getJudgingRecord(db, key)
      throw createError({ statusCode: 409, statusMessage: 'Record version conflict', data: { current } })
    }
  }
  catch (error) {
    const retry = first<{ request_hash: string, response_json: string }>(await db.prepare('SELECT request_hash, response_json FROM judging_mutations WHERE event_id = ? AND mutation_id = ? LIMIT 1').bind(JUDGING_EVENT_ID, mutationId).all())
    if (!retry)
      throw error
    if (retry.request_hash !== requestHash)
      throw createError({ statusCode: 409, statusMessage: 'mutationId was already used for another record' })
    try {
      return { record: JSON.parse(retry.response_json) as JudgingRecord, idempotent: true }
    }
    catch {
      throw createError({ statusCode: 500, statusMessage: 'Stored judging mutation is invalid' })
    }
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

export function requireJudgingPairRequest(event: H3Event): void {
  const gatewaySecret = getRuntimeString(event, 'portfolioGatewayToken', 'PORTFOLIO_GATEWAY_TOKEN').trim()
  const gatewayToken = getHeader(event, 'x-portfolio-gateway')?.trim() || ''
  const trustedGateway = !!gatewaySecret && gatewayToken === gatewaySecret
  let canonicalOrigin = false
  const configuredOrigin = getRuntimeString(event, 'portfolioAdminOrigin', 'PORTFOLIO_ADMIN_ORIGIN').trim()
  const requestOrigin = getHeader(event, 'origin')?.trim() || ''
  if (configuredOrigin && requestOrigin && getHeader(event, 'sec-fetch-site') !== 'cross-site') {
    try {
      canonicalOrigin = new URL(configuredOrigin).origin === getRequestURL(event).origin
        && new URL(configuredOrigin).origin === requestOrigin
    }
    catch {
      canonicalOrigin = false
    }
  }
  if (!trustedGateway && !canonicalOrigin)
    throw createError({ statusCode: 401, statusMessage: 'Pairing requires the trusted judging gateway or canonical admin origin' })
  const context = event.context as unknown as Record<string, unknown>
  context.judgingPairGateway = trustedGateway
}

async function pairRateLimit(db: DbLike, event: H3Event): Promise<void> {
  const context = event.context as unknown as Record<string, unknown>
  const forwardedIp = context.judgingPairGateway === true ? getHeader(event, 'x-judging-pair-ip') : undefined
  const ip = forwardedIp?.trim() || getHeader(event, 'cf-connecting-ip')?.trim() || 'unknown'
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
  const row = first<{ code_hash: string, expires_at: string, used_at: string | null, claimed_device_id: string | null }>(await db.prepare('SELECT code_hash, expires_at, used_at, claimed_device_id FROM judging_pair_codes WHERE event_id = ? AND code_hash = ? LIMIT 1').bind(JUDGING_EVENT_ID, codeHash).all())
  if (!row)
    throw createError({ statusCode: 400, statusMessage: 'Pair code is invalid' })
  if (row.used_at || row.expires_at <= now)
    throw createError({ statusCode: 410, statusMessage: 'Pair code has expired or already been used' })
  const token = randomToken()
  const id = crypto.randomUUID()
  const expiresAt = new Date(Date.now() + JUDGING_DEVICE_TTL_MS).toISOString()
  const tokenHash = await sha256Text(token)
  const claim = db.prepare(`UPDATE judging_pair_codes
      SET used_at = ?, claimed_device_id = ?
      WHERE event_id = ? AND code_hash = ? AND used_at IS NULL AND claimed_device_id IS NULL AND expires_at > ?`)
    .bind(now, id, JUDGING_EVENT_ID, codeHash, now)
  const device = db.prepare(`INSERT INTO judging_devices
      (id, event_id, name, token_hash, created_at, expires_at, last_seen_at, revoked_at, paired_by)
      SELECT ?, ?, ?, ?, ?, ?, NULL, NULL, ?
      WHERE EXISTS (SELECT 1 FROM judging_pair_codes WHERE event_id = ? AND code_hash = ? AND claimed_device_id = ?)`)
    .bind(id, JUDGING_EVENT_ID, name, tokenHash, now, expiresAt, 'pair-code', JUDGING_EVENT_ID, codeHash, id)
  const audit = db.prepare(`INSERT INTO judging_events
      (id, event_id, event_type, record_key, mutation_id, actor, device_id, payload_json, created_at)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
      WHERE EXISTS (SELECT 1 FROM judging_devices WHERE event_id = ? AND id = ?)
        AND EXISTS (SELECT 1 FROM judging_pair_codes WHERE event_id = ? AND code_hash = ? AND claimed_device_id = ?)`)
    .bind(crypto.randomUUID(), JUDGING_EVENT_ID, 'device.paired', `device:${id}`, id, 'pair-code', id, JSON.stringify({ name }), now, JUDGING_EVENT_ID, id, JUDGING_EVENT_ID, codeHash, id)
  const result = await db.batch([claim, device, audit])
  if (changes(result?.[0]) !== 1)
    throw createError({ statusCode: 410, statusMessage: 'Pair code has expired or already been used' })
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
  const existing = await bucket.head(JUDGING_TEMPLATE_KEY)
  if (existing) {
    const existingHash = existing.customMetadata?.sha256
    if (existingHash !== sha256)
      throw createError({ statusCode: 409, statusMessage: 'The judging workbook template is immutable after first upload' })
    return {
      size: existing.size,
      sha256,
      updatedAt: existing.customMetadata?.updatedAt || new Date().toISOString(),
    }
  }
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

export async function putJudgingEvidence(event: H3Event, id: string, bytes: Uint8Array, actor: string, deviceId?: string, expectedSourceSha256?: string): Promise<JudgingEvidenceMeta> {
  if (bytes.byteLength > JUDGING_MAX_EVIDENCE_BYTES)
    throw createError({ statusCode: 413, statusMessage: 'Evidence is too large' })
  const contentType = getHeader(event, 'content-type')?.split(';', 1)[0]?.trim().toLowerCase() || 'application/octet-stream'
  const kind = String(getHeader(event, 'x-judging-kind') || 'source')
  if (!['source', 'document', 'transcript', 'link'].includes(kind))
    throw createError({ statusCode: 400, statusMessage: 'Evidence kind is invalid' })
  const sha256 = await sha256Bytes(bytes)
  if (expectedSourceSha256 !== undefined && expectedSourceSha256 !== sha256)
    throw createError({ statusCode: 409, statusMessage: 'Evidence source sha256 is immutable' })
  const now = new Date().toISOString()
  const meta: JudgingEvidenceMeta = {
    id,
    teamId: String(getHeader(event, 'x-judging-team-id') || '').trim(),
    snapshotSha: String(getHeader(event, 'x-judging-snapshot-sha') || '').trim(),
    path: String(getHeader(event, 'x-judging-path') || '').trim(),
    kind: kind as JudgingEvidenceMeta['kind'],
    sha256,
    text: '',
    lines: 0,
    coverage: '',
    createdAt: now,
    contentType,
    size: bytes.byteLength,
  }
  const filename = getHeader(event, 'x-judging-filename')?.trim()
  if (filename)
    meta.filename = filename
  const url = getHeader(event, 'x-judging-url')?.trim()
  if (url)
    meta.url = url
  const objectKey = evidenceSourceObjectKey(id, sha256)
  meta.objectKey = objectKey
  await validateJudgingRecord(`evidence:${id}`, meta as unknown as Record<string, unknown>)
  const bucket = requireJudgingR2(event)
  if (!await bucket.head(objectKey)) {
    await bucket.put(objectKey, bytes, {
      httpMetadata: { contentType },
      customMetadata: { sha256, eventId: JUDGING_EVENT_ID, actor, deviceId: deviceId ?? '', evidenceId: id },
    })
  }
  return meta
}

export async function mirrorJudgingEvidenceRecord(event: H3Event, id: string, data: Record<string, unknown>, actor: string, deviceId?: string): Promise<Record<string, unknown>> {
  assertEvidenceStorageFields(id, data)
  const bucket = environment(event).R2
  if (!bucket)
    return data
  const mirrorData = { ...data }
  delete mirrorData.jsonSha256
  delete mirrorData.jsonObjectKey
  const serialized = canonicalJson(mirrorData)
  const jsonSha256 = await sha256Text(serialized)
  const objectKey = evidenceJsonObjectKey(id, jsonSha256)
  if (!await bucket.head(objectKey)) {
    await bucket.put(objectKey, new TextEncoder().encode(serialized), {
      httpMetadata: { contentType: 'application/json; charset=utf-8' },
      customMetadata: {
        eventId: JUDGING_EVENT_ID,
        evidenceId: id,
        jsonSha256,
        sourceSha256: typeof data.sha256 === 'string' ? data.sha256 : '',
        actor,
        deviceId: deviceId ?? '',
      },
    })
  }
  return { ...data, jsonSha256, jsonObjectKey: objectKey }
}

export async function getJudgingEvidenceObject(event: H3Event, id: string): Promise<{ object: R2ObjectBody | null, meta: JudgingEvidenceMeta | null }> {
  if (!EVIDENCE_ID_PATTERN.test(id))
    throw createError({ statusCode: 400, statusMessage: 'Evidence identifier is invalid' })
  const db = requireJudgingDb(event)
  const row = await getJudgingRecord(db, `evidence:${id}`)
  if (!row)
    throw createError({ statusCode: 404, statusMessage: 'Judging evidence not found' })
  const meta = row?.data as unknown as JudgingEvidenceMeta | null
  try {
    if (!meta || typeof meta.id !== 'string' || meta.id.toLowerCase() !== id.toLowerCase())
      throw new Error('Evidence id does not match its record key')
    assertEvidenceStorageFields(id, meta as unknown as Record<string, unknown>)
  }
  catch {
    throw createError({ statusCode: 500, statusMessage: 'Stored judging evidence metadata is invalid' })
  }
  const bucket = environment(event).R2
  const object = bucket && typeof meta.objectKey === 'string' ? await bucket.get(meta.objectKey) : null
  return { object, meta }
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

function stateCursor(event: H3Event): number | undefined {
  const raw = getQuery(event).cursor
  if (raw == null || raw === '')
    return undefined
  const value = Array.isArray(raw) ? raw[0] : raw
  if (typeof value !== 'string' || !/^\d{1,16}$/.test(value))
    throw createError({ statusCode: 400, statusMessage: 'Judging state cursor is invalid' })
  const cursor = Number(value)
  if (!Number.isSafeInteger(cursor) || cursor < 0)
    throw createError({ statusCode: 400, statusMessage: 'Judging state cursor is invalid' })
  return cursor
}

export async function judgingState(db: DbLike, event?: H3Event): Promise<{ assignment: unknown, records: JudgingRecord[], serverTime: string, cursor: number }> {
  const requestedCursor = event ? stateCursor(event) : undefined
  const latest = first<{ cursor: number }>(await db.prepare('SELECT COALESCE(MAX(rowid), 0) AS cursor FROM judging_events WHERE event_id = ?').bind(JUDGING_EVENT_ID).all())
  const cursor = Number(latest?.cursor ?? 0)
  if (requestedCursor === undefined) {
    return {
      assignment: ASSIGNMENT,
      records: await listJudgingRecords(db),
      serverTime: new Date().toISOString(),
      cursor,
    }
  }
  if (requestedCursor > cursor) {
    throw createError({ statusCode: 400, statusMessage: 'Judging state cursor is ahead of the server' })
  }
  const events = await db.prepare(`SELECT DISTINCT record_key
      FROM judging_events
      WHERE event_id = ? AND event_type = 'record.write' AND rowid > ? AND rowid <= ? AND record_key IS NOT NULL`)
    .bind(JUDGING_EVENT_ID, requestedCursor, cursor)
    .all()
  const keys = rows<{ record_key: string }>(events).map(row => row.record_key).filter(key => typeof key === 'string' && key.length > 0)
  const records: JudgingRecord[] = []
  const maxKeysPerQuery = 90
  for (let offset = 0; offset < keys.length; offset += maxKeysPerQuery) {
    const chunk = keys.slice(offset, offset + maxKeysPerQuery)
    const placeholders = chunk.map(() => '?').join(', ')
    const result = await db.prepare(`SELECT event_id, record_key, version, data_json, updated_at, updated_by
        FROM judging_records WHERE event_id = ? AND record_key IN (${placeholders}) ORDER BY record_key ASC`)
      .bind(JUDGING_EVENT_ID, ...chunk)
      .all()
    records.push(...rows<JudgingRecordRow>(result).map(parseJudgingRecordRow))
  }
  records.sort((left, right) => left.key.localeCompare(right.key))
  return { assignment: ASSIGNMENT, records, serverTime: new Date().toISOString(), cursor }
}

export function modelReadiness(input: unknown): boolean {
  return Boolean(input)
}
