/// <reference path="../../worker-configuration.d.ts" />

import * as analyticsWorker from '@portfolio-analytics'

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('cloudflare:scheduled', async (event) => {
    const config = useRuntimeConfig()
    const env = event.env as Cloudflare.Env

    if (!config.disableAutoBackup) {
      try {
        await backupLinksToR2(env)
      }
      catch (error) {
        console.error('[backup] Scheduled backup failed', error)
      }
    }
    else {
      console.info('[backup] Auto backup is disabled by configuration')
    }

    // Importing is idempotent (`event_id` is the primary key), so a daily
    // schedule can safely backfill legacy profile events before rolling the
    // raw event table into its 13-month summaries.
    const worker = analyticsWorker as typeof analyticsWorker & {
      importLegacyHistory?: (env: unknown) => Promise<unknown>
      runAnalyticsMaintenance?: (env: unknown) => Promise<unknown>
    }
    if (worker.importLegacyHistory) {
      try {
        await worker.importLegacyHistory(env)
      }
      catch (error) {
        console.error('[analytics] Legacy history import failed', error)
      }
    }
    if (worker.runAnalyticsMaintenance) {
      try {
        await worker.runAnalyticsMaintenance(env)
      }
      catch (error) {
        console.error('[analytics] Scheduled maintenance failed', error)
      }
    }
  })
})
