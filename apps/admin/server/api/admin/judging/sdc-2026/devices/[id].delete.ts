import { pathId, requireJudgingDb, requireJudgingOwner, revokeJudgingDevice } from '../../../../../utils/judging'

export default eventHandler(async (event) => {
  const { actor } = requireJudgingOwner(event)
  await revokeJudgingDevice(requireJudgingDb(event), pathId(event), actor)
  return { revoked: true }
})
