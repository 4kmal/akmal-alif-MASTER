import { pathId, requireJudgingOwner } from '../../../../../../utils/judging'
import { cancelJudgingJob } from '../../../../../../utils/judging-ai'

export default eventHandler(async (event) => {
  const { actor } = requireJudgingOwner(event)
  return await cancelJudgingJob(event, pathId(event), actor)
})
