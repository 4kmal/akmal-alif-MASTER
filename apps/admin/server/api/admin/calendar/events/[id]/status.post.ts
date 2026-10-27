import { calendarIdFromEvent, updateCalendarEventStatus } from '../../../../../services/calendar'

export default eventHandler(event => updateCalendarEventStatus(event, calendarIdFromEvent(event)))
