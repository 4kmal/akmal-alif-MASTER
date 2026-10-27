import { readJudgingJson, requireJudgingOwner } from '../../../../utils/judging'
import { queueJudgingAssessment } from '../../../../utils/judging-ai'

export default eventHandler(async (event) => {
  const { actor } = requireJudgingOwner(event)
  const body = await readJudgingJson<{ teamId?: unknown, retryJobId?: unknown }>(event)
  return await queueJudgingAssessment(event, body.teamId, actor, undefined, body.retryJobId)
})
