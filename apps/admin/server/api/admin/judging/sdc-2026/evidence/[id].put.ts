import { getJudgingRecord, pathId, putJudgingEvidence, readJudgingBytes, recordJudgingEvent, requireJudgingDb, requireJudgingOwner, saveJudgingRecord, validateJudgingRecord } from '../../../../../utils/judging'

export default eventHandler(async (event) => {
  const { actor } = requireJudgingOwner(event)
  const id = pathId(event)
  const bytes = await readJudgingBytes(event)
  const meta = await putJudgingEvidence(event, id, bytes, actor)
  const db = requireJudgingDb(event)
  const current = await getJudgingRecord(db, `evidence:${id}`)
  let record
  if (current) {
    const data = await validateJudgingRecord(`evidence:${id}`, {
      ...current.data,
      ...meta,
    })
    record = await saveJudgingRecord(db, `evidence:${id}`, current.version, data, `upload-${id}-${meta.sha256.slice(0, 32)}`, actor, undefined, event)
  }
  else {
    const data = await validateJudgingRecord(`evidence:${id}`, meta)
    record = await saveJudgingRecord(db, `evidence:${id}`, 0, data, `upload-${id}-${meta.sha256.slice(0, 32)}`, actor, undefined, event)
  }
  await recordJudgingEvent(db, 'evidence.upload', actor, { id, size: bytes.byteLength, sha256: meta.sha256, version: record.record.version }, `evidence:${id}`)
  return {
    id,
    size: bytes.byteLength,
    sha256: meta.sha256,
    contentType: meta.contentType,
    objectKey: meta.objectKey,
    stored: true,
  }
})
