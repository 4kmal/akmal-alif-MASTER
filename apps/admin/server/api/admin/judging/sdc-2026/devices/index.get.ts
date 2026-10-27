import { listJudgingDevices, requireJudgingDb, requireJudgingOwner } from '../../../../../utils/judging'

export default eventHandler(async (event) => {
  requireJudgingOwner(event)
  return { devices: await listJudgingDevices(requireJudgingDb(event)) }
})
