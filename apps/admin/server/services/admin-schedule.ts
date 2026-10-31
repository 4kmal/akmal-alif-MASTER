export interface AdminScheduleJobs {
  collect: () => Promise<unknown>
  backup: () => Promise<unknown>
  importLegacy: () => Promise<unknown>
  maintainAnalytics: () => Promise<unknown>
  maintainGaming: () => Promise<unknown>
  maintainCloudflare: () => Promise<unknown>
}

export async function runAdminSchedule(
  cron: string,
  jobs: AdminScheduleJobs,
  onError: (job: string, error: unknown) => void,
): Promise<void> {
  const names: Array<keyof AdminScheduleJobs> = cron === '*/15 * * * *'
    ? ['collect']
    : cron === '0 0 * * *'
      ? ['backup', 'importLegacy', 'maintainAnalytics', 'maintainGaming', 'maintainCloudflare']
      : []

  for (const name of names) {
    try {
      await jobs[name]()
    }
    catch (error) {
      onError(name, error)
    }
  }
}
