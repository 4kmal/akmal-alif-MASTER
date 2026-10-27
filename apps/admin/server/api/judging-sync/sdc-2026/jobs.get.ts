import { requireJudgingDevice } from '../../../utils/judging'
import { listJudgingJobs } from '../../../utils/judging-ai'

export default eventHandler(async (event) => {
  const device = await requireJudgingDevice(event)
  return { jobs: await listJudgingJobs(event, device.id) }
})
