import { getJudgingRecord, pathId, putJudgingEvidence, readJudgingBytes, recordJudgingEvent, requireJudgingDb, requireJudgingOwner, saveJudgingRecord, validateJudgingRecord } from '../../../../../utils/judging'

export default eventHandler(async (event) => {
  const { actor } = requireJudgingOwner(event)
  const id = pathId(event)
  const bytes = await readJudgingBytes(event)
  const meta = await putJudgingEvidence(event, id, bytes, actor)
  const db = requireJudgingDb(event)
  await recordJudgingEvent(db, 'evidence.upload', actor, { id, size: bytes.byteLength, sha256: meta.sha256 }, `evidence:${id}`)
  const current = await getJudgingRecord(db, `evidence:${id}`)
  if (current) {
    const data = await validateJudgingRecord(`evidence:${id}`, {
      ...current.data,
      ...meta,
    })
    await saveJudgingRecord(db, `evidence:${id}`, current.version, data, `upload-${id}-${meta.sha256.slice(0, 32)}`, actor)
  }
  else if (meta.teamId && meta.snapshotSha && meta.path) {
    const data = await validateJudgingRecord(`evidence:${id}`, meta)
    await saveJudgingRecord(db, `evidence:${id}`, 0, data, `upload-${id}-${meta.sha256.slice(0, 32)}`, actor)
  }
  return {
    id,
    size: bytes.byteLength,
    sha256: meta.sha256,
    contentType: meta.contentType,
    objectKey: `${'judging/sdc-2026'}/evidence/${id}`,
    stored: Boolean(current || (meta.teamId && meta.snapshotSha && meta.path)),
  }
})
