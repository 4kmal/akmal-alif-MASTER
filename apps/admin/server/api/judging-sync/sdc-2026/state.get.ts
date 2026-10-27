import { judgingState, requireJudgingDb, requireJudgingDevice } from '../../../utils/judging'

export default eventHandler(async (event) => {
  await requireJudgingDevice(event)
  return await judgingState(requireJudgingDb(event), event)
})
