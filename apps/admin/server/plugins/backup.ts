/// <reference path="../../worker-configuration.d.ts" />

import * as analyticsWorker from '@portfolio-analytics'
import { runAdminSchedule } from '../services/admin-schedule'
import { collectCloudflareObservability, runCloudflareMaintenance } from '../services/cloudflare-observability'
import { runGamingMaintenance } from '../services/gaming-observability'

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('cloudflare:scheduled', async (event) => {
    const config = useRuntimeConfig()
    const env = event.env as Cloudflare.Env

    const worker = analyticsWorker as typeof analyticsWorker & {
      importLegacyHistory?: (env: unknown) => Promise<unknown>
      runAnalyticsMaintenance?: (env: unknown) => Promise<unknown>
    }
    await runAdminSchedule(event.controller.cron, {
      collect: () => collectCloudflareObservability(env),
      backup: async () => {
        if (!config.disableAutoBackup)
          await backupLinksToR2(env)
      },
      importLegacy: async () => worker.importLegacyHistory?.(env),
      maintainAnalytics: async () => worker.runAnalyticsMaintenance?.(env),
      maintainGaming: () => runGamingMaintenance(env),
      maintainCloudflare: () => runCloudflareMaintenance(env),
    }, (job, error) => {
      console.error(`[schedule] ${job} failed`, error instanceof Error ? error.message : 'Unknown error')
    })
  })
})
