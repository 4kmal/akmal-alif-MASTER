import { putJudgingTemplate, readJudgingBytes, recordJudgingEvent, requireJudgingDb, requireJudgingDevice } from '../../../utils/judging'
import { validateJudgingWorkbookTemplate } from '../../../utils/judging-workbook'

export default eventHandler(async (event) => {
  const device = await requireJudgingDevice(event)
  const bytes = await readJudgingBytes(event, 20 * 1024 * 1024)
  await validateJudgingWorkbookTemplate(bytes)
  const result = await putJudgingTemplate(event, bytes, `device:${device.id}`, device.id)
  await recordJudgingEvent(requireJudgingDb(event), 'template.upload', `device:${device.id}`, result, undefined, device.id)
  return result
})
