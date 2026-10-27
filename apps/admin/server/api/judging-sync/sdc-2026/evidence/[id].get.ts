import { setHeader } from 'h3'
import { getJudgingEvidenceObject, pathId, requireJudgingDevice } from '../../../../utils/judging'

export default eventHandler(async (event) => {
  await requireJudgingDevice(event)
  const { object, meta } = await getJudgingEvidenceObject(event, pathId(event))
  if (!object) {
    setHeader(event, 'Content-Type', 'application/json; charset=utf-8')
    setHeader(event, 'Cache-Control', 'no-store')
    return { evidence: meta, text: meta?.text || '' }
  }
  const contentType = object.httpMetadata?.contentType || meta?.contentType || 'application/octet-stream'
  if (/^(?:application\/json|text\/|application\/xml)/i.test(contentType)) {
    const text = new TextDecoder().decode(new Uint8Array(await object.arrayBuffer()))
    setHeader(event, 'Content-Type', 'application/json; charset=utf-8')
    return { evidence: meta, text }
  }
  setHeader(event, 'Content-Type', contentType)
  setHeader(event, 'Content-Disposition', 'attachment; filename="evidence.bin"')
  setHeader(event, 'Cache-Control', 'no-store')
  return object.body
})
