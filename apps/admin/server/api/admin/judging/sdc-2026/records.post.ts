import { readJudgingJson, requireJudgingDb, requireJudgingOwner, saveJudgingRecord, validateJudgingRecord, validateRecordKey } from '../../../../utils/judging'

export default eventHandler(async (event) => {
  const { actor } = requireJudgingOwner(event)
  const body = await readJudgingJson(event)
  const key = await validateRecordKey(body.key)
  const baseVersion = body.baseVersion
  const mutationId = body.mutationId
  const data = await validateJudgingRecord(key, body.data)
  const result = await saveJudgingRecord(requireJudgingDb(event), key, baseVersion as number, data, mutationId as string, actor)
  return result.record
})
