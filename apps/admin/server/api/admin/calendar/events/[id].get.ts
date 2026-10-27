import { calendarIdFromEvent, getCalendarEvent } from '../../../../services/calendar'

export default eventHandler(event => getCalendarEvent(event, calendarIdFromEvent(event)))
