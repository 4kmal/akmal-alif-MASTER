import { pathId, requireJudgingDevice } from '../../../../../utils/judging'
import { cancelJudgingJob } from '../../../../../utils/judging-ai'

export default eventHandler(async (event) => {
  const device = await requireJudgingDevice(event)
  return await cancelJudgingJob(event, pathId(event), `device:${device.id}`, device.id)
})
