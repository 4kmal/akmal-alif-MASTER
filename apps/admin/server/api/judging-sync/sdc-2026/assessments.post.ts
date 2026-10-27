import { readJudgingJson, requireJudgingDevice } from '../../../utils/judging'
import { queueJudgingAssessment } from '../../../utils/judging-ai'

export default eventHandler(async (event) => {
  const device = await requireJudgingDevice(event)
  const body = await readJudgingJson<{ teamId?: unknown, retryJobId?: unknown }>(event)
  return await queueJudgingAssessment(event, body.teamId, `device:${device.id}`, device.id, body.retryJobId)
})
