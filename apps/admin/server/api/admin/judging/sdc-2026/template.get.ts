import { setHeader } from 'h3'
import { getJudgingTemplate, requireJudgingOwner } from '../../../../utils/judging'

export default eventHandler(async (event) => {
  requireJudgingOwner(event)
  setHeader(event, 'Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  setHeader(event, 'Content-Disposition', 'attachment; filename="sdc-2026-judging-template.xlsx"')
  setHeader(event, 'Cache-Control', 'no-store')
  return getJudgingTemplate(event)
})
