import type { DateValue } from '@internationalized/date'
import type { AnalysisDatePreset, RealtimeWindow } from '@/utils/dashboard-query'
import { fromAbsolute, now, startOfMonth, startOfWeek, toCalendarDate, toZoned } from '@internationalized/date'

export const REPORTING_TIME_ZONE = 'Asia/Kuala_Lumpur'

const REALTIME_DURATIONS: Record<Exclude<RealtimeWindow, 'today'>, { minutes?: number, hours?: number }> = {
  'last-5m': { minutes: 5 },
  'last-10m': { minutes: 10 },
  'last-30m': { minutes: 30 },
  'last-1h': { hours: 1 },
  'last-6h': { hours: 6 },
  'last-12h': { hours: 12 },
  'last-24h': { hours: 24 },
}

export function getTimeZone() {
  return REPORTING_TIME_ZONE
}

export function getLocale() {
  if (typeof Intl === 'undefined')
    return typeof navigator === 'undefined' ? 'en-US' : navigator.language

  return new Intl.DateTimeFormat().resolvedOptions().locale
}

export function shortDate(unix = 0, locale?: string) {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeZone: getTimeZone() }).format(unix * 1000)
}

export function longDate(unix = 0, locale?: string) {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: getTimeZone() }).format(unix * 1000)
}

export function shortTime(unix = 0, locale?: string) {
  return new Intl.DateTimeFormat(locale, { timeStyle: 'short', timeZone: getTimeZone() }).format(unix * 1000)
}

function calendarDateInReportingZone(dateValue: DateValue | Date) {
  if (dateValue instanceof Date)
    return toCalendarDate(fromAbsolute(dateValue.getTime(), getTimeZone()))

  return toCalendarDate(toZoned(dateValue, getTimeZone()))
}

function calendarDateToUnix(dateValue: ReturnType<typeof toCalendarDate>, type: 'start' | 'end') {
  const dayStart = toZoned(dateValue, getTimeZone()).toDate().getTime()
  if (type === 'start')
    return Math.floor(dayStart / 1000)

  const nextDayStart = toZoned(dateValue.add({ days: 1 }), getTimeZone()).toDate().getTime()
  return Math.floor(nextDayStart / 1000) - 1
}

export function date2unix(dateValue: DateValue | Date, type?: 'start' | 'end') {
  if (!type) {
    if (dateValue instanceof Date)
      return Math.floor(dateValue.getTime() / 1000)

    return Math.floor(toZoned(dateValue, getTimeZone()).toDate().getTime() / 1000)
  }

  return calendarDateToUnix(calendarDateInReportingZone(dateValue), type)
}

export function unix2date(unix: number) {
  return toCalendarDate(fromAbsolute(unix * 1000, getTimeZone()))
}

export function getWeekdayNames(style: 'long' | 'short' | 'narrow' = 'short', locale?: string) {
  const formatter = new Intl.DateTimeFormat(locale, { weekday: style, timeZone: getTimeZone() })
  // 2024-01-01 is Monday
  return Array.from({ length: 7 }, (_, i) => {
    const date = new Date(Date.UTC(2024, 0, 1 + i, 12))
    return formatter.format(date)
  })
}

export function computeDateRange(name: AnalysisDatePreset | string, locale?: string): [number, number] {
  const tz = getTimeZone()
  const currentTime = now(tz)

  const presets: Record<AnalysisDatePreset, () => [number, number]> = {
    'today': () => [date2unix(currentTime, 'start'), date2unix(currentTime)],
    'last-24h': () => [date2unix(currentTime.subtract({ hours: 24 })), date2unix(currentTime)],
    'this-week': () => [date2unix(startOfWeek(currentTime, locale || getLocale()), 'start'), date2unix(currentTime)],
    'last-7d': () => [date2unix(currentTime.subtract({ days: 7 })), date2unix(currentTime)],
    'this-month': () => [date2unix(startOfMonth(currentTime), 'start'), date2unix(currentTime)],
    'last-30d': () => [date2unix(currentTime.subtract({ days: 30 })), date2unix(currentTime)],
    'last-90d': () => [date2unix(currentTime.subtract({ days: 90 })), date2unix(currentTime)],
  }

  return presets[name as AnalysisDatePreset]?.() ?? presets['last-7d']()
}

export function computeRealtimeRange(name: RealtimeWindow): [number, number] {
  const currentTime = now(getTimeZone())
  const endAt = date2unix(currentTime)

  if (name === 'today')
    return [date2unix(currentTime, 'start'), endAt]

  return [date2unix(currentTime.subtract(REALTIME_DURATIONS[name])), endAt]
}
