import * as analyticsWorker from '@portfolio-analytics'
import { z } from 'zod'

const inputSchema = z.object({
  operation: z.enum(['import-legacy', 'rollup']),
})

export default eventHandler(async (event) => {
  const { operation } = await readValidatedBody(event, inputSchema.parse)
  const worker = analyticsWorker as unknown as {
    importLegacyHistory: (env: unknown) => Promise<unknown>
    runAnalyticsMaintenance: (env: unknown) => Promise<unknown>
  }
  const env = event.context.cloudflare.env
  const result = operation === 'import-legacy'
    ? await worker.importLegacyHistory(env)
    : await worker.runAnalyticsMaintenance(env)
  return { operation, checked_at: new Date().toISOString(), result }
})
