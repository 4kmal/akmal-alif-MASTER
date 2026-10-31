import type { ObservabilitySummary } from '#shared/types/observability'
import { readCloudflareReport } from '../../../services/cloudflare-observability'
import { readGamingReport } from '../../../services/gaming-observability'

export default eventHandler(async (event): Promise<ObservabilitySummary> => {
  setHeader(event, 'Cache-Control', 'no-store')
  const [cloudflare, gaming] = await Promise.all([
    readCloudflareReport(event),
    readGamingReport(event),
  ])

  return {
    cloudflare: {
      meta: cloudflare.meta,
      coverage: cloudflare.coverage,
      billing: cloudflare.billing,
      metrics: [
        ...cloudflare.compute.filter(metric => !metric.resourceId).slice(0, 3),
        ...cloudflare.storage.filter(metric => !metric.resourceId).slice(0, 1),
      ],
    },
    gaming: {
      meta: gaming.meta,
      coverage: gaming.coverage,
      overview: gaming.overview,
      live: gaming.live,
    },
  }
})
