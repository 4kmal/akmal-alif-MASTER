import { putJudgingTemplate, readJudgingBytes, recordJudgingEvent, requireJudgingDb, requireJudgingOwner } from '../../../../utils/judging'
import { validateJudgingWorkbookTemplate } from '../../../../utils/judging-workbook'

export default eventHandler(async (event) => {
  const { actor } = requireJudgingOwner(event)
  const bytes = await readJudgingBytes(event, 20 * 1024 * 1024)
  await validateJudgingWorkbookTemplate(bytes)
  const result = await putJudgingTemplate(event, bytes, actor)
  await recordJudgingEvent(requireJudgingDb(event), 'template.upload', actor, result)
  return result
})
