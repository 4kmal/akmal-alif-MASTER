import { getQuery } from 'h3'
import { readGamingReport, readGamingSessionsCsv } from '../../../../services/gaming-observability'

export default eventHandler(async (event) => {
  const query = getQuery(event) as Record<string, unknown>
  if (String(query.format || '').toLowerCase() === 'csv')
    return readGamingSessionsCsv(event)
  return readGamingReport(event)
})
