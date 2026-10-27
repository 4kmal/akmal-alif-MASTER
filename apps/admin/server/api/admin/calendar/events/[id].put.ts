import { calendarIdFromEvent, updateCalendarEvent } from '../../../../services/calendar'

export default eventHandler(event => updateCalendarEvent(event, calendarIdFromEvent(event)))
