import { readJudgingJson, recordJudgingEvent, requireJudgingDb, requireJudgingDevice, validateRecordKey } from '../../../utils/judging'

const ALLOWED_EVENT_TYPES = new Set([
  'evidence.read',
  'evidence.open',
  'evidence.upload',
  'assessment.request',
  'assessment.cancel',
  'sync.read',
])

export default eventHandler(async (event) => {
  const device = await requireJudgingDevice(event)
  const body = await readJudgingJson<{ type?: unknown, recordKey?: unknown, payload?: unknown }>(event, 64 * 1024)
  if (typeof body.type !== 'string' || !ALLOWED_EVENT_TYPES.has(body.type))
    throw createError({ statusCode: 400, statusMessage: 'Judging event type is invalid' })

  let recordKey: string | undefined
  if (body.recordKey != null)
    recordKey = await validateRecordKey(body.recordKey)

  await recordJudgingEvent(requireJudgingDb(event), body.type, `device:${device.id}`, body.payload ?? {}, recordKey, device.id)
  return { accepted: true, serverTime: new Date().toISOString() }
})
