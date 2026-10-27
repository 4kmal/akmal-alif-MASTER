import { getJudgingRecord, pathId, putJudgingEvidence, readJudgingBytes, recordJudgingEvent, requireJudgingDb, requireJudgingDevice, saveJudgingRecord, validateJudgingRecord } from '../../../../utils/judging'

export default eventHandler(async (event) => {
  const device = await requireJudgingDevice(event)
  const id = pathId(event)
  const bytes = await readJudgingBytes(event)
  const meta = await putJudgingEvidence(event, id, bytes, `device:${device.id}`, device.id)
  const db = requireJudgingDb(event)
  await recordJudgingEvent(db, 'evidence.upload', `device:${device.id}`, { id, size: bytes.byteLength, sha256: meta.sha256 }, `evidence:${id}`, device.id)
  const current = await getJudgingRecord(db, `evidence:${id}`)
  if (current) {
    const data = await validateJudgingRecord(`evidence:${id}`, { ...current.data, ...meta })
    await saveJudgingRecord(db, `evidence:${id}`, current.version, data, `upload-${id}-${meta.sha256.slice(0, 32)}`, `device:${device.id}`, device.id)
  }
  else if (meta.teamId && meta.snapshotSha && meta.path) {
    const data = await validateJudgingRecord(`evidence:${id}`, meta)
    await saveJudgingRecord(db, `evidence:${id}`, 0, data, `upload-${id}-${meta.sha256.slice(0, 32)}`, `device:${device.id}`, device.id)
  }
  return { id, size: bytes.byteLength, sha256: meta.sha256, contentType: meta.contentType, stored: Boolean(current || (meta.teamId && meta.snapshotSha && meta.path)) }
})
