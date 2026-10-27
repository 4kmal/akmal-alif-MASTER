import { getQuery, setHeader } from 'h3'
import { requireJudgingOwner } from '../../../../utils/judging'
import { exportJudgingWorkbook } from '../../../../utils/judging-workbook'

export default eventHandler(async (event) => {
  requireJudgingOwner(event)
  const query = getQuery(event)
  const final = query.final === '1' || query.final === 'true'
  const bytes = await exportJudgingWorkbook(event, final)
  setHeader(event, 'Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  setHeader(event, 'Content-Disposition', `attachment; filename="sdc-2026-judging${final ? '-final' : ''}.xlsx"`)
  setHeader(event, 'Cache-Control', 'no-store')
  return bytes
})
