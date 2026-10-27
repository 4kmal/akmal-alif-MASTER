import { readJudgingJson, requireJudgingDb, requireJudgingDevice, saveJudgingRecord, validateJudgingRecord, validateRecordKey } from '../../../utils/judging'

export default eventHandler(async (event) => {
  const device = await requireJudgingDevice(event)
  const body = await readJudgingJson(event)
  const key = await validateRecordKey(body.key)
  const data = await validateJudgingRecord(key, body.data)
  const result = await saveJudgingRecord(requireJudgingDb(event), key, body.baseVersion as number, data, body.mutationId as string, `device:${device.id}`, device.id, event)
  return result.record
})
