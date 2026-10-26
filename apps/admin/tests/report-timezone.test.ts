import { CalendarDate } from '@internationalized/date'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  computeDateRange,
  computeRealtimeRange,
  date2unix,
  getTimeZone,
  longDate,
  shortDate,
  shortTime,
  unix2date,
} from '../app/utils/time'

const DAY_START = Math.floor(Date.parse('2026-10-25T16:00:00.000Z') / 1000)
const DAY_END = Math.floor(Date.parse('2026-10-26T15:59:59.000Z') / 1000)

afterEach(() => {
  vi.useRealTimers()
})

describe('reporting time zone', () => {
  it('keeps calendar day boundaries in Kuala Lumpur', () => {
    const date = new CalendarDate(2026, 10, 26)

    expect(getTimeZone()).toBe('Asia/Kuala_Lumpur')
    expect(date2unix(date, 'start')).toBe(DAY_START)
    expect(date2unix(date, 'end')).toBe(DAY_END)
    expect(date2unix(new Date('2026-10-25T17:00:00.000Z'), 'start')).toBe(DAY_START)
    expect(unix2date(DAY_START)).toEqual(date)
  })

  it('formats labels with the reporting zone even for another locale', () => {
    const timestamp = Math.floor(Date.parse('2026-01-01T16:30:00.000Z') / 1000)

    expect(shortDate(timestamp, 'en-US')).toBe('1/2/26')
    expect(longDate(timestamp, 'en-US')).toBe('January 2, 2026')
    expect(shortTime(timestamp, 'en-US')).toBe('12:30 AM')
  })

  it('uses reporting midnight for today and realtime today', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-26T01:30:45.000Z'))

    expect(computeDateRange('today')).toEqual([
      DAY_START,
      Math.floor(Date.parse('2026-10-26T01:30:45.000Z') / 1000),
    ])
    expect(computeRealtimeRange('today')).toEqual([
      DAY_START,
      Math.floor(Date.parse('2026-10-26T01:30:45.000Z') / 1000),
    ])
  })
})
