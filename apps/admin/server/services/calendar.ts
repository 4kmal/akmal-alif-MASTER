import type { H3Event } from 'h3'
import { getQuery, getRouterParam } from 'h3'
import { blogActor, parseJsonBody } from './blog-studio'

const CALENDAR_TIMEZONE = 'Asia/Kuala_Lumpur'
const CALENDAR_MAX_RANGE_DAYS = 366

type D1Like = D1Database

function rows<T = Record<string, unknown>>(result: unknown): T[] {
  if (Array.isArray(result))
    return result as T[]
  const value = result as { results?: unknown[] } | null
  return Array.isArray(value?.results) ? value.results as T[] : []
}

function first<T = Record<string, unknown>>(result: unknown): T | null {
  if (result && typeof result === 'object' && 'results' in result)
    return rows<T>(result)[0] ?? null
  return result as T | null
}

function changes(result: unknown): number {
  const value = result as { meta?: { changes?: number }, changes?: number } | null
  return Number(value?.meta?.changes ?? value?.changes ?? 0)
}

function dbFor(event: H3Event): D1Like {
  const db = event.context.cloudflare?.env?.PORTFOLIO_DB as D1Like | undefined
  if (!db)
    throw createError({ statusCode: 503, statusMessage: 'Portfolio database binding not configured' })
  return db
}

function actorFor(event: H3Event): string {
  return blogActor(event)
}

function stringField(value: unknown, key: string, max: number, required = true): string {
  if (value == null && !required)
    return ''
  if (typeof value !== 'string')
    throw createError({ statusCode: 400, statusMessage: `${key} must be a string` })
  const result = value.trim()
  if (required && !result)
    throw createError({ statusCode: 400, statusMessage: `${key} is required` })
  if (result.length > max)
    throw createError({ statusCode: 400, statusMessage: `${key} is too long` })
  return result
}

function nullableString(value: unknown, key: string, max: number): string | null {
  if (value == null || value === '')
    return null
  return stringField(value, key, max)
}

function integerField(value: unknown, key: string, min: number, max: number): number {
  const number = typeof value === 'number' ? value : Number(value)
  if (!Number.isInteger(number) || number < min || number > max)
    throw createError({ statusCode: 400, statusMessage: `${key} is invalid` })
  return number
}

function booleanField(value: unknown, key: string, fallback: boolean): boolean {
  if (value === undefined)
    return fallback
  if (typeof value !== 'boolean')
    throw createError({ statusCode: 400, statusMessage: `${key} must be a boolean` })
  return value
}

function eventId(value: unknown): string {
  const id = stringField(value, 'event id', 128)
  if (!/^[\w-]+$/.test(id))
    throw createError({ statusCode: 400, statusMessage: 'event id is invalid' })
  return id
}

function dateField(value: unknown, key: string, required = true): string | null {
  if (value == null || value === '') {
    if (required)
      throw createError({ statusCode: 400, statusMessage: `${key} is required` })
    return null
  }
  const date = stringField(value, key, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
    throw createError({ statusCode: 400, statusMessage: `${key} must use YYYY-MM-DD` })
  const parsed = Date.parse(`${date}T00:00:00Z`)
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== date)
    throw createError({ statusCode: 400, statusMessage: `${key} is invalid` })
  return date
}

function utcField(value: unknown, key: string, required = true): string | null {
  if (value == null || value === '') {
    if (required)
      throw createError({ statusCode: 400, statusMessage: `${key} is required` })
    return null
  }
  const candidate = stringField(value, key, 40)
  if (!/Z$/i.test(candidate) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/i.test(candidate))
    throw createError({ statusCode: 400, statusMessage: `${key} must be a UTC ISO timestamp ending in Z` })
  const datePart = candidate.slice(0, 10)
  const dateParsed = Date.parse(`${datePart}T00:00:00.000Z`)
  if (!Number.isFinite(dateParsed) || new Date(dateParsed).toISOString().slice(0, 10) !== datePart)
    throw createError({ statusCode: 400, statusMessage: `${key} is invalid` })
  const parsed = Date.parse(candidate)
  if (!Number.isFinite(parsed))
    throw createError({ statusCode: 400, statusMessage: `${key} is invalid` })
  return new Date(parsed).toISOString()
}

function timezoneField(value: unknown): string {
  const timezone = stringField(value ?? CALENDAR_TIMEZONE, 'timezone', 80)
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format()
  }
  catch {
    throw createError({ statusCode: 400, statusMessage: 'timezone is invalid' })
  }
  return timezone
}

function urlField(value: unknown): string | null {
  const url = nullableString(value, 'url', 2_048)
  if (!url)
    return null
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
      throw new Error('scheme')
  }
  catch {
    throw createError({ statusCode: 400, statusMessage: 'url must be an http or https URL' })
  }
  return url
}

function audit(db: D1Like, actor: string, action: string, entityId: string | null, details: Record<string, unknown>, condition?: string) {
  const where = condition ? ` WHERE ${condition}` : ''
  return db.prepare(`INSERT INTO calendar_audit_records (actor, action, entity_id, details_json, created_at)
    SELECT ?, ?, ?, ?, ?${where}`).bind(actor, action, entityId, JSON.stringify(details), new Date().toISOString())
}

function eventResponse(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    version: Number(row.version),
    title: String(row.title),
    description: row.description == null ? null : String(row.description),
    location: row.location == null ? null : String(row.location),
    url: row.url == null ? null : String(row.url),
    kind: String(row.kind),
    timezone: String(row.timezone || CALENDAR_TIMEZONE),
    all_day: Number(row.all_day) === 1,
    start_date: row.start_date == null ? null : String(row.start_date),
    end_date: row.end_date == null ? null : String(row.end_date),
    starts_at: row.starts_at == null ? null : String(row.starts_at),
    ends_at: row.ends_at == null ? null : String(row.ends_at),
    visibility: String(row.visibility),
    participation: String(row.participation),
    blocks_availability: Number(row.blocks_availability) === 1,
    archived: row.archived_at != null,
    archived_at: row.archived_at == null ? null : String(row.archived_at),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  }
}

async function calendarRow(db: D1Like, id: string): Promise<Record<string, unknown>> {
  const row = first<Record<string, unknown>>(await db.prepare('SELECT id, version, title, description, location, url, kind, timezone, all_day, start_date, end_date, starts_at, ends_at, visibility, participation, blocks_availability, archived_at, created_by, updated_by, created_at, updated_at FROM calendar_events WHERE id = ? LIMIT 1').bind(id).all())
  if (!row)
    throw createError({ statusCode: 404, statusMessage: 'Calendar event not found' })
  return row
}

function eventInput(body: Record<string, unknown>, current?: Record<string, unknown>) {
  const title = stringField(body.title ?? current?.title, 'title', 300)
  const description = body.description === undefined ? current?.description == null ? null : String(current.description) : nullableString(body.description, 'description', 5_000)
  const location = body.location === undefined ? current?.location == null ? null : String(current.location) : nullableString(body.location, 'location', 500)
  const url = body.url === undefined ? current?.url == null ? null : String(current.url) : urlField(body.url)
  const kind = body.kind === undefined ? String(current?.kind ?? '') : body.kind
  if (kind !== 'activity' && kind !== 'event' && kind !== 'meeting')
    throw createError({ statusCode: 400, statusMessage: 'kind must be activity, event, or meeting' })
  const timezone = timezoneField(body.timezone === undefined ? current?.timezone ?? CALENDAR_TIMEZONE : body.timezone)
  const allDay = booleanField(body.all_day, 'all_day', Number(current?.all_day ?? 0) === 1)
  const visibility = body.visibility === undefined ? String(current?.visibility ?? 'private') : body.visibility
  if (visibility !== 'private' && visibility !== 'public' && visibility !== 'busy')
    throw createError({ statusCode: 400, statusMessage: 'visibility must be private, public, or busy' })
  const participation = body.participation === undefined ? String(current?.participation ?? 'interested') : body.participation
  if (participation !== 'interested' && participation !== 'planning' && participation !== 'confirmed')
    throw createError({ statusCode: 400, statusMessage: 'participation must be interested, planning, or confirmed' })
  const blocksAvailability = booleanField(body.blocks_availability, 'blocks_availability', Number(current?.blocks_availability ?? 0) === 1)
  const startDate = allDay ? dateField(body.start_date === undefined ? current?.start_date : body.start_date, 'start_date') : null
  const endDate = allDay ? dateField(body.end_date === undefined ? current?.end_date : body.end_date, 'end_date') : null
  const startsAt = allDay ? null : utcField(body.starts_at === undefined ? current?.starts_at : body.starts_at, 'starts_at')
  const endsAt = allDay ? null : utcField(body.ends_at === undefined ? current?.ends_at : body.ends_at, 'ends_at')
  if (allDay && ((body.starts_at !== undefined && body.starts_at != null) || (body.ends_at !== undefined && body.ends_at != null)))
    throw createError({ statusCode: 400, statusMessage: 'All-day events use start_date and end_date only' })
  if (!allDay && ((body.start_date !== undefined && body.start_date != null) || (body.end_date !== undefined && body.end_date != null)))
    throw createError({ statusCode: 400, statusMessage: 'Timed events use starts_at and ends_at only' })
  if (startDate && endDate && endDate <= startDate)
    throw createError({ statusCode: 400, statusMessage: 'end_date must be after start_date' })
  if (startsAt && endsAt && Date.parse(endsAt) <= Date.parse(startsAt))
    throw createError({ statusCode: 400, statusMessage: 'ends_at must be after starts_at' })
  return { title, description, location, url, kind, timezone, allDay, startDate, endDate, startsAt, endsAt, visibility, participation, blocksAvailability }
}

export function calendarIdFromEvent(event: H3Event): string {
  return eventId(getRouterParam(event, 'id'))
}

export async function listCalendarEvents(event: H3Event) {
  const actor = actorFor(event)
  const result = await dbFor(event).prepare('SELECT id, version, title, description, location, url, kind, timezone, all_day, start_date, end_date, starts_at, ends_at, visibility, participation, blocks_availability, archived_at, created_at, updated_at FROM calendar_events WHERE created_by = ? ORDER BY COALESCE(starts_at, start_date) ASC, id ASC').bind(actor).all()
  return { events: rows<Record<string, unknown>>(result).map(eventResponse) }
}

export async function getCalendarEvent(event: H3Event, id: string) {
  actorFor(event)
  return { event: eventResponse(await calendarRow(dbFor(event), id)) }
}

export async function createCalendarEvent(event: H3Event) {
  const actor = actorFor(event)
  const db = dbFor(event)
  const body = await parseJsonBody<Record<string, unknown>>(event)
  const input = eventInput(body)
  const id = crypto.randomUUID().replaceAll('-', '')
  const now = new Date().toISOString()
  await db.batch([
    db.prepare(`
      INSERT INTO calendar_events (id, version, title, description, location, url, kind, timezone, all_day, start_date, end_date, starts_at, ends_at, visibility, participation, blocks_availability, archived_at, created_by, updated_by, created_at, updated_at)
      VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)
    `).bind(id, input.title, input.description, input.location, input.url, input.kind, input.timezone, input.allDay ? 1 : 0, input.startDate, input.endDate, input.startsAt, input.endsAt, input.visibility, input.participation, input.blocksAvailability ? 1 : 0, actor, actor, now, now),
    audit(db, actor, 'calendar.create', id, { status: 'created', version: 1 }),
  ])
  return { event: eventResponse(await calendarRow(db, id)) }
}

export async function updateCalendarEvent(event: H3Event, id: string) {
  const actor = actorFor(event)
  const db = dbFor(event)
  const current = await calendarRow(db, id)
  if (current.created_by !== actor)
    throw createError({ statusCode: 404, statusMessage: 'Calendar event not found' })
  const body = await parseJsonBody<Record<string, unknown>>(event)
  const version = integerField(body.version, 'version', 1, Number.MAX_SAFE_INTEGER)
  if (Number(current.version) !== version)
    throw createError({ statusCode: 409, statusMessage: 'Calendar event has changed', data: { current_version: Number(current.version) } })
  const input = eventInput(body, current)
  const nextVersion = version + 1
  const now = new Date().toISOString()
  const result = await db.batch([
    db.prepare(`
      UPDATE calendar_events SET version = ?, title = ?, description = ?, location = ?, url = ?, kind = ?, timezone = ?, all_day = ?, start_date = ?, end_date = ?, starts_at = ?, ends_at = ?, visibility = ?, participation = ?, blocks_availability = ?, updated_by = ?, updated_at = ?
      WHERE id = ? AND created_by = ? AND version = ?
    `).bind(nextVersion, input.title, input.description, input.location, input.url, input.kind, input.timezone, input.allDay ? 1 : 0, input.startDate, input.endDate, input.startsAt, input.endsAt, input.visibility, input.participation, input.blocksAvailability ? 1 : 0, actor, now, id, actor, version),
    audit(db, actor, 'calendar.update', id, { status: 'updated', version: nextVersion }, 'changes() = 1'),
  ])
  if (changes(result[0]) !== 1)
    throw createError({ statusCode: 409, statusMessage: 'Calendar event has changed', data: { current_version: Number((await calendarRow(db, id)).version) } })
  return { event: eventResponse(await calendarRow(db, id)) }
}

export async function updateCalendarEventStatus(event: H3Event, id: string) {
  const actor = actorFor(event)
  const db = dbFor(event)
  const current = await calendarRow(db, id)
  if (current.created_by !== actor)
    throw createError({ statusCode: 404, statusMessage: 'Calendar event not found' })
  const body = await parseJsonBody<Record<string, unknown>>(event)
  const version = integerField(body.version, 'version', 1, Number.MAX_SAFE_INTEGER)
  const action = body.status === 'archive' || body.archived === true ? 'archive' : body.status === 'restore' || body.archived === false ? 'restore' : null
  if (!action)
    throw createError({ statusCode: 400, statusMessage: 'status must be archive or restore' })
  if (Number(current.version) !== version)
    throw createError({ statusCode: 409, statusMessage: 'Calendar event has changed', data: { current_version: Number(current.version) } })
  const nextVersion = version + 1
  const archivedAt = action === 'archive' ? new Date().toISOString() : null
  const now = new Date().toISOString()
  const result = await db.batch([
    db.prepare('UPDATE calendar_events SET version = ?, archived_at = ?, updated_by = ?, updated_at = ? WHERE id = ? AND created_by = ? AND version = ?').bind(nextVersion, archivedAt, actor, now, id, actor, version),
    audit(db, actor, `calendar.${action}`, id, { status: action, version: nextVersion }, 'changes() = 1'),
  ])
  if (changes(result[0]) !== 1)
    throw createError({ statusCode: 409, statusMessage: 'Calendar event has changed' })
  return { event: eventResponse(await calendarRow(db, id)) }
}

function settingsResponse(row: Record<string, unknown>) {
  let settings: Record<string, unknown> = {}
  try {
    settings = JSON.parse(String(row.settings_json)) as Record<string, unknown>
  }
  catch {
    settings = {}
  }
  return { version: Number(row.version), timezone: timezoneField(settings.timezone ?? CALENDAR_TIMEZONE) }
}

export async function getCalendarSettings(event: H3Event) {
  actorFor(event)
  const row = first<Record<string, unknown>>(await dbFor(event).prepare('SELECT id, version, settings_json FROM calendar_settings WHERE id = 1 LIMIT 1').all())
  if (!row)
    throw createError({ statusCode: 503, statusMessage: 'Calendar settings unavailable' })
  return { settings: settingsResponse(row) }
}

export async function updateCalendarSettings(event: H3Event) {
  const actor = actorFor(event)
  const db = dbFor(event)
  const body = await parseJsonBody<Record<string, unknown>>(event)
  const current = first<Record<string, unknown>>(await db.prepare('SELECT version, settings_json FROM calendar_settings WHERE id = 1 LIMIT 1').all())
  if (!current)
    throw createError({ statusCode: 503, statusMessage: 'Calendar settings unavailable' })
  const version = integerField(body.version, 'version', 1, Number.MAX_SAFE_INTEGER)
  if (Number(current.version) !== version)
    throw createError({ statusCode: 409, statusMessage: 'Calendar settings have changed', data: { current_version: Number(current.version) } })
  const timezone = timezoneField(body.timezone ?? settingsResponse(current).timezone)
  const nextVersion = version + 1
  const now = new Date().toISOString()
  const result = await db.batch([
    db.prepare('UPDATE calendar_settings SET version = ?, settings_json = ?, updated_by = ?, updated_at = ? WHERE id = 1 AND version = ?').bind(nextVersion, JSON.stringify({ timezone }), actor, now, version),
    audit(db, actor, 'calendar.settings.update', '1', { status: 'updated', version: nextVersion }, 'changes() = 1'),
  ])
  if (changes(result[0]) !== 1)
    throw createError({ statusCode: 409, statusMessage: 'Calendar settings have changed' })
  return getCalendarSettings(event)
}

export function calendarQuery(event: H3Event): { start: string, end: string } {
  const query = getQuery(event) as Record<string, unknown>
  const start = dateField(query.start, 'start') as string
  const end = dateField(query.end, 'end') as string
  const span = (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000
  if (end <= start || span < 1 || span > CALENDAR_MAX_RANGE_DAYS)
    throw createError({ statusCode: 400, statusMessage: 'Calendar range must be 1 to 366 days' })
  return { start, end }
}
