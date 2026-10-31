import { describe, expect, it, vi } from 'vitest'
import { runAdminSchedule } from '../server/services/admin-schedule'

function jobs() {
  return {
    collect: vi.fn(async () => {}),
    backup: vi.fn(async () => {}),
    importLegacy: vi.fn(async () => {}),
    maintainAnalytics: vi.fn(async () => {}),
    maintainGaming: vi.fn(async () => {}),
    maintainCloudflare: vi.fn(async () => {}),
  }
}

describe('admin scheduled work', () => {
  it('collects periodic snapshots without running backups or retention work', async () => {
    const tasks = jobs()
    await runAdminSchedule('*/15 * * * *', tasks, vi.fn())
    expect(tasks.collect).toHaveBeenCalledOnce()
    for (const name of ['backup', 'importLegacy', 'maintainAnalytics', 'maintainGaming', 'maintainCloudflare'] as const)
      expect(tasks[name]).not.toHaveBeenCalled()
  })

  it('keeps daily retention running even when a backup fails', async () => {
    const tasks = jobs()
    const error = new Error('Storage unavailable')
    tasks.backup.mockRejectedValue(error)
    const onError = vi.fn()
    await runAdminSchedule('0 0 * * *', tasks, onError)
    expect(onError).toHaveBeenCalledWith('backup', error)
    expect(tasks.collect).not.toHaveBeenCalled()
    expect(tasks.importLegacy).toHaveBeenCalledOnce()
    expect(tasks.maintainAnalytics).toHaveBeenCalledOnce()
    expect(tasks.maintainGaming).toHaveBeenCalledOnce()
    expect(tasks.maintainCloudflare).toHaveBeenCalledOnce()
  })

  it('ignores unknown schedules', async () => {
    const tasks = jobs()
    await runAdminSchedule('* * * * *', tasks, vi.fn())
    expect(Object.values(tasks).every(task => task.mock.calls.length === 0)).toBe(true)
  })
})
