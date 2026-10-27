import { readJudgingJson, redeemPairCode, requireJudgingDb } from '../../utils/judging'

export default eventHandler(async (event) => {
  const body = await readJudgingJson(event)
  return await redeemPairCode(requireJudgingDb(event), event, body.code, body.name)
})
