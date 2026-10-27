import { readJudgingJson, redeemPairCode, requireJudgingDb, requireJudgingPairRequest } from '../../utils/judging'

export default eventHandler(async (event) => {
  requireJudgingPairRequest(event)
  const body = await readJudgingJson(event)
  return await redeemPairCode(requireJudgingDb(event), event, body.code, body.name)
})
