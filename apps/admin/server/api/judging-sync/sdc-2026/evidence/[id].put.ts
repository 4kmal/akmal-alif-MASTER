import { getJudgingRecord, pathId, putJudgingEvidence, readJudgingBytes, recordJudgingEvent, requireJudgingDb, requireJudgingDevice, saveJudgingRecord, validateJudgingRecord } from '../../../../utils/judging'

export default eventHandler(async (event) => {
  const device = await requireJudgingDevice(event)
  const id = pathId(event)
  const bytes = await readJudgingBytes(event)
  const db = requireJudgingDb(event)
  const current = await getJudgingRecord(db, `evidence:${id}`)
  const expectedSourceSha256 = typeof current?.data.sha256 === 'string' ? current.data.sha256 : undefined
  const meta = await putJudgingEvidence(event, id, bytes, `device:${device.id}`, device.id, expectedSourceSha256)
  let record
  if (current) {
    const data = await validateJudgingRecord(`evidence:${id}`, { ...current.data, ...meta })
    record = await saveJudgingRecord(db, `evidence:${id}`, current.version, data, `upload-${id}-${meta.sha256.slice(0, 32)}`, `device:${device.id}`, device.id, event)
  }
  else {
    const data = await validateJudgingRecord(`evidence:${id}`, meta)
    record = await saveJudgingRecord(db, `evidence:${id}`, 0, data, `upload-${id}-${meta.sha256.slice(0, 32)}`, `device:${device.id}`, device.id, event)
  }
  await recordJudgingEvent(db, 'evidence.upload', `device:${device.id}`, { id, size: bytes.byteLength, sha256: meta.sha256, version: record.record.version }, `evidence:${id}`, device.id)
  return { id, size: bytes.byteLength, sha256: meta.sha256, contentType: meta.contentType, objectKey: meta.objectKey, stored: true }
})
