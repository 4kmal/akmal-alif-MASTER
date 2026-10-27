import { judgingState, requireJudgingDb, requireJudgingOwner } from '../../../../utils/judging'

export default eventHandler(async (event) => {
  requireJudgingOwner(event)
  return await judgingState(requireJudgingDb(event), event)
})
