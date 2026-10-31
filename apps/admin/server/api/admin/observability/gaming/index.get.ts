import { getQuery, setHeader } from 'h3'
import { readGamingReport, readGamingSessionsCsv } from '../../../../services/gaming-observability'
import { withGamingPresence } from '../../../../services/gaming-presence'

export default eventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store')
  const query = getQuery(event) as Record<string, unknown>
  if (String(query.format || '').toLowerCase() === 'csv')
    return readGamingSessionsCsv(event)
  return withGamingPresence(event, await readGamingReport(event))
})
