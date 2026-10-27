import { setHeader } from 'h3'
import { getJudgingTemplate, requireJudgingDevice } from '../../../utils/judging'

export default eventHandler(async (event) => {
  await requireJudgingDevice(event)
  setHeader(event, 'Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  setHeader(event, 'Content-Disposition', 'attachment; filename="sdc-2026-judging-template.xlsx"')
  setHeader(event, 'Cache-Control', 'no-store')
  return getJudgingTemplate(event)
})
