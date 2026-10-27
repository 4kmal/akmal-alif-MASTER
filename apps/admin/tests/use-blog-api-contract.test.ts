import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useBlogApi } from '../app/composables/useBlogApi'

const useAPIMock = vi.hoisted(() => vi.fn())

vi.mock('../app/utils/api', () => ({ useAPI: useAPIMock }))

const event = {
  id: 'event-id',
  version: 2,
  kind: 'event',
  title: 'Review',
  timezone: 'Asia/Kuala_Lumpur',
  all_day: false,
  starts_at: '2026-10-28T08:00:00.000Z',
  ends_at: '2026-10-28T09:00:00.000Z',
  visibility: 'private',
  participation: 'interested',
  blocks_availability: false,
}

describe('admin calendar API paths', () => {
  beforeEach(() => {
    useAPIMock.mockReset()
    useAPIMock.mockImplementation(async (path: string) => path.includes('/events?')
      ? { events: [] }
      : path.endsWith('/settings')
        ? { settings: { version: 2, timezone: 'Asia/Kuala_Lumpur' } }
        : { event })
  })

  it('keeps calendar requests under the dedicated admin calendar route', async () => {
    const api = useBlogApi()
    await api.listCalendarEvents({ include_archived: true })
    await api.createCalendarEvent({ kind: 'event', title: 'Review', description: '', location: '', url: '', timezone: 'Asia/Kuala_Lumpur', start_at: event.starts_at, end_at: event.ends_at, all_day: false, date: null, end_date_exclusive: null, visibility: 'private', participation: 'interested', blocks_availability: false })
    await api.getCalendarEvent('event-id')
    await api.updateCalendarEvent('event-id', { version: 2, kind: 'event', title: 'Review', description: '', location: '', url: '', timezone: 'Asia/Kuala_Lumpur', start_at: event.starts_at, end_at: event.ends_at, all_day: false, date: null, end_date_exclusive: null, visibility: 'private', participation: 'interested', blocks_availability: false })
    await api.setCalendarEventStatus('event-id', 'archived', 2)
    await api.getCalendarSettings()
    await api.saveCalendarSettings({ version: 2, timezone: 'Asia/Kuala_Lumpur' })

    expect(useAPIMock.mock.calls.map(([path]) => path)).toEqual([
      '/api/admin/calendar/events?include_archived=true',
      '/api/admin/calendar/events',
      '/api/admin/calendar/events/event-id',
      '/api/admin/calendar/events/event-id',
      '/api/admin/calendar/events/event-id/status',
      '/api/admin/calendar/settings',
      '/api/admin/calendar/settings',
    ])
  })
})
