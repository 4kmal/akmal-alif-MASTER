import { requireJudgingDevice } from '../../../utils/judging'
import { listJudgingJobs } from '../../../utils/judging-ai'

export default eventHandler(async (event) => {
  await requireJudgingDevice(event)
  return { jobs: await listJudgingJobs(event) }
})
