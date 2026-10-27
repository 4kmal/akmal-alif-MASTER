import { requireJudgingOwner } from '../../../../utils/judging'
import { listJudgingJobs } from '../../../../utils/judging-ai'

export default eventHandler(async (event) => {
  requireJudgingOwner(event)
  return { jobs: await listJudgingJobs(event) }
})
