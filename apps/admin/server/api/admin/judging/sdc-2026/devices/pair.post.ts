import { createPairCode, requireJudgingDb, requireJudgingOwner } from '../../../../../utils/judging'

export default eventHandler(async (event) => {
  const { actor } = requireJudgingOwner(event)
  return await createPairCode(requireJudgingDb(event), actor)
})
